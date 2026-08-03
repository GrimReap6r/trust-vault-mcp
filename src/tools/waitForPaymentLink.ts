// src/tools/waitForPaymentLink.ts
import { getPaymentLink } from "./paymentLinkLookup.js";

/**
 * bot.ts generates the actual link ASYNCHRONOUSLY after picking up the
 * on-chain reservation event (resolve credential -> call processor API ->
 * store in payment_links) -- it is NOT available the instant
 * reserve_sell_order's transaction confirms. 30s window covers that
 * pipeline with margin.
 */
export async function waitForPaymentLink(args: { payoutReference: string }) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const link = await getPaymentLink(args.payoutReference);
    if (link) return { found: true as const, ...link };
    await new Promise((r) => setTimeout(r, 3000));
  }

  return {
    found: false as const,
    message:
      "Payment link isn't ready yet -- ask again in a moment. The reservation itself " +
      "already landed on-chain; this is just waiting on the link-generation step.",
  };
}