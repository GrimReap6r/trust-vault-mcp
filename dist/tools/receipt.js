// src/tools/receipt.ts
import { supabase } from "../supabase.js";
/**
 * Field-level fallback order confirmed against page.tsx's receipt display
 * (the merchant-facing UI on the actual site): it reads
 * `payout_details.<field>` FIRST, falling back to the flatter top-level
 * column second --
 *
 *   receiptData.payout_details?.beneficiary_name ?? receiptData.account_name
 *   receiptData.payout_details?.account_number   ?? receiptData.account_number
 *   receiptData.payout_details?.bank_name        ?? receiptData.bank_name
 *
 * The previous version of this file read ONLY the top-level column, which
 * is why get_receipt/find_receipt were returning bankName: null even on a
 * receipt where the bank name was clearly known at reservation time (it's
 * in payout_details, just not mirrored onto the flat bank_name column for
 * every row). Matching the frontend's own fallback order fixes that
 * without guessing at anything -- page.tsx is the source of truth for
 * which field actually gets populated reliably.
 */
function mapRow(row) {
    const payoutDetails = row.payout_details ?? {};
    // receipt_url isn't always populated on the row -- when it's missing,
    // build the same link page.tsx opens for the full receipt
    // (window.open(`/receipts/${id}`)), using the app's own base URL rather
    // than guessing a domain.
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    const fallbackReceiptUrl = APP_URL ? `${APP_URL.replace(/\/+$/, "")}/receipts/${row.id}` : null;
    return {
        id: row.id,
        payoutReference: row.payout_reference,
        transactionSignature: row.transaction_signature,
        fiatAmount: row.fiat_amount,
        currency: row.currency,
        tokenAmount: row.token_amount,
        feeAmount: row.fee_amount,
        bankName: payoutDetails.bank_name ?? row.bank_name ?? null,
        accountNumber: payoutDetails.account_number ?? row.account_number ?? null,
        beneficiaryName: payoutDetails.beneficiary_name ?? row.beneficiary_name ?? null,
        status: row.status,
        createdAt: row.created_at,
        receiptUrl: row.receipt_url ?? fallbackReceiptUrl,
    };
}
/**
 * The actual success oracle for wait_for_payment -- a row here ONLY exists
 * after a verified successful transfer (confirmed against the merchant
 * page's flow: receipt generation happens after Flutterwave verification
 * succeeds, never on rejection). Absence of a reservation on-chain is NOT
 * sufficient to claim success on its own -- this is.
 *
 * Matched on trust_express_address + taker_address rather than the on-chain
 * timestamp: receipts only store created_at (row insert time), and
 * payout_reference isn't known to this server until after the customer's
 * wallet generates it on-chain inside instant_reserve's handler, so it
 * can't be used as a lookup key here.
 */
export async function findReceipt(args) {
    const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .eq("trust_express_address", args.trustExpressAddress)
        .eq("taker_address", args.takerAddress)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(`Supabase receipts query failed: ${error.message}`);
    if (!data)
        return null;
    // CONFIRMED against a real completed trade (IP-1785681351-7mCgjRcy):
    // status is exactly "success" (lowercase) once settlement completes, with
    // transaction_signature populated at the same time. A "pending" row (seen
    // separately, when the settlement bot was offline) has status "pending"
    // and transaction_signature null -- that combination must NOT be reported
    // as a match here.
    if (data.status !== "success" || !data.transaction_signature) {
        return null;
    }
    return mapRow(data);
}
/** get_receipt -- pull and display a specific receipt by its known reference. */
export async function getReceiptByReference(payoutReference) {
    const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .eq("payout_reference", payoutReference)
        .maybeSingle();
    if (error)
        throw new Error(`Supabase receipts query failed: ${error.message}`);
    return data ? mapRow(data) : null;
}
