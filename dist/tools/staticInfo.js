import fs from "node:fs";
import { SUPPORTED_CURRENCIES, SUPPORTED_PROCESSORS } from "../constants.js";
const KNOWLEDGE_BASE_PATH = process.env.TRUST_VAULT_KNOWLEDGE_PATH ?? "./knowledge/trustvault.md";
/**
 * get_protocol_overview -- same file your /api/chat system prompt already
 * loads (knowledge/trustvault.md). Update that one file, both surfaces
 * (embedded chat + this MCP server) pick it up.
 */
export function getProtocolOverview() {
    if (!fs.existsSync(KNOWLEDGE_BASE_PATH)) {
        return "Trust Vault is a non-custodial P2P crypto-to-fiat settlement protocol built on Solana. " +
            "(Fallback text -- knowledge/trustvault.md not found at configured path.)";
    }
    return fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf-8");
}
// getSupportedTokens() and getFeeStructure() used to live here as hardcoded
// lookups (SUPPORTED_MINTS, FEE_STRUCTURE). They've moved:
//  - token discovery is now live-derived from open orders, see
//    tools/marketData.ts -> listKnownTokens()
//  - fee structure now reads the live GlobalState account, see
//    tools/platformStats.ts -> getFeeStructure()
// Both are things that can change on-chain (new tokens get traded, fees can
// be adjusted by governance) and shouldn't be duplicated in static config
// that has no way to notice when it goes stale.
export function getCurrenciesAndProcessors() {
    // Unlike tokens/fees, there's no on-chain source of truth for this --
    // see the comment in constants.ts for why this one stays as config.
    return {
        currencies: SUPPORTED_CURRENCIES,
        processors: SUPPORTED_PROCESSORS,
    };
}
