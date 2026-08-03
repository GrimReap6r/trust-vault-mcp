// src/tools/reserveBuyOrder.ts
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { fetchAllOrders } from "./fetchOrders.js";
import { getDecimalsForMint, getTokenProgramForMint } from "./tokenRegistry.js";
import { deriveGlobalStatePda } from "./prepareOrder.js";
import { generateReference, transactionRequestUrl, qrDataUri } from "../solanaPay.js";
import { storeIntent } from "../paymentIntents.js";

export interface ReserveBuyOrderPayoutDetails {
  accountNumber: string;
  bankCode: string;
  bankName: string;
  beneficiaryName: string;
}

/**
 * Accounts for instant_reserve -- confirmed against the same IDL entry
 * server.ts's old stub comment already cites (trust_express, maker, taker,
 * mint, taker_ata, trust_express_ata, global_state, token_program,
 * associated_token_program, system_program). Same shape as
 * buildCreateSellOrderAccounts in prepareOrder.ts: taker's ATA needs
 * resolving because real tokens move out of the taker's wallet into escrow
 * on signing, same as a sell-order creation does for its maker.
 */
export async function buildInstantReserveAccounts(args: {
  trustExpress: PublicKey;
  maker: PublicKey;
  taker: PublicKey;
  mint: string;
}) {
  const mintPubkey = new PublicKey(args.mint);
  const tokenProgram = await getTokenProgramForMint(args.mint);
  return {
    trustExpress: args.trustExpress,
    maker: args.maker,
    taker: args.taker,
    mint: mintPubkey,
    takerAta: getAssociatedTokenAddressSync(mintPubkey, args.taker, false, tokenProgram),
    trustExpressAta: getAssociatedTokenAddressSync(mintPubkey, args.trustExpress, true, tokenProgram),
    globalState: deriveGlobalStatePda(),
    systemProgram: SystemProgram.programId,
    tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

/**
 * reserve_buy_order -- mirror image of reserve_sell_order: a token HOLDER
 * selling into an open BUY order (an LP's standing offer to buy tokens for
 * fiat). Same "no wallet up front" shape as reserve_sell_order -- the
 * taker's wallet identifies itself at scan time via POST /pay/:reference's
 * req.body.account, same pattern create_sell_order already uses.
 *
 * UNLIKE reserve_sell_order, this needs one real piece of information up
 * front that a wallet scan can't supply: payoutDetails, the SELLER's own
 * bank account -- on instant_reserve's success path it's the taker (seller)
 * who receives fiat, not the LP. That's actual content the person has to
 * hand over (same category as prepare_sell_order's paymentInstructions, not
 * an identity revealed on scan), so it stays a required chat argument.
 *
 * Also unlike reserve_sell_order, there is no separate "payment link" step
 * afterward -- signing IS the sale. The LP's linked processor pays the
 * bank account out automatically once validators confirm, so the card only
 * has two stages (pending -> success), not three.
 *
 * payout_reference uses the "IP-" prefix (Instant Pay), matching the format
 * get_receipt's own description already documents
 * ("IP-<timestamp>-<takerprefix>") -- reserve_sell_order's "IS-" (Instant
 * Sell) is the other half of that same naming split.
 */
export async function reserveBuyOrder(args: {
  orderAddress: string;
  amount: number;
  payoutDetails: ReserveBuyOrderPayoutDetails;
}) {
  const orders = await fetchAllOrders();
  const order = orders.find((o) => o.orderAddress === args.orderAddress);
  if (!order) throw new Error(`No order found at ${args.orderAddress}.`);
  if (order.orderType !== "buy") {
    throw new Error(`${args.orderAddress} is a ${order.orderType} order -- reserve_buy_order only works against buy orders.`);
  }
  if (args.amount > order.amount) {
    throw new Error(`Requested ${args.amount} exceeds the ${order.amount} available on this order.`);
  }

  const decimals = await getDecimalsForMint(order.mint);
  const amountRaw = BigInt(Math.round(args.amount * 10 ** decimals));
  const fiatAmount = args.amount * order.pricePerToken; // same open scale caveat as fetchOrders.ts's FLAG

  const reference = generateReference();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payoutReference = `IP-${nowSeconds}-${reference.toString().slice(0, 8)}`;

  storeIntent(reference.toString(), {
    kind: "reserve_against_buy_order",
    orderAddress: args.orderAddress,
    maker: order.maker,
    mint: order.mint,
    amountRaw: amountRaw.toString(),
    fiatAmount: fiatAmount.toString(),
    currency: order.currency,
    payoutDetails: JSON.stringify({
      type: "bank_transfer",
      account_number: args.payoutDetails.accountNumber,
      bank_code: args.payoutDetails.bankCode,
      bank_name: args.payoutDetails.bankName,
      beneficiary_name: args.payoutDetails.beneficiaryName,
    }),
    payoutReference,
  });

  const url = transactionRequestUrl(reference);

  return {
    payoutReference,
    orderAddress: args.orderAddress,
    tokenAmount: args.amount,
    fiatAmount,
    currency: order.currency,
    payoutDetails: args.payoutDetails,
    transactionRequestUrl: url,
    qrCodeDataUri: await qrDataUri(url),
    expiresInSeconds: 300,
    instructions:
      `Scan this QR (or open the link) with Phantom or Backpack to sign -- this moves ${args.amount} ` +
      "tokens into escrow immediately on approval. Fiat pays out automatically to the bank account " +
      "you provided, no separate payment step needed.",
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    publicBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
  };
}