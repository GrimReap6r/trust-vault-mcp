// src/paymentIntents.ts
// In-memory intent store keyed by the Solana Pay `reference` pubkey.
// IMPORTANT: this is intentionally NOT persistent. If this process restarts
// between QR generation and the wallet scanning it, the intent is lost and
// the POST handler 404s. Fine for a v1/testing pass — for production, move
// this to Redis/Postgres with a TTL (these intents should expire after a
// few minutes anyway, same as your existing payment-link flow).
const intents = new Map();
const TTL_MS = 5 * 60 * 1000; // 5 minutes
export function storeIntent(reference, intent) {
    intents.set(reference, intent);
    setTimeout(() => intents.delete(reference), TTL_MS).unref();
}
export function getIntent(reference) {
    return intents.get(reference);
}
