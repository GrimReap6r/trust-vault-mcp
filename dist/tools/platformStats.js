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
    const [globalStatePda] = PublicKey.findProgramAddressSync([Buffer.from("global-state")], PROGRAM_ID);
    const acc = await program.account.globalState.fetch(globalStatePda);
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
 * get_fee_structure -- live protocol fee, read from GlobalState.
 *
 * Field name and scale both confirmed directly against Rust source:
 *   - state/global_state.rs:      pub fee_percentage: u16
 *   - instructions/fee_management.rs (update_fee_percentage): stores and
 *     logs this value AS basis points, e.g.
 *       "Fee percentage updated from {} basis points ({:.2}%) ..."
 *       old_fee_percentage as f64 / 100.0   // bps -> percent
 *   - constants.rs: pub const FEE_BASIS_POINTS: u16 = 5;  (the default,
 *     0.05%, matches the protocol overview's stated "5 basis points")
 *   - update_fee_percentage() caps this at 1000 (10%), so any value read
 *     back should be <= 1000 -- a value above that would indicate we're
 *     reading the wrong field again.
 *
 * The account field is named fee_percentage but stores basis points, not a
 * direct percentage -- keep the /100 conversion, don't drop it.
 */
export async function getFeeStructure() {
    const program = getProgram();
    const [globalStatePda] = PublicKey.findProgramAddressSync([Buffer.from("global-state")], PROGRAM_ID);
    const acc = await program.account.globalState.fetch(globalStatePda);
    const feeBasisPoints = acc.feePercentage;
    if (feeBasisPoints === undefined) {
        throw new Error("GlobalState account has no feePercentage field. This was confirmed " +
            "against state/global_state.rs -- if this throws, either the IDL is " +
            "stale relative to the deployed program, or the account layout has " +
            "changed since. Re-check the IDL matches the current on-chain program.");
    }
    const basisPoints = Number(feeBasisPoints);
    if (basisPoints > 1000) {
        // update_fee_percentage() rejects anything above 1000 (10%), so a value
        // over that means we're almost certainly reading the wrong field again.
        throw new Error(`feePercentage read as ${basisPoints}, which exceeds the program's own ` +
            `10% (1000 bps) cap from update_fee_percentage(). This value is not ` +
            `trustworthy -- likely reading the wrong field or a stale IDL.`);
    }
    return {
        feeBasisPoints: basisPoints,
        feePercent: basisPoints / 100,
        source: "live on-chain GlobalState account (fee_percentage field, stored as basis points)",
    };
}
