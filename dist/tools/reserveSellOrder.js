// src/tools/reserveSellOrder.ts
import { PublicKey, SystemProgram } from "@solana/web3.js";
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
    const buyer = new PublicKey(args.buyerWallet);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payoutReference = `IS-${nowSeconds}-${args.buyerWallet.slice(0, 8)}`;
    const reference = generateReference();
    storeIntent(reference.toString(), {
        kind: "reserve_sell_order",
        trustExpress: args.orderAddress,
        maker: order.maker,
        buyer: buyer.toString(),
        amountRaw: amountRaw.toString(),
        payoutReference,
    });
    const url = transactionRequestUrl(reference);
    return {
        payoutReference,
        orderAddress: args.orderAddress,
        transactionRequestUrl: url,
        qrCodeDataUri: await qrDataUri(url),
        expiresInSeconds: 300,
        instructions: "Scan this QR (or open the link) with Phantom or Backpack to lock in this reservation. " +
            "A payment link is generated within about 30 seconds after -- call wait_for_payment_link " +
            "with the payoutReference above to fetch it.",
    };
}
