// src/tools/merchantQr.ts
import { fetchAllOrders } from "./fetchOrders.js";
import { qrDataUri } from "../solanaPay.js"; // keep the QR-encoding helper, drop the rest
export async function generateMerchantQr(args) {
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    if (!APP_URL) {
        throw new Error("NEXT_PUBLIC_APP_URL is not set on this MCP server. It needs to match the " +
            "same value your Next.js app uses, since this tool builds a URL pointing " +
            "at that app's /api/solana-pay/instant-reserve route.");
    }
    const orders = await fetchAllOrders();
    const candidates = orders.filter((o) => o.orderType === "buy" &&
        o.amount > 0 &&
        o.reservationsUsed < o.reservationsMax &&
        o.currency === args.currency.toUpperCase());
    if (candidates.length === 0) {
        return { found: false, message: `No available liquidity for ${args.currency} right now.` };
    }
    const best = candidates.reduce((a, b) => (b.pricePerToken > a.pricePerToken ? b : a));
    const tokenAmount = args.fiatAmount / best.pricePerToken; // display hint only — POST route derives its own raw amount
    const apiUrl = new URL("/api/solana-pay/instant-reserve", APP_URL);
    apiUrl.searchParams.set("trustExpressAddress", best.orderAddress);
    apiUrl.searchParams.set("tokenAmount", tokenAmount.toString());
    apiUrl.searchParams.set("fiatAmount", args.fiatAmount.toString());
    apiUrl.searchParams.set("currency", args.currency.toUpperCase());
    apiUrl.searchParams.set("payoutDetails", JSON.stringify({
        type: "bank_transfer",
        account_number: args.payoutDetails.accountNumber,
        bank_code: args.payoutDetails.bankCode,
        bank_name: args.payoutDetails.bankName,
        beneficiary_name: args.payoutDetails.beneficiaryName,
    }));
    // Same cluster-detection logic as page.tsx, mirrored here rather than
    // guessed, so this tool stays consistent if you add mainnet.
    const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
    const cluster = rpcUrl.includes("devnet") ? "devnet" : rpcUrl.includes("mainnet") ? "mainnet-beta" : "devnet";
    apiUrl.searchParams.set("cluster", cluster);
    const solanaPayUrl = `solana:${encodeURIComponent(apiUrl.toString())}`;
    return {
        found: true,
        orderAddress: best.orderAddress,
        pricePerToken: best.pricePerToken,
        tokenAmount,
        transactionRequestUrl: solanaPayUrl,
        qrCodeDataUri: await qrDataUri(solanaPayUrl),
        instructions: "Scan this QR (or open the link) with Phantom or Backpack to pay.",
    };
}
