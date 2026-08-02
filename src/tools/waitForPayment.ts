// src/tools/waitForPayment.ts
import { getProgram } from "../program.js";
import { PublicKey } from "@solana/web3.js";
import { findReceipt } from "./receipt.js";

/**
 * wait_for_payment — bounded server-side poll, NOT a proactive push. Call
 * this right after generate_merchant_qr if the merchant wants to wait for
 * confirmation instead of asking again later. Blocks up to ~40s, checking
 * every 4s.
 *
 * SAFETY-CRITICAL correction: an earlier version of this tool reported
 * "settled" as soon as the on-chain reservation disappeared. That's wrong
 * and dangerous -- per submit_validator_vote.rs, both the success path
 * (status 2) and the rejection path remove the reservation entry the same
 * way, so disappearance alone can't distinguish "payment succeeded" from
 * "payment was rejected/refunded." If Claude paraphrased "settled" to a
 * merchant, it could easily read as "the payment landed," which could lead
 * a merchant to hand over goods against a payment that actually failed.
 *
 * The fix: never assert success from on-chain state alone. Disappearance
 * is necessary but NOT sufficient -- only a matching row in the `receipts`
 * table (findReceipt) is treated as a real success signal, since that row
 * is only ever written after Flutterwave verification succeeds, never on
 * rejection. If the reservation is gone but no receipt shows up, this
 * returns "unknown" and says so plainly rather than implying payment.
 *
 * 40s cap is deliberate: long enough to catch most validator-consensus
 * settlements (this project's real trades have settled in well under a
 * minute per earlier logs), short enough to stay under Railway's and
 * Claude's own tool-call timeouts. If it times out, tell the merchant to
 * just ask again -- the reservation isn't lost, it's still in flight.
 */
export async function waitForPayment(args: {
  orderAddress: string;
  trustExpressAddress: string;
  takerWallet: string;
  sinceUnixSeconds: number;
}) {
  const program = getProgram();
  const pubkey = new PublicKey(args.orderAddress);
  const deadline = Date.now() + 40_000;

  while (Date.now() < deadline) {
    const acc = await (program.account as any).trustExpress.fetch(pubkey);
    const stillPending = acc.reservedAmounts.some(
      (r: any) =>
        r.taker.toString() === args.takerWallet &&
        Number(r.timestamp) >= args.sinceUnixSeconds
    );

    if (!stillPending) {
      const receipt = await findReceipt({
        trustExpressAddress: args.trustExpressAddress,
        takerAddress: args.takerWallet,
      });

      if (receipt) {
        return { outcome: "success" as const, receipt };
      }

      // No longer pending on-chain, but no receipt either -- genuinely
      // don't know. Do NOT say "settled" or anything that could read as
      // confirmation of payment.
      return {
        outcome: "unknown" as const,
        message:
          "The reservation is no longer active but I can't confirm whether it succeeded or was rejected/refunded from here. Please check your Trust Vault dashboard or bank app before treating this as paid.",
      };
    }

    await new Promise((r) => setTimeout(r, 4000));
  }

  return {
    outcome: "pending" as const,
    message: "Still pending after 40s -- ask again in a moment, the reservation is still active.",
  };
}