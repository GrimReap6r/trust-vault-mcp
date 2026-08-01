import { getProgram, getIdl } from "../program.js";
import { decodeCurrency, decodeEscrowType, toDisplayAmount, truncatePda } from "../helpers.js";
import { getDecimalsForMint } from "./tokenRegistry.js";

export interface DecodedOrder {
  orderAddress: string; // full PDA
  orderAddressTruncated: string;
  orderType: "sell" | "buy";
  maker: string;
  mint: string;
  currency: string;
  amount: number; // display units -- AVAILABLE only, per program docs
  pricePerToken: number;
  reservationsUsed: number;
  reservationsMax: number;
}

/**
 * Fetches every TrustExpress account and decodes it into display-ready shape.
 * Mirrors the account scan the client's useTrustExpress / merchant-page
 * "best LP" logic already does (trust-vault-program §2.2, trust-vault §15.2).
 *
 * NOTE: `amount` on-chain is NEVER total deposited -- for BUY orders it's
 * amount - active reservations, for SELL orders it's what remains in escrow.
 * That distinction is preserved here, not re-derived, since the on-chain
 * value already reflects it (program docs §2.2, "CRITICAL -- amount field meaning").
 *
 * Token decimals are fetched live per-mint (see tokenRegistry.ts) rather
 * than looked up in a hardcoded table, so this works correctly regardless
 * of which network/deployment SOLANA_RPC_URL points at.
 */
export async function fetchAllOrders(): Promise<DecodedOrder[]> {
  const program = getProgram();
  const idl = getIdl();
  // Anchor account namespace name must match the IDL's account name for
  // TrustExpress -- adjust `.trustExpress` below if your IDL casing differs.
  const accounts = await (program.account as any).trustExpress.all();

  return Promise.all(
    accounts.map(async (entry: any) => {
      const acc = entry.account;
      const mint = acc.mint.toString();
      const decimals = await getDecimalsForMint(mint);
      return {
        orderAddress: entry.publicKey.toString(),
        orderAddressTruncated: truncatePda(entry.publicKey.toString()),
        orderType: decodeEscrowType(idl, acc.escrowType),
        maker: acc.maker.toString(),
        mint,
        currency: decodeCurrency(acc.currency),
        amount: toDisplayAmount(acc.amount, decimals),
        // FLAG (carried over, still unresolved): price_per_token is
        // documented as "fiat per whole token (raw fiat units)" but the
        // scale (whole naira vs kobo, etc.) isn't stated. Passing through
        // RAW here rather than guessing a divisor -- confirm against the
        // client's BuyOrderCard/SellOrderCard display before trusting this
        // for anything money-critical.
        pricePerToken: Number(acc.pricePerToken),
        reservationsUsed: acc.reservedAmounts.length,
        reservationsMax: 10,
      } satisfies DecodedOrder;
    })
  );
}