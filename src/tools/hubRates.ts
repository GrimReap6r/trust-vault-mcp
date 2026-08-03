// src/tools/hubRates.ts
import { fetchAllOrders } from "./fetchOrders.js";

export interface HubCurrencyRate {
  currency: string;
  // "Buy tokens" tab needs the cheapest open SELL order (lowest price = best for a buyer).
  bestSellOrderRate: number | null;
  sellOrdersOnline: number;
  // "Sell tokens" tab needs the richest open BUY order (highest price = best for a seller).
  bestBuyOrderRate: number | null;
  buyOrdersOnline: number;
}

/**
 * get_trust_vault_hub's data source -- same aggregation TrustExpressPage's
 * tickerItems/availableCurrencies memos already do client-side (buyMap vs
 * sellMap by escrowType), just grouped by currency only rather than
 * currency+mint, since the hub's homepage shows one row per currency.
 */
export async function getHubRates(): Promise<HubCurrencyRate[]> {
  const orders = await fetchAllOrders();
  const byCurrency = new Map<string, HubCurrencyRate>();

  for (const o of orders) {
    if (o.amount <= 0 || o.reservationsUsed >= o.reservationsMax) continue;
    const entry = byCurrency.get(o.currency) ?? {
      currency: o.currency,
      bestSellOrderRate: null,
      sellOrdersOnline: 0,
      bestBuyOrderRate: null,
      buyOrdersOnline: 0,
    };

    if (o.orderType === "sell") {
      entry.sellOrdersOnline += 1;
      entry.bestSellOrderRate =
        entry.bestSellOrderRate === null ? o.pricePerToken : Math.min(entry.bestSellOrderRate, o.pricePerToken);
    } else {
      entry.buyOrdersOnline += 1;
      entry.bestBuyOrderRate =
        entry.bestBuyOrderRate === null ? o.pricePerToken : Math.max(entry.bestBuyOrderRate, o.pricePerToken);
    }

    byCurrency.set(o.currency, entry);
  }

  return Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** Best single order for a currency+side -- used by the hub's Buy/Sell forms
 * to resolve an orderAddress once the person picks a currency and amount.
 * "Best" mirrors marketData.ts's getMarketRates: lowest price for a sell
 * order (cheapest for the buyer), highest price for a buy order (richest
 * for the seller). */
export async function findBestOrder(args: { orderType: "buy" | "sell"; currency: string }) {
  const orders = await fetchAllOrders();
  const candidates = orders.filter(
    (o) =>
      o.orderType === args.orderType &&
      o.currency === args.currency.toUpperCase() &&
      o.amount > 0 &&
      o.reservationsUsed < o.reservationsMax
  );
  if (candidates.length === 0) return { found: false as const };

  const best =
    args.orderType === "sell"
      ? candidates.reduce((a, b) => (b.pricePerToken < a.pricePerToken ? b : a))
      : candidates.reduce((a, b) => (b.pricePerToken > a.pricePerToken ? b : a));

  return {
    found: true as const,
    orderAddress: best.orderAddress,
    pricePerToken: best.pricePerToken,
    availableAmount: best.amount,
    currency: best.currency,
  };
}