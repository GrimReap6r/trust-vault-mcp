import { getProgram } from "../program.js";
import { decodeCurrency, decodeEscrowType, toDisplayAmount, truncatePda } from "../helpers.js";
import { getDecimalsForMint } from "./tokenRegistry.js";
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
 *
 * escrow_type is decoded via the EXPRESS_SELL/EXPRESS_BUY constants in
 * helpers.ts, NOT via the IDL -- confirmed against state/express.rs that
 * this field is a plain u8, not an Anchor enum, so there's no IDL type to
 * read. (This is why the IDL-lookup version of this file threw on every
 * order -- it was asking the IDL for a type that can't exist here.)
 */
export async function fetchAllOrders() {
    const program = getProgram();
    // Anchor account namespace name must match the IDL's account name for
    // TrustExpress -- adjust `.trustExpress` below if your IDL casing differs.
    const accounts = await program.account.trustExpress.all();
    return Promise.all(accounts.map(async (entry) => {
        const acc = entry.account;
        const mint = acc.mint.toString();
        const decimals = await getDecimalsForMint(mint);
        return {
            orderAddress: entry.publicKey.toString(),
            orderAddressTruncated: truncatePda(entry.publicKey.toString()),
            orderType: decodeEscrowType(acc.escrowType),
            maker: acc.maker.toString(),
            mint,
            currency: decodeCurrency(acc.currency),
            amount: toDisplayAmount(acc.amount, decimals),
            pricePerToken: Number(acc.pricePerToken),
            reservationsUsed: acc.reservedAmounts.length,
            reservationsMax: 10,
        };
    }));
}
