// src/solanaPay.ts
import { Keypair } from "@solana/web3.js";
import QRCode from "qrcode";
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
// NOTE: this stays "/pay/", matching server.ts's /pay/:reference route for
// prepare_buy_order's reference-based signing flow. Don't confuse this with
// /qr/:id in qrProxy.ts -- that's a separate short-link proxy used only by
// generate_merchant_qr, and points at a different route entirely.
export function transactionRequestUrl(reference) {
    const httpUrl = `${BASE_URL}/pay/${reference.toString()}`;
    return `solana:${encodeURIComponent(httpUrl)}`;
}
export async function qrDataUri(uri) {
    // width/errorCorrectionLevel tuned down from the old 400px/default-M
    // settings now that generate_merchant_qr encodes a short opaque
    // /qr/:id link (see qrProxy.ts) instead of the full instant-reserve
    // URL -- a handful of characters doesn't need a dense, high-EC-level
    // code, and prepare_buy_order's /pay/:reference URL was already short.
    return QRCode.toDataURL(uri, { margin: 1, width: 300, errorCorrectionLevel: "L" });
}
