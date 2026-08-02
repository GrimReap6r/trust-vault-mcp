// src/solanaPay.ts
import { Keypair } from "@solana/web3.js";
import QRCode from "qrcode";
const BASE_URL = process.env.PUBLIC_BASE_URL; // e.g. https://trustvault-mcp.up.railway.app
if (!BASE_URL) {
    throw new Error("PUBLIC_BASE_URL is not set. The Solana Pay transaction-request URLs this " +
        "server generates must be publicly reachable (the wallet app fetches them " +
        "directly) — set it to your deployed Railway URL, not localhost.");
}
/** A fresh keypair's pubkey, used only as a correlation reference per Solana
 * Pay spec (§4.2 of the transaction-request spec) — never used to sign. */
export function generateReference() {
    return Keypair.generate().publicKey;
}
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
