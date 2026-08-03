// src/widgets/registerReserveSellOrderApp.ts
//
// MCP App version of reserve_sell_order. Built to close the gap the plain
// server.registerTool version had: it asked chat for buyerWallet BEFORE
// showing a QR, even though the wallet only ever gets used from
// req.body.account once it actually scans and signs (see
// tools/reserveSellOrder.ts's doc comment for the full trace). This card
// follows the same shape generate_merchant_qr already proved out --
// show QR -> wallet reveals itself on scan -> payment link -> receipt --
// just flipped from the merchant's side to the buyer's side.
//
// Three stages, one card:
//   1. pending   -- QR shown, waiting for the wallet to scan + sign
//   2. awaiting  -- reservation confirmed on-chain, payment link is ready
//   3. success   -- a receipts row landed (the same off-chain-verified
//                   success oracle waitForPayment.ts/receipt.ts use
//                   elsewhere -- never inferred from on-chain absence alone)
//
// get_reservation_payment_link and get_reservation_receipt are app-only
// (visibility: ["app"]) -- not offered to the model, only callable by this
// card via app.callServerTool, same pattern get_receipt_by_order already
// uses for the merchant card's "Check now" fallback.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { reserveSellOrder } from "../tools/reserveSellOrder.js";
import { getPaymentLink } from "../tools/paymentLinkLookup.js";
import { getReceiptByOrder } from "../tools/receiptByOrder.js";
import { findSignerByReference } from "../solanaPay.js";

const RESOURCE_URI = "ui://trust-vault/reserve-sell-order-card-v1";
const WIDGET_HTML_PATH = path.join(import.meta.dirname, "reserveSellOrderCard.html");

// Same CSP shape as registerMerchantQrApp.ts -- see that file's v4 note for
// why `permissions` (not `csp`) is what actually gates clipboard access.
const RESOURCE_DOMAINS = ["https://cdn.jsdelivr.net"];
const CONNECT_DOMAINS = [
  "https://cdn.jsdelivr.net",
  ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
  ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL.replace(/^https:/, "wss:")] : []),
];

export function registerReserveSellOrderApp(server: McpServer) {
  // --- UI resource: the card itself -------------------------------------
  registerAppResource(
    server,
    "Reserve Sell Order Card",
    RESOURCE_URI,
    {
      description:
        "Live reservation QR card for buying tokens from a SELL order -- scan to reserve, " +
        "auto-updates through payment link and receipt. No wallet address needed up front.",
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

  // --- reserve_sell_order: model-visible, renders the card ---------------
  registerAppTool(
    server,
    "reserve_sell_order",
    {
      title: "Reserve against a SELL order (buy tokens)",
      description:
        "For a buyer purchasing tokens from an open SELL order. Renders a live reservation " +
        "card with a QR code -- no wallet address needed as input, the wallet identifies " +
        "itself the moment it scans and signs. The card auto-updates from 'scan to reserve' " +
        "through 'payment link ready' to 'paid, receipt available'.",
      inputSchema: {
        orderAddress: z.string().describe("Full base58 PDA of the SELL order, from list_open_orders"),
        amount: z.number().describe("Amount of tokens to buy, in display units"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args) => {
      const result = await reserveSellOrder(args);
      return {
        content: [
          {
            type: "text",
            text: `Reservation card ready: ${args.amount} tokens against order ${args.orderAddress}. Scan the QR to sign -- nothing else needed from you.`,
          },
        ],
        structuredContent: result,
      };
    }
  );

  // --- get_reservation_payment_link: app-only polling check --------------
  registerAppTool(
    server,
    "get_reservation_payment_link",
    {
      title: "Get reservation payment link (single check)",
      description:
        "Internal: single non-blocking lookup used by the reservation card's own poll loop -- " +
        "unlike wait_for_payment_link, this does not block for 30s, it just returns the current " +
        "state immediately so the card can poll on its own schedule.",
      inputSchema: { payoutReference: z.string() },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async (args) => {
      const link = await getPaymentLink(args.payoutReference);
      const result = link ? { found: true as const, ...link } : { found: false as const };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );

  // --- get_reservation_receipt: app-only, manual fallback -----------------
  registerAppTool(
    server,
    "get_reservation_receipt",
    {
      title: "Get reservation receipt (manual fallback)",
      description:
        "Internal: on-demand fallback receipt check for the reservation card's 'Check now' " +
        "button, used only if its Realtime subscription drops. Same trust boundary as " +
        "get_receipt_by_order: filtered on order + fiat amount + currency, optionally narrowed to " +
        "signerAddress (from resolve_reservation_signer) when known.",
      inputSchema: {
        orderAddress: z.string(),
        fiatAmount: z.number(),
        currency: z.string(),
        signerAddress: z.string().optional(),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async (args) => {
      const result = await getReceiptByOrder(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );

  // --- resolve_reservation_signer: app-only, resolves the actual signer ---
  registerAppTool(
    server,
    "resolve_reservation_signer",
    {
      title: "Resolve who signed a reservation",
      description:
        "Internal: looks up the actual wallet that signed a reservation transaction, via its " +
        "Solana Pay reference key. Returns null if the transaction hasn't landed yet.",
      inputSchema: { reference: z.string() },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async (args) => {
      const signer = await findSignerByReference(args.reference);
      return { content: [{ type: "text", text: JSON.stringify({ signer }) }], structuredContent: { signer } };
    }
  );
}