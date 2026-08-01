import { PublicKey } from "@solana/web3.js";
import { getProgram } from "../program.js";
import { PROGRAM_ID } from "../constants.js";
/**
 * get_platform_stats — GlobalState PDA, seeds=[b"global-state"].
 * Mirrors useExpressGlobalStats() field-for-field (trust-vault-client §2.3).
 *
 * NOTE: totalVolume/totalFeesCollected are raw token units on-chain per the
 * client skill ("always divide by 10^decimals before display"). GlobalState
 * doesn't carry a mint itself, so this returns raw units here — pick the
 * active vault's mint decimals to format for display, same as the client
 * does by reading the first active vault's mint.
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
