import { RESERVATION_STATUS, ESCROW_TYPE, SUPPORTED_MINTS } from "./constants.js";

/** currency: [u8; 3] on-chain -> "NGN" */
export function decodeCurrency(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

export function decodeEscrowType(escrowType: number): "sell" | "buy" {
  const val = ESCROW_TYPE[escrowType];
  if (!val) throw new Error(`Unknown escrow_type on-chain value: ${escrowType}`);
  return val;
}

export function decodeReservationStatus(status: number): string {
  return RESERVATION_STATUS[status] ?? `unknown(${status})`;
}

export function decimalsForMint(mint: string): number {
  const entry = SUPPORTED_MINTS.find((m) => m.mint === mint);
  // Falls back to 6 (USDC/USDT standard) if an unlisted mint shows up on-chain
  // before SUPPORTED_MINTS is updated to match — better a display rounding
  // risk than a thrown error on a read-only info tool.
  return entry?.decimals ?? 6;
}

export function toDisplayAmount(rawAmount: bigint | number, mint: string): number {
  const decimals = decimalsForMint(mint);
  const raw = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount);
  return Number(raw) / 10 ** decimals;
}

/** Truncated PDA display format used throughout the client: "EWkT…jQr7" */
export function truncatePda(pda: string): string {
  if (pda.length <= 10) return pda;
  return `${pda.slice(0, 4)}…${pda.slice(-4)}`;
}
