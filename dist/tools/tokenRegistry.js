import { PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { getConnection } from "../program.js";
/**
 * Replaces the old hardcoded SUPPORTED_MINTS table. Decimals are fetched
 * directly from each mint's on-chain account (the actual source of truth)
 * and cached in-process, instead of being duplicated in a static list that
 * can silently drift from whatever network/deployment the server is
 * actually pointed at.
 *
 * There is deliberately no "symbol" concept here (no USDC/USDT label).
 * Resolving a mint address to a human-readable ticker requires either an
 * external token list or on-chain metadata (Metaplex token metadata), both
 * of which are additional trust/config surfaces of their own. Per product
 * decision, tools now surface the raw mint address instead of guessing or
 * re-introducing a hardcoded symbol table.
 */
const decimalsCache = new Map();
export async function getDecimalsForMint(mint) {
    const cached = decimalsCache.get(mint);
    if (cached !== undefined)
        return cached;
    const connection = getConnection();
    const mintInfo = await getMint(connection, new PublicKey(mint));
    decimalsCache.set(mint, mintInfo.decimals);
    return mintInfo.decimals;
}
/**
 * The `token` argument on get_market_rates / list_open_orders used to
 * accept a symbol like "USDC" and resolve it via SUPPORTED_MINTS. With no
 * static symbol table, tools now expect the actual mint address instead.
 * This just normalizes/validates that input rather than doing a symbol
 * lookup — kept as a named function so the intent is clear at call sites
 * and so validation logic has one place to live if it needs to change.
 */
export function normalizeMintFilter(token) {
    if (!token)
        return undefined;
    try {
        // Throws if not a valid base58 public key — i.e. not a real mint address.
        new PublicKey(token);
        return token;
    }
    catch {
        throw new Error(`"${token}" is not a valid mint address. This server no longer maps ` +
            `symbols like "USDC" to addresses (see src/tools/tokenRegistry.ts) — ` +
            `pass the token's actual mint address instead. Use list_open_orders ` +
            `with no token filter to see which mints currently have open orders.`);
    }
}
