/** currency: [u8; 3] on-chain -> "NGN" */
export function decodeCurrency(bytes) {
    return Buffer.from(bytes).toString("utf-8");
}
/**
 * escrow_type is a plain `u8` on the TrustExpress account -- NOT an Anchor
 * enum. Confirmed against state/express.rs:
 *
 *   pub const EXPRESS_SELL: u8 = 0;
 *   pub const EXPRESS_BUY: u8 = 1;
 *
 * Anchor never emits an IDL `enum` type for this because there isn't one in
 * the Rust source to emit -- the previous getEnumVariants(idl, "EscrowType")
 * approach was reading a type that can never exist for this field, which is
 * why it threw on every single order. This mirrors the real constants
 * instead of asking the IDL for something it doesn't have.
 */
const ESCROW_TYPE = { 0: "sell", 1: "buy" };
export function decodeEscrowType(escrowType) {
    const val = ESCROW_TYPE[escrowType];
    if (!val) {
        throw new Error(`Unexpected escrow_type value ${escrowType} -- expected 0 (sell) or 1 (buy) ` +
            `per EXPRESS_SELL/EXPRESS_BUY in state/express.rs. If the program added a ` +
            `new variant, update ESCROW_TYPE in helpers.ts to match.`);
    }
    return val;
}
/**
 * ReservedAmount.status is a plain `u8` (see state/reservation.rs), no IDL
 * enum to read -- same shape as escrow_type above. Confirmed directly
 * against instructions/submit_validator_vote.rs:
 *
 *   0 -- set at creation, in both instant_reserve.rs and
 *        instant_sell_reserve.rs ("Pending payment")
 *   2 -- set in submit_validator_vote's handler ONLY on the
 *        execute_success branch (quorum reached + evidence confirmed),
 *        immediately before fee split/payout
 *   3 -- set in finalize_expired_vote, the 30-minute-timeout refund path
 *        when quorum was never reached
 *
 * Status 1 is NOT assigned anywhere in submit_validator_vote.rs. There is
 * also no "disputed" status set anywhere in that file -- if dispute
 * handling exists, it lives in a dispute.rs not yet reviewed here.
 *
 * IMPORTANT caveat confirmed while cross-checking this: on the REJECTION
 * path (execute_success == false), the program refunds the taker and then
 * calls reserved_amounts.remove(idx) -- the exact same removal used on the
 * success path. No status is ever persisted for a rejected reservation; it
 * just disappears from the array identically to a completed one. That
 * means on-chain state alone can NEVER distinguish "succeeded" from
 * "rejected" once the reservation is gone -- see waitForPayments.ts, which
 * already treats disappearance as necessary-but-not-sufficient and defers
 * to the `receipts` table (written only after off-chain payout
 * verification) as the actual success oracle. Don't be tempted to "fix"
 * that by reading status here -- there is nothing left to read once the
 * entry is removed.
 */
const RESERVATION_STATUS = {
    0: "pending",
    2: "completed",
    3: "expired_refunded",
};
export function decodeReservationStatus(status) {
    const label = RESERVATION_STATUS[status];
    if (!label) {
        // status 1 and anything else has no defined meaning in the program as
        // of submit_validator_vote.rs / finalize_expired_vote -- don't guess,
        // surface it as unmapped so a real new variant doesn't get silently
        // mislabeled the way the old IDL-enum lookup risked.
        return { code: status, label: `unmapped_status_${status}` };
    }
    return { code: status, label };
}
export function toDisplayAmount(rawAmount, decimals) {
    const raw = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount);
    return Number(raw) / 10 ** decimals;
}
/** Truncated PDA display format used throughout the client: "EWkT…jQr7" */
export function truncatePda(pda) {
    if (pda.length <= 10)
        return pda;
    return `${pda.slice(0, 4)}…${pda.slice(-4)}`;
}
