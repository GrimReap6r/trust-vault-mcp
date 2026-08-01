// src/solanaPay.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";

const BASE_URL = process.env.PUBLIC_BASE_URL; // e.g. https://trustvault-mcp.up.railway.app

if (!BASE_URL) {
  throw new Error(
    "PUBLIC_BASE_URL is not set. The Solana Pay transaction-request URLs this " +
      "server generates must be publicly reachable (the wallet app fetches them " +
      "directly) — set it to your deployed Railway URL, not localhost."
  );
}

/** A fresh keypair's pubkey, used only as a correlation reference per Solana
 * Pay spec (§4.2 of the transaction-request spec) — never used to sign. */
export function generateReference(): PublicKey {
  return Keypair.generate().publicKey;
}

export function transactionRequestUrl(reference: PublicKey): string {
  const httpUrl = `${BASE_URL}/pay/${reference.toString()}`;
  return `solana:${encodeURIComponent(httpUrl)}`;
}

export async function qrDataUri(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 400 });
}