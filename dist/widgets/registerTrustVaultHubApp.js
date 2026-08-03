// src/widgets/registerTrustVaultHubApp.ts
//
// The PayBox-style entry point: one card, opened with no required args,
// that shows live per-currency rates plus Buy/Sell tabs inline -- mirrors
// TrustExpressPage's homepage (LiveTicker + StatsStrip + TabSwitcher +
// InlineBuyForm/InlineSellForm) as a single MCP App instead of a website.
//
// Sits ALONSIDE reserve_sell_order / reserve_buy_order, doesn't replace
// them -- a direct chat command ("buy 50000 NGN of USDC") still goes
// straight to the specific card; this one is for browsing/"bring up Trust
// Vault" with no specifics yet.
//
// All the actual reservation work is delegated to the SAME functions
// reserve_sell_order/reserve_buy_order already use (reserveSellOrder(),
// reserveBuyOrder()) -- wrapped here as app-only tools (visibility: ["app"])
// bound to the hub's own resourceUri, rather than calling the other cards'
// model-visible tools via callServerTool. Reason: those tools carry a
// resourceUri binding of their OWN, and calling a UI-bound tool from
// inside a different already-rendered card risks the host trying to pop a
// second card into the chat. A thin app-only wrapper avoids that ambiguity
// entirely -- same call, no rendering side effect.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { getHubRates, findBestOrder } from "../tools/hubRates.js";
import { reserveSellOrder } from "../tools/reserveSellOrder.js";
import { reserveBuyOrder } from "../tools/reserveBuyOrder.js";
import { getPaymentLink } from "../tools/paymentLinkLookup.js";
import { getReceiptByOrder } from "../tools/receiptByOrder.js";
const RESOURCE_URI = "ui://trust-vault/hub-v1";
const WIDGET_HTML_PATH = path.join(import.meta.dirname, "trustVaultHub.html");
const RESOURCE_DOMAINS = ["https://cdn.jsdelivr.net"];
const CONNECT_DOMAINS = [
    "https://cdn.jsdelivr.net",
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL.replace(/^https:/, "wss:")] : []),
];
export function registerTrustVaultHubApp(server) {
    registerAppResource(server, "Trust Vault Hub", RESOURCE_URI, {
        description: "Live Trust Vault home -- current rates per currency, Buy/Sell tabs, and reservation " +
            "flow, all in one card. Opens with no arguments needed.",
    }, async () => ({
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
    }));
    // --- open_trust_vault: model-visible entry point, renders the hub -------
    registerAppTool(server, "open_trust_vault", {
        title: "Open Trust Vault",
        description: "Opens the Trust Vault home card: live buy/sell rates for every currency with liquidity " +
            "right now, plus inline Buy/Sell forms to reserve an order without leaving the card. Use " +
            "this for a general 'bring up Trust Vault' / 'what are the rates' request with no specific " +
            "order or amount yet -- for a fully-specified request ('buy 50000 NGN of USDC') prefer " +
            "reserve_sell_order/reserve_buy_order directly.",
        inputSchema: {},
        _meta: { ui: { resourceUri: RESOURCE_URI } },
    }, async () => {
        const rates = await getHubRates();
        return {
            content: [{ type: "text", text: `Trust Vault is open -- ${rates.length} currencies have live liquidity right now.` }],
            structuredContent: { rates },
        };
    });
    // --- app-only: refresh rates ---------------------------------------------
    registerAppTool(server, "hub_refresh_rates", {
        title: "Refresh hub rates",
        description: "Internal: re-fetch live per-currency rates for the hub card.",
        inputSchema: {},
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async () => {
        const rates = await getHubRates();
        return { content: [{ type: "text", text: JSON.stringify(rates) }], structuredContent: { rates } };
    });
    // --- app-only: resolve the order to reserve against ----------------------
    registerAppTool(server, "hub_find_best_order", {
        title: "Find best order for a currency",
        description: "Internal: resolves the best open order for the hub's Buy/Sell form once currency + side are chosen.",
        inputSchema: { orderType: z.enum(["buy", "sell"]), currency: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await findBestOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    // --- app-only: kick off a buy-tab reservation (reserve_sell_order) -------
    registerAppTool(server, "hub_reserve_sell_order", {
        title: "Reserve a sell order (from the hub)",
        description: "Internal: same as reserve_sell_order, called from inside the hub card's Buy tab.",
        inputSchema: { orderAddress: z.string(), amount: z.number() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await reserveSellOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    // --- app-only: kick off a sell-tab reservation (reserve_buy_order) -------
    registerAppTool(server, "hub_reserve_buy_order", {
        title: "Reserve a buy order (from the hub)",
        description: "Internal: same as reserve_buy_order, called from inside the hub card's Sell tab.",
        inputSchema: {
            orderAddress: z.string(),
            amount: z.number(),
            payoutDetails: z.object({
                accountNumber: z.string(),
                bankCode: z.string(),
                bankName: z.string(),
                beneficiaryName: z.string(),
            }),
        },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await reserveBuyOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    // --- app-only: poll payment link (buy-tab, mirrors get_reservation_payment_link) ---
    registerAppTool(server, "hub_get_payment_link", {
        title: "Get reservation payment link (hub poll)",
        description: "Internal: single non-blocking payment-link lookup for the hub's Buy-tab poll loop.",
        inputSchema: { payoutReference: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const link = await getPaymentLink(args.payoutReference);
        const result = link ? { found: true, ...link } : { found: false };
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    // --- app-only: manual receipt fallback (both tabs) ------------------------
    registerAppTool(server, "hub_get_receipt", {
        title: "Get receipt (hub fallback)",
        description: "Internal: on-demand receipt check for the hub card's 'Check now' button, used if Realtime drops.",
        inputSchema: { orderAddress: z.string(), fiatAmount: z.number(), currency: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await getReceiptByOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
}
