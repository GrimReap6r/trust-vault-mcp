// src/paymentIntents.ts
// In-memory intent store keyed by the Solana Pay `reference` pubkey.
// IMPORTANT: this is intentionally NOT persistent. If this process restarts
// between QR generation and the wallet scanning it, the intent is lost and
// the POST handler 404s. Fine for a v1/testing pass — for production, move
// this to Redis/Postgres with a TTL (these intents should expire after a
// few minutes anyway, same as your existing payment-link flow).

export type PendingIntent =
  | {
      kind: "create_buy_order";
      buyer: string; // base58 pubkey — the wallet that will sign
      seed: string; // stringified u64
      mint: string;
      amountRaw: string; // stringified u64, already in raw token units
      pricePerToken: string; // stringified u64, raw fiat units
      currency: string;
      paymentInstructions: string;
      credentialId: string | null;
    }
  | {
      kind: "create_sell_order";
      seller: string; // base58 pubkey — the wallet that will sign
      seed: string; // stringified u64
      mint: string;
      amountRaw: string; // stringified u64, raw token units -- the deposit amount
      pricePerToken: string; // stringified u64, raw fiat units
      currency: string;
      paymentInstructions: string;
      credentialId: string; // no longer optional -- gated by findActiveCredential now
    }
  // NOTE: reserve_against_buy_order used to be a kind here. Removed --
  // reserve_buy_order (tools/reserveBuyOrder.ts) no longer builds that
  // transaction in this server at all. It delegates to the Next.js app's
  // own /api/solana-pay/instant-reserve route via the qrProxy short-link
  // mechanism, same as generate_merchant_qr already does -- so there's no
  // intent to store for this flow anymore. See reserveBuyOrder.ts's doc
  // comment: the version that built the transaction here used unconfirmed
  // instant_reserve args and failed in-wallet with "Invalid data from the
  // payment provider."
  | {
      kind: "reserve_sell_order";
      trustExpress: string;
      maker: string;
      // NOTE: no `buyer` field. The wallet identifies itself at scan time
      // via POST /pay/:reference's req.body.account -- see
      // tools/reserveSellOrder.ts's doc comment. Storing a buyer here would
      // just be dead data, same as the old buyerWallet chat argument was.
      amountRaw: string;
      payoutReference: string;
    };

const intents = new Map<string, PendingIntent>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export function storeIntent(reference: string, intent: PendingIntent) {
  intents.set(reference, intent);
  setTimeout(() => intents.delete(reference), TTL_MS).unref();
}

export function getIntent(reference: string): PendingIntent | undefined {
  return intents.get(reference);
}