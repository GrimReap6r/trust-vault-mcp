// src/tools/receiptByOrder.ts
//
// Manual fallback for the merchant-qr-card widget's "Check now" button, in
// case its Supabase Realtime socket never connects or drops (sandboxed
// iframes + flaky networks happen). Deliberately mirrors the Realtime
// subscription's own trust boundary exactly -- filtered on
// trust_express_address ONLY, same as page.tsx's channel filter -- rather
// than trying to add a taker_address filter here that the primary
// (Realtime) path doesn't have. Keeping both paths' guarantees identical
// avoids a confusing situation where the live push and the manual check
// could disagree about what counts as "the" receipt for this order.
//
// Same ambiguity as the Realtime filter applies here too: if multiple
// takers reserved against this shared LP order around the same time, this
// returns the most recent matching receipt, not necessarily the one tied
// to this specific QR/customer. See waitForPayment.ts's takerWallet-based
// check for the stronger guarantee when you do have that wallet in hand.
//
// UPDATE: callers that know the actual signer (resolved via a Solana Pay
// reference -- see solanaPay.ts's findSignerByReference) can now pass
// signerAddress to narrow the match to that specific payer, closing most
// of the collision gap described above. Omitting it falls back to the
// original loose match, so this stays backward-compatible for callers
// that don't have a signer yet.
import { supabase } from "../supabase.js";
import type { ReceiptRecord } from "./receipt.js";

export async function getReceiptByOrder(args: {
  orderAddress: string;
  fiatAmount: number;
  currency: string;
  signerAddress?: string; // NEW — when known (via findSignerByReference), narrows the
                           // match to this specific payer, closing the collision gap
                           // this function's own doc comment used to just document.
}): Promise<{ found: boolean; receipt?: ReceiptRecord }> {
  let query = supabase
    .from("receipts")
    .select("*")
    .eq("trust_express_address", args.orderAddress)
    .eq("status", "success")
    .eq("fiat_amount", args.fiatAmount)
    .eq("currency", args.currency);

  if (args.signerAddress) {
    query = query.eq("taker_address", args.signerAddress);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (error) throw new Error(`Supabase receipts query failed: ${error.message}`);
  if (!data) return { found: false };

  return {
    found: true,
    receipt: {
      id: data.id,
      payoutReference: data.payout_reference,
      transactionSignature: data.transaction_signature,
      fiatAmount: data.fiat_amount,
      currency: data.currency,
      tokenAmount: data.token_amount,
      feeAmount: data.fee_amount,
      bankName: data.payout_details?.bank_name ?? data.bank_name ?? null,
      accountNumber: data.payout_details?.account_number ?? data.account_number ?? null,
      beneficiaryName: data.payout_details?.beneficiary_name ?? data.beneficiary_name ?? null,
      status: data.status,
      createdAt: data.created_at,
      receiptUrl: data.receipt_url ?? null,
    },
  };
}