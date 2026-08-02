// src/tools/merchantQr.ts
//
// v4 — added `publicBaseUrl` to the return shape so merchantQrCard.html can
// build the receipt link itself (`${publicBaseUrl}/receipts/${row.id}`).
// The `receipts` table's `receipt_url` column is never written by the
// settlement bot (verified null on a real successful payout row), and
// page.tsx doesn't read that column either — it builds the link the same
// way, from the receipt row's own `id`. Reusing APP_URL (already loaded
// below and required to be set) keeps this consistent with
// sendReceiptNotification()'s Discord receipt link, which uses the same
// env var.
//
// v3 — MCP App version. Behavior is the same as v2 (finds best available
// BUY order, builds the instant-reserve URL behind a short /qr/:id proxy
// link for scan reliability — see qrProxy.ts's doc comment, unchanged).
// What's new: the return shape now carries everything registerMerchantQrApp.ts's
// structuredContent needs to render the card directly, instead of the model
// having to re-describe fields in prose or the user having to ask for a
// downloadable image separately. qrCodeDataUri is embedded inline (already
// existed on this tool, just wasn't previously surfaced to a UI).
import { fetchAllOrders } from "./fetchOrders.js";
import { qrDataUri } from "../solanaPay.js";
import { registerShortLink } from "../qrProxy.js";

export interface MerchantBankPayoutDetails {
  accountNumber: string;
  bankCode: string;
  bankName: string;
  beneficiaryName: string;
}

export async function generateMerchantQr(args: {
  fiatAmount: number;
  currency: string;
  payoutDetails: MerchantBankPayoutDetails;
}) {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
  if (!APP_URL) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set on this MCP server. It needs to match the " +
        "same value your Next.js app uses, since this tool builds a URL pointing " +
        "at that app's /api/solana-pay/instant-reserve route."
    );
  }

  const orders = await fetchAllOrders();
  const candidates = orders.filter(
    (o) =>
      o.orderType === "buy" &&
      o.amount > 0 &&
      o.reservationsUsed < o.reservationsMax &&
      o.currency === args.currency.toUpperCase()
  );

  if (candidates.length === 0) {
    return { found: false as const, message: `No available liquidity for ${args.currency} right now.` };
  }

  const best = candidates.reduce((a, b) => (b.pricePerToken > a.pricePerToken ? b : a));
  const tokenAmount = args.fiatAmount / best.pricePerToken; // display hint only — POST route derives its own raw amount

  const apiUrl = new URL("/api/solana-pay/instant-reserve", APP_URL);
  apiUrl.searchParams.set("trustExpressAddress", best.orderAddress);
  apiUrl.searchParams.set("tokenAmount", tokenAmount.toString());
  apiUrl.searchParams.set("fiatAmount", args.fiatAmount.toString());
  apiUrl.searchParams.set("currency", args.currency.toUpperCase());
  apiUrl.searchParams.set(
    "payoutDetails",
    JSON.stringify({
      type: "bank_transfer",
      account_number: args.payoutDetails.accountNumber,
      bank_code: args.payoutDetails.bankCode,
      bank_name: args.payoutDetails.bankName,
      beneficiary_name: args.payoutDetails.beneficiaryName,
    })
  );
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
  const cluster = rpcUrl.includes("devnet") ? "devnet" : rpcUrl.includes("mainnet") ? "mainnet-beta" : "devnet";
  apiUrl.searchParams.set("cluster", cluster);

  const id = registerShortLink(apiUrl.toString());
  const shortUrl = `${process.env.PUBLIC_BASE_URL}/qr/${id}`;
  const solanaPayUrl = `solana:${encodeURIComponent(shortUrl)}`;

  return {
    found: true as const,
    orderAddress: best.orderAddress,
    pricePerToken: best.pricePerToken,
    tokenAmount,
    fiatAmount: args.fiatAmount,
    currency: args.currency.toUpperCase(),
    payoutDetails: args.payoutDetails, // echoed back so the card can render it directly
    transactionRequestUrl: solanaPayUrl,
    qrCodeDataUri: await qrDataUri(solanaPayUrl),
    instructions: "Scan this QR (or open the link) with Phantom or Backpack to pay.",
    // Public/anon-scoped only — same key page.tsx already ships to the
    // browser (RLS restricts it to SELECT on receipts, see supabase.ts).
    // Lets the card subscribe to receipt INSERTs directly, the same way
    // the merchant page does, instead of polling a tool for a taker wallet.
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    // NEW (v4) — lets merchantQrCard.html build the receipt link itself
    // (`${publicBaseUrl}/receipts/${row.id}`) once a receipt row arrives
    // over Realtime, instead of relying on the never-populated
    // receipts.receipt_url column. Same env var Discord's receipt link
    // already uses, so the QR card's link points at the same domain/route.
    publicBaseUrl: APP_URL,
  };
}