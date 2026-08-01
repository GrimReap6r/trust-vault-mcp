import { fetchAllOrders } from "./fetchOrders.js";
import { SUPPORTED_MINTS } from "../constants.js";
function mintForSymbol(symbol) {
    return SUPPORTED_MINTS.find((m) => m.symbol.toUpperCase() === symbol.toUpperCase())?.mint;
}
/**
 * get_market_rates — best available BUY-order rate per token/currency.
 * Mirrors merchant page "best LP" selection (trust-vault skill §15.2):
 * escrow_type=1 (BUY), currency match, amount > 0, reservations < 10,
 * highest price_per_token wins.
 */
export async function getMarketRates(args) {
    const orders = await fetchAllOrders();
    const mint = args.token ? mintForSymbol(args.token) : undefined;
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
        token: SUPPORTED_MINTS.find((m) => m.mint === best.mint)?.symbol ?? best.mint,
        currency: best.currency,
        pricePerToken: best.pricePerToken,
        bestLpOrderAddress: best.orderAddressTruncated,
    };
}
/**
 * list_open_orders — filtered listing of open buy/sell orders.
 */
export async function listOpenOrders(args) {
    const orders = await fetchAllOrders();
    const mint = args.token ? mintForSymbol(args.token) : undefined;
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
        orderAddress: o.orderAddressTruncated,
        orderType: o.orderType,
        token: SUPPORTED_MINTS.find((m) => m.mint === o.mint)?.symbol ?? o.mint,
        currency: o.currency,
        pricePerToken: o.pricePerToken,
        availableAmount: o.amount,
        reservationSlotsUsed: o.reservationsUsed,
        reservationSlotsMax: o.reservationsMax,
    }));
}
