// src/tools/reserveBuyOrder.ts
import { fetchAllOrders } from "./fetchOrders.js";
import { qrDataUri, generateReference } from "../solanaPay.js";
import { registerShortLink, SHORT_LINK_TTL_MS } from "../qrProxy.js";
/**
 * reserve_buy_order -- a token holder selling into an open BUY order.
 *
 * CORRECTED (v2): the first version of this tool built the instant_reserve
 * transaction itself, server-side, inside this MCP server's own POST
 * /pay/:reference handler via program.methods.instantReserve(...). That
 * failed in-wallet with "Invalid data from the payment provider" -- the
 * arg order/names for instant_reserve were flagged as unconfirmed at the
 * time (unlike instant_sell_reserve, which WAS cross-checked directly
 * against submit_validator_vote.rs and does work).
 *
 * generate_merchant_qr already calls this exact same on-chain instruction
 * successfully -- but it does so by pointing the QR at the Next.js app's
 * own /api/solana-pay/instant-reserve route, not by building the
 * transaction in this server. That route is the one place instant_reserve
 * is actually implemented correctly. The only thing that differs between
 * the merchant flow and this one is WHO generates the QR and whose bank
 * account ends up in payoutDetails (the merchant's vs. the seller's own)
 * -- the API call itself is identical, so this now delegates to it the
 * same way merchantQr.ts does, via the same short-link QR proxy, instead
 * of re-implementing the instruction a second time.
 *
 * One consequence: unlike reserve_sell_order, there's no payoutReference
 * returned here -- it's generated on-chain inside instant_reserve's own
 * handler once the wallet signs (same reason paymentLinkLookup.ts/
 * receipt.ts note that payout_reference "isn't known to this server until
 * after the customer's wallet generates it on-chain"). Success detection
 * for this flow was already built around orderAddress + fiatAmount +
 * currency (getReceiptByOrder), not payoutReference, so nothing downstream
 * needed to change.
 */
export async function reserveBuyOrder(args) {
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    if (!APP_URL) {
        throw new Error("NEXT_PUBLIC_APP_URL is not set on this MCP server. reserve_buy_order builds a URL " +
            "pointing at that app's /api/solana-pay/instant-reserve route -- the same one " +
            "generate_merchant_qr already uses successfully.");
    }
    const orders = await fetchAllOrders();
    const order = orders.find((o) => o.orderAddress === args.orderAddress);
    if (!order)
        throw new Error(`No order found at ${args.orderAddress}.`);
    if (order.orderType !== "buy") {
        throw new Error(`${args.orderAddress} is a ${order.orderType} order -- reserve_buy_order only works against buy orders.`);
    }
    if (args.amount > order.amount) {
        throw new Error(`Requested ${args.amount} exceeds the ${order.amount} available on this order.`);
    }
    const fiatAmount = args.amount * order.pricePerToken;
    const reference = generateReference();
    const apiUrl = new URL("/api/solana-pay/instant-reserve", APP_URL);
    apiUrl.searchParams.set("trustExpressAddress", args.orderAddress);
    apiUrl.searchParams.set("tokenAmount", args.amount.toString());
    apiUrl.searchParams.set("fiatAmount", fiatAmount.toString());
    apiUrl.searchParams.set("currency", order.currency);
    apiUrl.searchParams.set("reference", reference.toString());
    apiUrl.searchParams.set("payoutDetails", JSON.stringify({
        type: "bank_transfer",
        account_number: args.payoutDetails.accountNumber,
        bank_code: args.payoutDetails.bankCode,
        bank_name: args.payoutDetails.bankName,
        beneficiary_name: args.payoutDetails.beneficiaryName,
    }));
    const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
    const cluster = rpcUrl.includes("devnet") ? "devnet" : rpcUrl.includes("mainnet") ? "mainnet-beta" : "devnet";
    apiUrl.searchParams.set("cluster", cluster);
    // Same short-link QR proxy generate_merchant_qr uses -- keeps the QR
    // itself small regardless of how much the real request needs, and gives
    // us a checkoutPageUrl fallback for desktop (see checkoutPage.ts).
    const id = registerShortLink(apiUrl.toString());
    const shortUrl = `${process.env.PUBLIC_BASE_URL}/qr/${id}`;
    const solanaPayUrl = `solana:${encodeURIComponent(shortUrl)}`;
    return {
        orderAddress: args.orderAddress,
        tokenAmount: args.amount,
        fiatAmount,
        currency: order.currency,
        payoutDetails: args.payoutDetails,
        transactionRequestUrl: solanaPayUrl,
        // NEW — see merchantQr.ts's matching field: lets resolve_reservation_signer
        // recover the actual signer wallet once the transaction lands.
        reference: reference.toString(),
        checkoutPageUrl: `${process.env.PUBLIC_BASE_URL}/checkout/${id}`,
        qrCodeDataUri: await qrDataUri(solanaPayUrl),
        expiresInSeconds: Math.floor(SHORT_LINK_TTL_MS / 1000),
        instructions: `Scan this QR (or open the link) with Phantom or Backpack to sign -- this moves ${args.amount} ` +
            "tokens into escrow immediately on approval. Fiat pays out automatically to the bank account " +
            "you provided, no separate payment step needed.",
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        publicBaseUrl: APP_URL,
    };
}
