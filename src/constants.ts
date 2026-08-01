import { PublicKey } from "@solana/web3.js";

// Source: trust-vault-program skill, §1 Program Identity
export const PROGRAM_ID = new PublicKey(
  "6Z8rRkDxtLWBEGgeccx8AWj9Um8osnLQihEA1xiECHWr"
);

export const TRUST_EXPRESS_SEED = "trust-express";

// Source: lib/mintConstants.ts (client repo) — mirror this list there.
// If you add a token in the client, add it here too or these will drift.
export interface MintEntry {
  symbol: string;
  mint: string;
  decimals: number;
}

export const SUPPORTED_MINTS: MintEntry[] = [
  {
    symbol: "USDC",
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    decimals: 6,
  },
  {
    symbol: "USDT",
    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
  },
];

export const SUPPORTED_CURRENCIES = [
  "NGN",
  "GHS",
  "KES",
  "ZAR",
  "UGX",
  "TZS",
  "XOF",
  "XAF",
  "MAD",
  "EGP",
] as const;

// OPay intentionally excluded — bans crypto, must never appear in
// public-facing / pitch materials (trust-vault skill, misconceptions §1).
export const SUPPORTED_PROCESSORS = ["Flutterwave", "Paystack", "Korapay"] as const;

// CANONICAL fee split — corrected value per /areas/trust-vault.md.
// NOTE: the trust-vault skill file still documents 40% platform / 40% LP / 20% validators.
// That is STALE. Do not copy fee numbers from the skill file into this tool —
// this constant is the one source this MCP server should trust. Fix the skill
// file separately; until then this comment is load-bearing.
export const FEE_STRUCTURE = {
  totalFeeBasisPoints: 50, // 0.5% product fee (on-chain default differs — see below)
  totalFeePercent: 0.5,
  split: {
    lp: 0.5, // 50%
    platform: 0.3, // 30%
    validators: 0.2, // 20%
  },
  // On-chain default differs from the intended product fee during development.
  onChainDefaultBasisPoints: 5, // 0.05% — constants.rs FEE_BASIS_POINTS
  maxBasisPoints: 1000, // 10% hard cap
};

// Reservation status codes — trust-vault-program skill §2.3
export const RESERVATION_STATUS = [
  "pending", // 0
  "payment_sent", // 1
  "completed", // 2
  "cancelled", // 3
  "disputed", // 4
] as const;

export const ESCROW_TYPE = ["sell", "buy"] as const; // 0=SELL, 1=BUY
