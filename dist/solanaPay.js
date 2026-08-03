// src/solanaPay.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";
import { getConnection } from "./program.js";
const RAW_BASE_URL = process.env.PUBLIC_BASE_URL;
if (!RAW_BASE_URL) {
    throw new Error("PUBLIC_BASE_URL is not set. Set it to this server's bare origin, e.g. " +
        "https://trust-vault-mcp-production.up.railway.app — NOT the /mcp " +
        "connector URL you pasted into Claude.ai's custom-connector field. " +
        "Those are two different endpoints on the same domain.");
}
if (RAW_BASE_URL.endsWith("/mcp") || RAW_BASE_URL.includes("/mcp/")) {
    throw new Error(`PUBLIC_BASE_URL is "${RAW_BASE_URL}", which contains "/mcp" — that's the ` +
        `MCP connector endpoint, not this server's origin. Every QR this server ` +
        `generates will 404 when scanned. Set PUBLIC_BASE_URL to the bare origin ` +
        `(strip everything from "/mcp" onward) and redeploy.`);
}
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, ""); // also strip any trailing slash
/** A fresh keypair's pubkey, used only as a correlation reference per Solana
 * Pay spec (§4.2 of the transaction-request spec) — never used to sign. */
export function generateReference() {
    return Keypair.generate().publicKey;
}
/**
 * Resolves the actual signer wallet from a Solana Pay reference key, once
 * a transaction carrying it has landed. The reference is attached as a
 * non-signing account on the transaction (see server.ts's POST
 * /pay/:reference and route.ts's optional `reference` param) specifically
 * so this lookup works -- per the Solana Pay spec, this is the intended
 * mechanism, not a workaround.
 */
export async function findSignerByReference(reference) {
    const connection = getConnection();
    const sigs = await connection.getSignaturesForAddress(new PublicKey(reference), { limit: 1 });
    if (sigs.length === 0)
        return null;
    const tx = await connection.getTransaction(sigs[0].signature, { maxSupportedTransactionVersion: 0 });
    return tx?.transaction.message.staticAccountKeys[0]?.toString() ?? null;
}
// NOTE: this stays "/pay/", matching server.ts's /pay/:reference route for
// prepare_buy_order's reference-based signing flow. Don't confuse this with
// /qr/:id in qrProxy.ts -- that's a separate short-link proxy, used by
// generate_merchant_qr AND (as of this export) reserve_sell_order, and
// points at a different route entirely.
/** The raw https:// transaction-request endpoint, unwrapped. Exported
 * separately from transactionRequestUrl() below so callers can register it
 * with qrProxy.registerShortLink() and get a real checkoutPageUrl out of
 * it -- the same "Copy pay link" needs a page that does something when
 * pasted outside a wallet app (see checkoutPage.ts's doc comment: a bare
 * solana: URI pasted in a browser does nothing, no registered protocol
 * handler). Before this existed, reserve_sell_order's "Copy reservation
 * link" copied transactionRequestUrl() directly -- the raw solana: URI --
 * which is exactly the confusing double-encoded string a person would see
 * if they pasted it anywhere but a wallet's own QR scanner.
 */
export function transactionRequestHttpUrl(reference) {
    return `${BASE_URL}/pay/${reference.toString()}`;
}
export function transactionRequestUrl(reference) {
    return `solana:${encodeURIComponent(transactionRequestHttpUrl(reference))}`;
}
export async function qrDataUri(uri) {
    // width/errorCorrectionLevel tuned down from the old 400px/default-M
    // settings now that generate_merchant_qr encodes a short opaque
    // /qr/:id link (see qrProxy.ts) instead of the full instant-reserve
    // URL -- a handful of characters doesn't need a dense, high-EC-level
    // code, and prepare_buy_order's /pay/:reference URL was already short.
    return QRCode.toDataURL(uri, { margin: 1, width: 300, errorCorrectionLevel: "L" });
}
