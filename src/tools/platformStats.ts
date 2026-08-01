import { PublicKey } from "@solana/web3.js";
import { getProgram } from "../program.js";
import { PROGRAM_ID } from "../constants.js";

/**
 * get_platform_stats -- GlobalState PDA, seeds=[b"global-state"].
 * Mirrors useExpressGlobalStats() field-for-field (trust-vault-client §2.3).
 *
 * NOTE: totalVolume/totalFeesCollected are raw token units on-chain -- pick
 * the active vault's mint decimals to format for display, same as the
 * client does by reading the first active vault's mint.
 */
export async function getPlatformStats() {
  const program = getProgram();
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-state")],
    PROGRAM_ID
  );

  const acc = await (program.account as any).globalState.fetch(globalStatePda);

  return {
    totalOrdersCreated: Number(acc.totalTrustExpressCreated),
    totalOrdersClosed: Number(acc.totalTrustExpressClosed),
    totalConfirmations: Number(acc.totalConfirmations),
    totalVolumeRaw: acc.totalVolume.toString(), // divide by 10^decimals to display
    totalFeesCollectedRaw: acc.totalFeesCollected.toString(),
    totalDisputes: Number(acc.totalDisputes),
    buyOrdersPaused: acc.buyOrdersPaused,
    sellOrdersPaused: acc.sellOrdersPaused,
    validatorCount: acc.validatorCount,
    requiredVotes: acc.requiredVotes,
    activeVoteCount: Number(acc.activeVoteCount),
  };
}

/**
 * get_fee_structure -- this used to return a hardcoded FEE_STRUCTURE
 * constant (a "target" 0.5% split) with a note admitting the live on-chain
 * value was actually different (0.05%). That meant the tool was always
 * reporting a number that didn't match what the program actually charges.
 *
 * This now reads the live fee directly off GlobalState. IMPORTANT: the
 * exact field name below (feeBasisPoints) is a best guess based on the
 * program docs referencing "constants.rs FEE_BASIS_POINTS" -- confirm the
 * real camelCase field name Anchor generates for your IDL (log `acc` once
 * against a real GlobalState fetch, or check target/idl/trust_express.json
 * for the GlobalState account's field list) and adjust the property access
 * below if it doesn't match. Failing loudly here is intentional: better to
 * throw than to silently report last quarter's hardcoded guess again.
 */
export async function getFeeStructure() {
  const program = getProgram();
  const [globalStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-state")],
    PROGRAM_ID
  );

  const acc = await (program.account as any).globalState.fetch(globalStatePda);

  const feeBasisPoints = acc.feeBasisPoints ?? acc.fee_basis_points;
  if (feeBasisPoints === undefined) {
    throw new Error(
      "GlobalState account has no feeBasisPoints field. The real field name " +
        "on your program's GlobalState struct differs -- update the property " +
        "access in getFeeStructure() (src/tools/platformStats.ts) to match " +
        "your actual IDL, rather than falling back to a hardcoded number."
    );
  }

  return {
    feeBasisPoints: Number(feeBasisPoints),
    feePercent: Number(feeBasisPoints) / 100,
    source: "live on-chain GlobalState account",
  };
}