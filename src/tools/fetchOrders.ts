import { getProgram } from "../program.js";
import { decodeCurrency, decodeEscrowType, toDisplayAmount, truncatePda } from "../helpers.js";

export interface DecodedOrder {
  orderAddress: string; // full PDA
  orderAddressTruncated: string;
  orderType: "sell" | "buy";
  maker: string;
  mint: string;
  currency: string;
  amount: number; // display units — AVAILABLE only, per program docs
  pricePerToken: number;
  reservationsUsed: number;
  reservationsMax: number;
}

/**
 * Fetches every TrustExpress account and decodes it into display-ready shape.
 * Mirrors the account scan the client's useTrustExpress / merchant-page
 * "best LP" logic already does (trust-vault-program §2.2, trust-vault §15.2).
 *
 * NOTE: `amount` on-chain is NEVER total deposited — for BUY orders it's
 * amount - active reservations, for SELL orders it's what remains in escrow.
 * That distinction is preserved here, not re-derived, since the on-chain
 * value already reflects it (program docs §2.2, "CRITICAL — amount field meaning").
 */
export async function fetchAllOrders(): Promise<DecodedOrder[]> {
  const program = getProgram();
  // Anchor account namespace name must match the IDL's account name for
  // TrustExpress — adjust `.trustExpress` below if your IDL casing differs.
  const accounts = await (program.account as any).trustExpress.all();

  return accounts.map((entry: any) => {
    const acc = entry.account;
    const mint = acc.mint.toString();
    return {
      orderAddress: entry.publicKey.toString(),
      orderAddressTruncated: truncatePda(entry.publicKey.toString()),
      orderType: decodeEscrowType(acc.escrowType),
      maker: acc.maker.toString(),
      mint,
      currency: decodeCurrency(acc.currency),
      amount: toDisplayAmount(acc.amount, mint),
      // FLAG: price_per_token is documented as "fiat per whole token (raw
      // fiat units)" (program skill §2.2) but the skill doesn't state the
      // scale — e.g. whether NGN is stored as whole naira or as the smallest
      // unit (kobo, x100). Passing it through RAW here rather than guessing
      // a divisor. Confirm the actual scale against how the client displays
      // it (BuyOrderCard/SellOrderCard) before shipping this tool, and fix
      // this one line — everything downstream reads from this field.
      pricePerToken: Number(acc.pricePerToken),
      reservationsUsed: acc.reservedAmounts.length,
      reservationsMax: 10,
    } satisfies DecodedOrder;
  });
}
