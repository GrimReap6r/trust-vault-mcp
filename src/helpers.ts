import type { Idl } from "@coral-xyz/anchor";

/** currency: [u8; 3] on-chain -> "NGN" */
export function decodeCurrency(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

/**
 * ESCROW_TYPE / RESERVATION_STATUS used to be hardcoded arrays here
 * (["sell","buy"], ["pending","payment_sent",...]) that decoded an
 * on-chain u8 by array position. That's risky in the same way the old
 * SUPPORTED_MINTS table was: if the Rust program ever reorders or adds a
 * variant, this silently mislabels order state with nothing to catch it —
 * e.g. a "disputed" reservation could get reported as "completed".
 *
 * Instead, both enums are now read directly from the IDL's own `types`
 * definitions at runtime — the same source of truth the Anchor client
 * already trusts for account layout — and this throws clearly if the IDL
 * doesn't define the expected type, rather than falling back to a guess.
 */
function getEnumVariants(idl: Idl, typeName: string): string[] {
  const typeDef = (idl.types ?? []).find((t: any) => t.name === typeName);
  if (!typeDef) {
    throw new Error(
      `IDL has no type named "${typeName}". Cannot safely decode this enum ` +
        `without it -- refusing to guess. Check the type name matches your ` +
        `Rust program's enum (it may be defined under a different name).`
    );
  }
  const kind = (typeDef as any).type;
  if (kind?.kind !== "enum" || !Array.isArray(kind.variants)) {
    throw new Error(`IDL type "${typeName}" is not an enum -- cannot decode by variant index.`);
  }
  return kind.variants.map((v: any) => toSnakeCase(v.name));
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function decodeEscrowType(idl: Idl, escrowType: number): "sell" | "buy" {
  const variants = getEnumVariants(idl, "EscrowType");
  const val = variants[escrowType];
  if (val !== "sell" && val !== "buy") {
    throw new Error(
      `IDL EscrowType variant at index ${escrowType} is "${val}", expected "sell" or "buy". ` +
        `The IDL's enum shape doesn't match what this decoder expects -- update decodeEscrowType.`
    );
  }
  return val;
}

export function decodeReservationStatus(idl: Idl, status: number): string {
  const variants = getEnumVariants(idl, "ReservationStatus");
  return variants[status] ?? `unknown_variant_index_${status}`;
}

export function toDisplayAmount(rawAmount: bigint | number, decimals: number): number {
  const raw = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount);
  return Number(raw) / 10 ** decimals;
}

/** Truncated PDA display format used throughout the client: "EWkT…jQr7" */
export function truncatePda(pda: string): string {
  if (pda.length <= 10) return pda;
  return `${pda.slice(0, 4)}…${pda.slice(-4)}`;
}