// src/tools/prepareOrder.ts
// @coral-xyz/anchor is CommonJS; Node's ESM loader can't statically pull
// named exports out of it (this is what threw "Named export 'BN' not
// found" at runtime, even though it type-checked fine). Import the default
// and destructure instead.
import pkg from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID, TRUST_EXPRESS_SEED, SUPPORTED_CURRENCIES } from "../constants.js";
import { getDecimalsForMint, getTokenProgramForMint } from "./tokenRegistry.js";
import { generateReference, transactionRequestUrl, qrDataUri } from "../solanaPay.js";
import { storeIntent } from "../paymentIntents.js";

const { BN } = pkg;

/** Mirrors create_express_buy_order's seed derivation:
 * seeds = [b"trust-express", maker.key(), seed.to_le_bytes()] */
export function deriveTrustExpressPda(maker: PublicKey, seed: bigint): PublicKey {
  const seedBuf = Buffer.alloc(8);
  seedBuf.writeBigUInt64LE(seed);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(TRUST_EXPRESS_SEED), maker.toBuffer(), seedBuf],
    PROGRAM_ID
  );
  return pda;
}

/** seeds = [b"global-state"] -- same PDA platformStats.ts already derives. */
export function deriveGlobalStatePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("global-state")], PROGRAM_ID);
  return pda;
}

/**
 * Confirmed against trust_express.json, instructions[name=
 * "create_express_buy_order"].accounts (program address in that IDL
 * matches PROGRAM_ID in constants.ts):
 *
 *   buyer                     (signer)
 *   mint
 *   trust_express              PDA [b"trust-express", buyer, seed]
 *   global_state                PDA [b"global-state"]
 *   system_program              11111111111111111111111111111111
 *   token_program                <- owning program of `mint`, legacy vs Token-2022
 *   associated_token_program    ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
 *
 * No fee-destination or other extra account on this instruction -- the IDL
 * lists exactly these seven. token_program is resolved per-mint rather than
 * assumed, same owner-detection tokenRegistry.ts already does for decimals.
 */
export async function buildCreateBuyOrderAccounts(args: {
  buyer: PublicKey;
  mint: string;
  seed: bigint;
}) {
  const mintPubkey = new PublicKey(args.mint);
  const tokenProgram = await getTokenProgramForMint(args.mint);
  return {
    buyer: args.buyer,
    mint: mintPubkey,
    trustExpress: deriveTrustExpressPda(args.buyer, args.seed),
    globalState: deriveGlobalStatePda(),
    systemProgram: SystemProgram.programId,
    tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

/**
 * prepare_buy_order — does NOT create a transaction itself. It validates
 * inputs, picks a seed, derives the order's future PDA (so the caller can
 * reference it before it exists), and returns a Solana Pay transaction-
 * request URL. The actual unsigned transaction is built in server.ts's
 * POST /pay/:reference handler, once the wallet identifies itself.
 *
 * create_express_buy_order moves no tokens at creation (confirmed: program
 * skill §2.2 "BUY order: NO token deposit at creation"), so unlike a
 * reservation this doesn't need the buyer's ATA resolved up front.
 */
export async function prepareBuyOrder(args: {
  buyerWallet: string;
  mint: string;
  amount: number; // display units, e.g. 500 (not raw)
  pricePerToken: number; // raw fiat units per whole token — same open scale question as elsewhere
  currency: string;
  paymentInstructions: string;
  credentialId?: string;
}) {
  if (!SUPPORTED_CURRENCIES.includes(args.currency.toUpperCase() as any)) {
    throw new Error(`Unsupported currency "${args.currency}". Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }
  if (args.paymentInstructions.length > 100) {
    // validate_order_fields() technically allows up to 300, but the account
    // field is #[max_len(100)] — program skill §8, gotcha #10. Keep to 100.
    throw new Error("paymentInstructions must be 100 characters or fewer.");
  }

  const buyer = new PublicKey(args.buyerWallet); // throws on invalid pubkey
  const decimals = await getDecimalsForMint(args.mint);
  const amountRaw = BigInt(Math.round(args.amount * 10 ** decimals));

  // Seed just needs to be unique per (maker, seed) pair for PDA derivation.
  // Timestamp-millis is the simplest collision-free choice for a single
  // buyer creating orders one at a time.
  const seed = BigInt(Date.now());
  const orderAddress = deriveTrustExpressPda(buyer, seed);

  const reference = generateReference();
  storeIntent(reference.toString(), {
    kind: "create_buy_order",
    buyer: buyer.toString(),
    seed: seed.toString(),
    mint: args.mint,
    amountRaw: amountRaw.toString(),
    pricePerToken: new BN(args.pricePerToken).toString(),
    currency: args.currency.toUpperCase(),
    paymentInstructions: args.paymentInstructions,
    credentialId: args.credentialId ?? null,
  });

  const url = transactionRequestUrl(reference);
  return {
    futureOrderAddress: orderAddress.toString(),
    transactionRequestUrl: url,
    qrCodeDataUri: await qrDataUri(url),
    expiresInSeconds: 300,
    instructions: "Scan this QR (or open the link) with Phantom or Backpack to review and sign.",
  };
}