// src/tools/paymentLinkLookup.ts
import { supabase } from "../supabase.js";
function mapRow(row) {
    return {
        linkUrl: row.link_url,
        status: row.status,
        amount: Number(row.amount),
        currency: row.currency,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at,
        payoutReference: row.payout_reference,
        trustExpressAddress: row.trust_express_address,
        buyerAddress: row.buyer_address,
        sellerAddress: row.seller_address,
        transactionSignature: row.transaction_signature,
    };
}
/**
 * payout_reference is the table's actual primary key (confirmed via
 * Supabase schema) -- direct match, no fallback needed since this server
 * generates the reference itself before the reservation tx is built.
 */
export async function getPaymentLink(payoutReference) {
    const { data, error } = await supabase
        .from("payment_links")
        .select("*")
        .eq("payout_reference", payoutReference)
        .maybeSingle();
    if (error)
        throw new Error(`Supabase payment_links query failed: ${error.message}`);
    return data ? mapRow(data) : null;
}
