// src/tools/reserveSellOrder.ts
import { SystemProgram } from "@solana/web3.js";
import { fetchAllOrders } from "./fetchOrders.js";
import { getDecimalsForMint } from "./tokenRegistry.js";
import { deriveGlobalStatePda } from "./prepareOrder.js";
import { generateReference, transactionRequestUrl, qrDataUri } from "../solanaPay.js";
import { storeIntent } from "../paymentIntents.js";
export function buildInstantSellReserveAccounts(args) {
    return {
        trustExpress: args.trustExpress,
        maker: args.maker,
        buyer: args.buyer,
        globalState: deriveGlobalStatePda(),
        systemProgram: SystemProgram.programId,
    };
}
/**
 * reserve_sell_order -- NO buyerWallet argument anymore.
 *
 * The whole point of the Solana Pay transaction-request flow (server.ts's
 * POST /pay/:reference) is that the wallet identifies itself when it scans:
 * `const walletPubkey = new PublicKey(req.body.account)`. That's what
 * buildInstantSellReserveAccounts's `buyer` comes from -- NOT from anything
 * stored on the intent. Asking chat for the wallet before the QR was even
 * shown was a chicken-and-egg dead end: the value got collected, stored on
 * the intent as `buyer`, and then never read again (confirmed against
 * server.ts's reserve_sell_order branch -- it passes `buyer: walletPubkey`
 * from the POST body, not `intent.buyer`). Removed the argument and the
 * dead intent field along with it.
 *
 * This now mirrors generate_merchant_qr's shape exactly: show a QR, let the
 * wallet reveal itself on scan, no upfront identity required.
 *
 * payoutReference used to be derived from the buyer's wallet prefix
 * (`args.buyerWallet.slice(0, 8)`), which obviously can't work anymore --
 * there's no buyer wallet at call time. Uses the Solana Pay `reference`
 * keypair's own pubkey prefix instead: already generated per call, already
 * unique, no new state needed.
 *
 * fiatAmount/currency/supabase creds/publicBaseUrl are now echoed back the
 * same way merchantQr.ts does, so the reservation card can (a) display an
 * amount and (b) open its own Supabase Realtime subscription on `receipts`
 * filtered by trustExpress address + fiat amount + currency -- the exact
 * same no-taker-wallet-needed pattern receiptByOrder.ts already uses for
 * the merchant card's "Check now" fallback and Realtime filter.
 */
export async function reserveSellOrder(args) {
    const orders = await fetchAllOrders();
    const order = orders.find((o) => o.orderAddress === args.orderAddress);
    if (!order)
        throw new Error(`No order found at ${args.orderAddress}.`);
    if (order.orderType !== "sell") {
        throw new Error(`${args.orderAddress} is a ${order.orderType} order -- reserve_sell_order only works against sell orders.`);
    }
    if (args.amount > order.amount) {
        throw new Error(`Requested ${args.amount} exceeds the ${order.amount} available on this order.`);
    }
    const decimals = await getDecimalsForMint(order.mint);
    const amountRaw = BigInt(Math.round(args.amount * 10 ** decimals));
    const fiatAmount = args.amount * order.pricePerToken; // same open scale caveat as elsewhere (fetchOrders.ts FLAG)
    const reference = generateReference();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payoutReference = `IS-${nowSeconds}-${reference.toString().slice(0, 8)}`;
    storeIntent(reference.toString(), {
        kind: "reserve_sell_order",
        trustExpress: args.orderAddress,
        maker: order.maker,
        amountRaw: amountRaw.toString(),
        payoutReference,
    });
    const url = transactionRequestUrl(reference);
    return {
        payoutReference,
        orderAddress: args.orderAddress,
        tokenAmount: args.amount,
        fiatAmount,
        currency: order.currency,
        transactionRequestUrl: url,
        qrCodeDataUri: await qrDataUri(url),
        expiresInSeconds: 300,
        instructions: "Scan this QR (or open the link) with Phantom or Backpack to lock in this reservation -- " +
            "nothing to provide up front, your wallet identifies itself the moment you sign. A payment " +
            "link appears automatically within about 30 seconds after.",
        // Below: same purpose as merchantQr.ts's identical fields -- lets the
        // reservation card open its own Realtime subscription and build a
        // receipt link, without any tool call needing a taker wallet.
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        publicBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
    };
}
