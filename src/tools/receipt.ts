// src/tools/receipt.ts
import { supabase } from "../supabase.js";

export interface ReceiptRecord {
  id: string;
  payoutReference: string;
  transactionSignature: string;
  fiatAmount: string;
  currency: string;
  tokenAmount: string;
  feeAmount: string;
  bankName: string;
  accountNumber: string;
  beneficiaryName: string;
  status: string;
  createdAt: string;
  receiptUrl: string;
}

function mapRow(row: any): ReceiptRecord {
  return {
    id: row.id,
    payoutReference: row.payout_reference,
    transactionSignature: row.transaction_signature,
    fiatAmount: row.fiat_amount,
    currency: row.currency,
    tokenAmount: row.token_amount,
    feeAmount: row.fee_amount,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    beneficiaryName: row.beneficiary_name,
    status: row.status,
    createdAt: row.created_at,
    receiptUrl: row.receipt_url,
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
export async function findReceipt(args: {
  trustExpressAddress: string;
  takerAddress: string;
  sinceIso: string;
}): Promise<ReceiptRecord | null> {
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("trust_express_address", args.trustExpressAddress)
    .eq("taker_address", args.takerAddress)
    .gte("created_at", args.sinceIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Supabase receipts query failed: ${error.message}`);
  return data ? mapRow(data) : null;
}

/** get_receipt -- pull and display a specific receipt by its known reference. */
export async function getReceiptByReference(payoutReference: string): Promise<ReceiptRecord | null> {
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("payout_reference", payoutReference)
    .maybeSingle();

  if (error) throw new Error(`Supabase receipts query failed: ${error.message}`);
  return data ? mapRow(data) : null;
}