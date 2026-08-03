// src/widgets/registerReserveBuyOrderApp.ts
//
// MCP App version of reserve_buy_order -- selling tokens into an open BUY
// order. Same live-card pattern as registerReserveSellOrderApp.ts, but
// simpler: no separate payment-link stage, since signing the reservation
// transaction IS the sale (the LP's linked processor pays the seller's
// bank account out automatically once validators confirm). Two stages:
//
//   pending  -- QR shown, waiting for the wallet to scan + sign
//   success  -- a receipts row landed (Realtime push, same trust boundary
//               as the merchant card and reserve-sell-order card: filtered
//               on order + fiat amount + currency, no taker wallet needed)
//
// UNLIKE the other two cards, payoutDetails (the seller's own bank account)
// is real content the person has to supply in chat -- it can't be revealed
// by a wallet scan the way an identity can, so it stays a required argument
// on the tool itself, not something the card discovers later.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { reserveBuyOrder } from "../tools/reserveBuyOrder.js";
import { getReceiptByOrder } from "../tools/receiptByOrder.js";

const RESOURCE_URI = "ui://trust-vault/reserve-buy-order-card-v1";
const WIDGET_HTML_PATH = path.join(import.meta.dirname, "reserveBuyOrderCard.html");

const RESOURCE_DOMAINS = ["https://cdn.jsdelivr.net"];
const CONNECT_DOMAINS = [
  "https://cdn.jsdelivr.net",
  ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
  ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL.replace(/^https:/, "wss:")] : []),
];

export function registerReserveBuyOrderApp(server: McpServer) {
  registerAppResource(
    server,
    "Reserve Buy Order Card",
    RESOURCE_URI,
    {
      description:
        "Live QR card for selling tokens into an open BUY order -- scan to sign, fiat lands in " +
        "your bank automatically, no separate payment step.",
    },
    async () => ({
      contents: [
        {
          uri: RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await fs.readFile(WIDGET_HTML_PATH, "utf-8"),
          _meta: {
            ui: {
              csp: { resourceDomains: RESOURCE_DOMAINS, connectDomains: CONNECT_DOMAINS },
              permissions: { clipboardWrite: {} },
            },
          },
        },
      ],
    })
  );

  registerAppTool(
    server,
    "reserve_buy_order",
    {
      title: "Reserve against a BUY order (sell tokens)",
      description:
        "For a token holder selling into an open BUY order. Renders a live QR card -- no wallet " +
        "address needed, it identifies itself on scan. Deposits the tokens into escrow immediately " +
        "on signing; fiat pays out automatically to the bank details provided, no separate payment " +
        "step needed (unlike reserve_sell_order).",
      inputSchema: {
        orderAddress: z.string().describe("Full base58 PDA of the BUY order, from list_open_orders"),
        amount: z.number().describe("Amount of tokens to sell, in display units"),
        payoutDetails: z
          .object({
            accountNumber: z.string(),
            bankCode: z.string(),
            bankName: z.string(),
            beneficiaryName: z.string(),
          })
          .describe("Bank account that should receive the fiat payout -- the seller's own account"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args) => {
      const result = await reserveBuyOrder(args);
      return {
        content: [
          {
            type: "text",
            text: `Sell card ready: ${args.amount} tokens into order ${args.orderAddress}. Scan to sign -- fiat pays out automatically once confirmed.`,
          },
        ],
        structuredContent: result,
      };
    }
  );

  registerAppTool(
    server,
    "get_reserve_buy_order_receipt",
    {
      title: "Get sell reservation receipt (manual fallback)",
      description:
        "Internal: on-demand fallback receipt check for the reserve-buy-order card's 'Check now' " +
        "button, used only if its Realtime subscription drops. Same trust boundary as " +
        "get_receipt_by_order: filtered on order + fiat amount + currency, no taker wallet needed.",
      inputSchema: { orderAddress: z.string(), fiatAmount: z.number(), currency: z.string() },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async (args) => {
      const result = await getReceiptByOrder(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );
}