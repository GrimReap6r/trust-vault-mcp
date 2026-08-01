import { PublicKey } from "@solana/web3.js";
// This is the deployed program's address — immutable and structural, not a
// business/config value, so unlike the mint list below there is nothing to
// "derive" it from. Kept as-is intentionally.
// Source: trust-vault-program skill, §1 Program Identity
export const PROGRAM_ID = new PublicKey("6Z8rRkDxtLWBEGgeccx8AWj9Um8osnLQihEA1xiECHWr");
export const TRUST_EXPRESS_SEED = "trust-express";
// NOTE: token identity (mint -> decimals) used to live here as a hardcoded
// SUPPORTED_MINTS list. That's what caused the get_market_rates/list_open_orders
// bug: the list held MAINNET USDC/USDT addresses while the server defaulted
// to devnet, so real on-chain orders (using devnet mints) never matched.
// Token identity is now derived live from on-chain data — see
// src/tools/tokenRegistry.ts (getMint decimals lookup + cache) — instead of
// being duplicated here where it can silently drift from whatever network
// the server is actually pointed at.
// SUPPORTED_CURRENCIES / SUPPORTED_PROCESSORS are intentionally still here.
// Unlike the mint list, there's no on-chain source of truth for "which fiat
// currencies / payment processors this product supports" — an order's
// currency field is just 3 raw bytes the maker chose when creating it, and
// processors like Flutterwave/Paystack are off-chain business integrations
// with no on-chain representation at all. This is product config, not
// something that can drift from chain state, so hardcoding it is correct.
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
];
// OPay intentionally excluded — bans crypto, must never appear in
// public-facing / pitch materials (trust-vault skill, misconceptions §1).
export const SUPPORTED_PROCESSORS = ["Flutterwave", "Paystack", "Korapay"];
// FEE_STRUCTURE (target product fee, on-chain default, fee split) has been
// removed from here entirely. It used to hardcode both a "product target"
// fee split AND note that the live on-chain value differs — meaning
// get_fee_structure was always reporting a number that wasn't what the
// program was actually charging. get_fee_structure now reads the live fee
// directly from the GlobalState account. See src/tools/platformStats.ts.
// RESERVATION_STATUS / ESCROW_TYPE (the arrays that decoded on-chain u8
// codes to strings like "pending" / "buy") have also been removed. Decoding
// an enum by hardcoded array position is exactly the same class of risk as
// the mint list: if the Rust program ever reorders or adds a variant, this
// silently mislabels order state (e.g. a "disputed" reservation could get
// mislabeled "completed") with no error to catch it. These are now decoded
// directly from the IDL's own type definitions at runtime — the same
// source of truth the Anchor client already trusts — and the server throws
// clearly if the IDL doesn't define them, instead of guessing.
// See src/helpers.ts.
