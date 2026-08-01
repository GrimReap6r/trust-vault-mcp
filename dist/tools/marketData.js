import { fetchAllOrders } from "./fetchOrders.js";
import { normalizeMintFilter, getDecimalsForMint } from "./tokenRegistry.js";
/**
 * Replaces the old get_supported_tokens, which returned a hardcoded
 * SUPPORTED_MINTS table (mainnet USDC/USDT addresses) regardless of what
 * was actually tradeable on whatever network the server was pointed at.
 * This derives the answer from live orders instead: whichever mints
 * currently have an open order ARE, by definition, the tokens actually
 * being traded on this deployment right now.
 */
export async function listKnownTokens() {
    const orders = await fetchAllOrders();
    const distinctMints = [...new Set(orders.map((o) => o.mint))];
    return Promise.all(distinctMints.map(async (mint) => ({
        mint,
        decimals: await getDecimalsForMint(mint),
    })));
}
/**
 * get_market_rates -- best available BUY-order rate per token/currency.
 * Mirrors merchant page "best LP" selection (trust-vault skill §15.2):
 * escrow_type=1 (BUY), currency match, amount > 0, reservations < 10,
 * highest price_per_token wins.
 *
 * `token` now expects a mint ADDRESS, not a symbol like "USDC" -- there's
 * no hardcoded symbol table anymore (see tokenRegistry.ts). Use
 * list_open_orders with no filter to see which mints currently have
 * liquidity.
 */
export async function getMarketRates(args) {
    const orders = await fetchAllOrders();
    const mint = normalizeMintFilter(args.token);
    const candidates = orders.filter((o) => {
        if (o.orderType !== "buy")
            return false;
        if (o.amount <= 0)
            return false;
        if (o.reservationsUsed >= o.reservationsMax)
            return false;
        if (args.currency && o.currency !== args.currency.toUpperCase())
            return false;
        if (mint && o.mint !== mint)
            return false;
        return true;
    });
    if (candidates.length === 0) {
        return { found: false, message: "No matching liquidity found for that token/currency pair." };
    }
    const best = candidates.reduce((a, b) => (b.pricePerToken > a.pricePerToken ? b : a));
    return {
        found: true,
        tokenMint: best.mint,
        currency: best.currency,
        pricePerToken: best.pricePerToken,
        // Full address included so this can be passed straight into
        // get_order_status without a separate lookup -- bestLpOrderAddress
        // (truncated) kept for display/back-compat.
        bestLpOrderAddress: best.orderAddressTruncated,
        bestLpOrderAddressFull: best.orderAddress,
    };
}
/**
 * list_open_orders -- filtered listing of open buy/sell orders.
 */
export async function listOpenOrders(args) {
    const orders = await fetchAllOrders();
    const mint = normalizeMintFilter(args.token);
    const filtered = orders.filter((o) => {
        if (args.orderType && o.orderType !== args.orderType)
            return false;
        if (args.currency && o.currency !== args.currency.toUpperCase())
            return false;
        if (mint && o.mint !== mint)
            return false;
        return o.amount > 0; // only show orders with something available
    });
    return filtered.map((o) => ({
        // Full address, not just the truncated display form -- callers (this
        // MCP server included, via get_order_status) need the real PDA to look
        // an order up further. Truncated form kept alongside for display.
        orderAddress: o.orderAddress,
        orderAddressDisplay: o.orderAddressTruncated,
        orderType: o.orderType,
        tokenMint: o.mint,
        currency: o.currency,
        pricePerToken: o.pricePerToken,
        availableAmount: o.amount,
        reservationSlotsUsed: o.reservationsUsed,
        reservationSlotsMax: o.reservationsMax,
    }));
}
