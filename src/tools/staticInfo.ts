import fs from "node:fs";
import {
  SUPPORTED_MINTS,
  SUPPORTED_CURRENCIES,
  SUPPORTED_PROCESSORS,
  FEE_STRUCTURE,
} from "../constants.js";

const KNOWLEDGE_BASE_PATH =
  process.env.TRUST_VAULT_KNOWLEDGE_PATH ?? "./knowledge/trustvault.md";

/**
 * get_protocol_overview — same file your /api/chat system prompt already
 * loads (knowledge/trustvault.md). Update that one file, both surfaces
 * (embedded chat + this MCP server) pick it up.
 */
export function getProtocolOverview(): string {
  if (!fs.existsSync(KNOWLEDGE_BASE_PATH)) {
    return "Trust Vault is a non-custodial P2P crypto-to-fiat settlement protocol built on Solana. " +
      "(Fallback text — knowledge/trustvault.md not found at configured path.)";
  }
  return fs.readFileSync(KNOWLEDGE_BASE_PATH, "utf-8");
}

export function getSupportedTokens() {
  return SUPPORTED_MINTS;
}

export function getFeeStructure() {
  return {
    totalFeePercent: FEE_STRUCTURE.totalFeePercent,
    split: FEE_STRUCTURE.split,
    note: "Product fee is 0.5% total; on-chain default during development differs (0.05%) and will be raised to match at mainnet launch.",
  };
}

export function getCurrenciesAndProcessors() {
  return {
    currencies: SUPPORTED_CURRENCIES,
    processors: SUPPORTED_PROCESSORS,
  };
}
