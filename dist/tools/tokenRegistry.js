import { PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "../program.js";
const mintInfoCache = new Map();
/**
 * Shared owner-detection + getMint() call. Both decimals and the owning
 * token program (legacy vs Token-2022) come from the same account lookup,
 * so this is fetched and cached once per mint instead of being duplicated
 * wherever an instruction needs `tokenProgram` for its accounts object
 * (e.g. create_express_buy_order, instant_reserve).
 */
async function resolveMintInfo(mint) {
    const cached = mintInfoCache.get(mint);
    if (cached !== undefined)
        return cached;
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);
    // getMint() needs to know which token program owns this mint account --
    // it defaults to assuming the legacy Token program, and throws
    // TokenInvalidAccountOwnerError if the account is actually owned by a
    // different program. Mints can legitimately be owned by either the
    // legacy SPL Token program or the newer Token-2022 program, so check the
    // real on-chain owner first instead of assuming. Confirmed via debug
    // script against production: the current open devnet order's mint threw
    // exactly this error under the legacy-only assumption.
    const accountInfo = await connection.getAccountInfo(mintPubkey);
    if (!accountInfo) {
        throw new Error(`Mint account ${mint} not found on-chain via ${connection.rpcEndpoint}. ` +
            `Check SOLANA_RPC_URL is pointed at the same network this order was created on.`);
    }
    const owner = accountInfo.owner;
    let programId;
    if (owner.equals(TOKEN_PROGRAM_ID)) {
        programId = TOKEN_PROGRAM_ID;
    }
    else if (owner.equals(TOKEN_2022_PROGRAM_ID)) {
        programId = TOKEN_2022_PROGRAM_ID;
    }
    else {
        throw new Error(`Mint ${mint} is owned by program ${owner.toString()}, which is neither ` +
            `the legacy Token program (${TOKEN_PROGRAM_ID.toString()}) nor Token-2022 ` +
            `(${TOKEN_2022_PROGRAM_ID.toString()}). Not a recognized token mint.`);
    }
    const mintInfo = await getMint(connection, mintPubkey, "confirmed", programId);
    const result = { decimals: mintInfo.decimals, programId };
    mintInfoCache.set(mint, result);
    return result;
}
export async function getDecimalsForMint(mint) {
    return (await resolveMintInfo(mint)).decimals;
}
/** Which token program (legacy Token vs Token-2022) actually owns this mint
 * -- needed for the `tokenProgram` account on any instruction that touches
 * the mint or an ATA of it (create_express_buy_order, instant_reserve). */
export async function getTokenProgramForMint(mint) {
    return (await resolveMintInfo(mint)).programId;
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
