/** currency: [u8; 3] on-chain -> "NGN" */
export function decodeCurrency(bytes: number[] | Uint8Array): string {
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
const ESCROW_TYPE: Record<number, "sell" | "buy"> = { 0: "sell", 1: "buy" };

export function decodeEscrowType(escrowType: number): "sell" | "buy" {
  const val = ESCROW_TYPE[escrowType];
  if (!val) {
    throw new Error(
      `Unexpected escrow_type value ${escrowType} -- expected 0 (sell) or 1 (buy) ` +
        `per EXPRESS_SELL/EXPRESS_BUY in state/express.rs. If the program added a ` +
        `new variant, update ESCROW_TYPE in helpers.ts to match.`
    );
  }
  return val;
}

/**
 * ReservedAmount.status is also a plain `u8` (see state/reservation.rs) --
 * same shape as escrow_type, no Anchor enum, so nothing for the IDL to
 * export. Unlike escrow_type, we don't yet have the Rust source that
 * defines the numeric mapping (pending/payment_sent/completed/cancelled/
 * disputed) -- that likely lives in an instruction handler (reserve.rs,
 * confirm_payment.rs, dispute.rs, or similar) that hasn't been shared yet.
 *
 * Guessing that mapping is exactly the risk this codebase has been
 * deliberately avoiding elsewhere (a "disputed" reservation silently
 * reported as "completed" is worse than an ugly number). So for now this
 * surfaces the raw numeric status, clearly labeled as unresolved, rather
 * than blocking every order/order-status call on it the way the old
 * IDL-lookup did. Once the real constants are confirmed, replace this with
 * the same pattern as decodeEscrowType above.
 */
export function decodeReservationStatus(status: number): { code: number; label: string } {
  return { code: status, label: `unmapped_status_${status}` };
}

export function toDisplayAmount(rawAmount: bigint | number, decimals: number): number {
  const raw = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount);
  return Number(raw) / 10 ** decimals;
}

/** Truncated PDA display format used throughout the client: "EWkT…jQr7" */
export function truncatePda(pda: string): string {
  if (pda.length <= 10) return pda;
  return `${pda.slice(0, 4)}…${pda.slice(-4)}`;
}