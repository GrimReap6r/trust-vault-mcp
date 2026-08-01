import { PublicKey } from "@solana/web3.js";
import { getProgram } from "../program.js";
import { decodeCurrency, decodeEscrowType, decodeReservationStatus, toDisplayAmount, } from "../helpers.js";
/**
 * get_order_status — one RPC call, full order state including embedded
 * reservations. ValidatorVote (votes_for/votes_against/executed) is
 * deliberately NOT fetched here — separate PDA keyed off
 * keccak256(payout_reference), out of scope for phase-1 general-info tools.
 * See /areas/trust-vault.md for that decision.
 */
export async function getOrderStatus(args) {
    const program = getProgram();
    const pubkey = new PublicKey(args.orderAddress);
    const acc = await program.account.trustExpress.fetch(pubkey);
    const mint = acc.mint.toString();
    return {
        orderAddress: args.orderAddress,
        orderType: decodeEscrowType(acc.escrowType),
        maker: acc.maker.toString(),
        mint,
        currency: decodeCurrency(acc.currency),
        // NEVER "total deposited" — see program docs §2.2. BUY: committed minus
        // active reservations. SELL: remaining in escrow.
        availableAmount: toDisplayAmount(acc.amount, mint),
        pricePerToken: Number(acc.pricePerToken), // see FLAG in fetchOrders.ts re: scale
        reservations: acc.reservedAmounts.map((r) => ({
            taker: r.taker.toString(),
            amount: toDisplayAmount(r.amount, mint),
            fiatAmount: Number(r.fiatAmount),
            status: decodeReservationStatus(r.status),
            timestamp: new Date(Number(r.timestamp) * 1000).toISOString(),
            paymentMode: r.paymentMode === 0 ? "payment_link" : "direct_transfer",
        })),
    };
}
