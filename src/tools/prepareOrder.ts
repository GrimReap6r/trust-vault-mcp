// src/tools/prepareOrder.ts
// @coral-xyz/anchor is CommonJS; Node's ESM loader can't statically pull
// named exports out of it (this is what threw "Named export 'BN' not
// found" at runtime, even though it type-checked fine). Import the default
// and destructure instead.
import pkg from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PROGRAM_ID, TRUST_EXPRESS_SEED, SUPPORTED_CURRENCIES } from "../constants.js";
import { getDecimalsForMint, getTokenProgramForMint } from "./tokenRegistry.js";
import { generateReference, transactionRequestUrl, qrDataUri } from "../solanaPay.js";
import { storeIntent } from "../paymentIntents.js";
import { findActiveCredential } from "./credentialCheck.js";

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
 *
 * credentialId is NOT accepted as a caller-supplied argument. Passing an
 * arbitrary credential_id through chat would let anyone attach a wallet's
 * saved payment-processor credential to an order that wallet never
 * actually asked to create. It's always resolved server-side instead, from
 * findActiveCredential's wallet-scoped lookup.
 */
export async function prepareBuyOrder(args: {
  buyerWallet: string;
  mint: string;
  amount: number; // display units, e.g. 500 (not raw)
  pricePerToken: number; // raw fiat units per whole token — same open scale question as elsewhere
  currency: string;
  paymentInstructions: string;
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

  // An order without a linked credential can be created on-chain but can
  // never actually settle a trade, so block creation up front rather than
  // letting the buyer discover this later at settlement time.
  const credential = await findActiveCredential({ walletAddress: args.buyerWallet, side: "buyer" });
  if (!credential) {
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    return {
      blocked: true as const,
      reason: "no_credential" as const,
      message:
        "This wallet doesn't have a saved payment processor credential yet. " +
        "Order creation is blocked until one is linked -- an order without a " +
        "credential can be created on-chain but can never actually settle a trade. " +
        `Link one first at ${APP_URL}/express/providers/settings, then try again.`,
    };
  }

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
    credentialId: credential.id,
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

/**
 * Confirmed against trust_express.json, instructions[name=
 * "create_express_sell"].accounts:
 *
 *   seller                       (signer)
 *   mint
 *   seller_ata                    -- seller's own ATA, tokens debited from here
 *   trust_express                  PDA [b"trust-express", seller, seed]
 *   trust_express_ata               -- escrow ATA, owner = trust_express PDA
 *   global_state                    PDA [b"global-state"]
 *   system_program                  11111111111111111111111111111111
 *   token_program                    <- legacy vs Token-2022, per-mint
 *   associated_token_program        ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL
 *
 * Unlike create_express_buy_order, THIS instruction moves real tokens at
 * creation time -- both ATAs must be resolved up front, and the seller's
 * ATA must actually hold enough balance (this instruction will fail
 * on-chain otherwise, same as any normal SPL transfer would).
 */
export async function buildCreateSellOrderAccounts(args: {
  seller: PublicKey;
  mint: string;
  seed: bigint;
}) {
  const mintPubkey = new PublicKey(args.mint);
  const tokenProgram = await getTokenProgramForMint(args.mint);
  const trustExpress = deriveTrustExpressPda(args.seller, args.seed);

  return {
    seller: args.seller,
    mint: mintPubkey,
    sellerAta: getAssociatedTokenAddressSync(mintPubkey, args.seller, false, tokenProgram),
    trustExpress,
    trustExpressAta: getAssociatedTokenAddressSync(mintPubkey, trustExpress, true, tokenProgram), // allowOwnerOffCurve=true -- owner is a PDA
    globalState: deriveGlobalStatePda(),
    systemProgram: SystemProgram.programId,
    tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

/**
 * prepare_sell_order -- same "prepare, don't sign" shape as prepareBuyOrder,
 * gated on an existing active seller credential (see credentialCheck.ts):
 * a credential-less sell order deposits real tokens into an escrow that can
 * never settle a trade, which is worse than a credential-less buy order
 * (which at least moves no funds at creation).
 */
export async function prepareSellOrder(args: {
  sellerWallet: string;
  mint: string;
  amount: number; // display units
  pricePerToken: number;
  currency: string;
  paymentInstructions: string;
}) {
  if (!SUPPORTED_CURRENCIES.includes(args.currency.toUpperCase() as any)) {
    throw new Error(`Unsupported currency "${args.currency}". Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }
  if (args.paymentInstructions.length > 100) {
    throw new Error("paymentInstructions must be 100 characters or fewer.");
  }

  const seller = new PublicKey(args.sellerWallet);

  const credential = await findActiveCredential({ walletAddress: args.sellerWallet, side: "seller" });
  if (!credential) {
    return {
      blocked: true as const,
      reason: "no_credential" as const,
      message:
        "This wallet doesn't have a saved payment processor credential yet. " +
        "A sell order created without one would deposit real tokens into escrow " +
        "with no way to ever settle a trade against it -- link a credential first " +
        `at ${process.env.NEXT_PUBLIC_APP_URL}/express/providers/settings, then try again.`,
    };
  }

  const decimals = await getDecimalsForMint(args.mint);
  const amountRaw = BigInt(Math.round(args.amount * 10 ** decimals));
  const seed = BigInt(Date.now());
  const orderAddress = deriveTrustExpressPda(seller, seed);

  const reference = generateReference();
  storeIntent(reference.toString(), {
    kind: "create_sell_order",
    seller: seller.toString(),
    seed: seed.toString(),
    mint: args.mint,
    amountRaw: amountRaw.toString(),
    pricePerToken: new BN(args.pricePerToken).toString(),
    currency: args.currency.toUpperCase(),
    paymentInstructions: args.paymentInstructions,
    credentialId: credential.id,
  });

  const url = transactionRequestUrl(reference);
  return {
    blocked: false as const,
    futureOrderAddress: orderAddress.toString(),
    transactionRequestUrl: url,
    qrCodeDataUri: await qrDataUri(url),
    expiresInSeconds: 300,
    instructions:
      "Scan this QR (or open the link) with Phantom or Backpack to review and sign. " +
      `This deposits ${args.amount} tokens into escrow immediately on approval.`,
  };
}