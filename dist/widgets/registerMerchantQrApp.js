// src/widgets/registerMerchantQrApp.ts
//
// v3 -- bumped RESOURCE_URI (merchant-qr-card -> merchant-qr-card-v2).
// Reasoning: after fixing the widget's bridge-timing bug in
// merchantQrCard.html and redeploying, the SAME error kept recurring
// byte-for-byte identical (same message, same line, same stack) in
// Claude.ai's console. That's the signature of a host-side cache hit, not
// the bug re-occurring independently -- the resource is served through a
// stable per-connector domain (43b0f70d...claudemcpcontent.com, hashed
// from this MCP server's URL), which strongly suggests Claude.ai caches
// resource content against the resource URI rather than re-fetching on
// every tool call. Changing the URI is the simplest way to guarantee a
// cache miss: there's nothing cached yet for a URI that didn't exist
// before. If this fixes it, we've confirmed the caching theory. If the
// identical error still recurs against the new URI, that rules caching
// out and points back at something in the widget code itself.
//
// v2 -- after checking how page.tsx actually solves this: the card does NOT
// need to discover a taker wallet or poll a bounded-wait tool as its
// primary mechanism. It opens its own Supabase Realtime subscription
// (postgres_changes on receipts INSERT, filtered by trust_express_address)
// directly inside the sandboxed iframe -- the exact same pattern the
// Next.js merchant page already uses. That's a push, not a poll, and it
// needs zero knowledge of who's going to pay.
//
// get_receipt_by_order is kept as a narrow, on-demand fallback for the
// widget's "Check now" button (Realtime sockets can drop), NOT as a polling
// loop -- see receiptByOrder.ts's doc comment on why its trust boundary
// deliberately matches the Realtime filter rather than trying to be
// stricter.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { generateMerchantQr } from "../tools/merchantQr.js";
import { getReceiptByOrder } from "../tools/receiptByOrder.js";
// Bumped from "ui://trust-vault/merchant-qr-card" -- see v3 note above.
const RESOURCE_URI = "ui://trust-vault/merchant-qr-card-v2";
// tsc does NOT copy .html files into dist/ automatically -- this path only
// resolves correctly if your build step copies merchantQrCard.html
// alongside the compiled .js (see the "copy-widgets" step in package.json).
const WIDGET_HTML_PATH = path.join(import.meta.dirname, "merchantQrCard.html");
// Domains the widget's iframe is allowed to reach. MCP App CSP is
// restrictive-by-default -- undeclared domains are blocked by the host.
// Full origin URLs required (not bare hostnames) per McpUiResourceCsp.
const RESOURCE_DOMAINS = ["https://cdn.jsdelivr.net"];
const CONNECT_DOMAINS = [
    "https://cdn.jsdelivr.net",
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    // Supabase Realtime connects over wss:// to the same project host --
    // declare both schemes since CSP domain matching is scheme-sensitive.
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL.replace(/^https:/, "wss:")] : []),
];
export function registerMerchantQrApp(server) {
    // --- UI resource: the card itself -------------------------------------
    registerAppResource(server, "Merchant QR Card", RESOURCE_URI, { description: "Live merchant payment QR card with self-updating payment status" }, async () => ({
        contents: [
            {
                uri: RESOURCE_URI,
                mimeType: RESOURCE_MIME_TYPE,
                text: await fs.readFile(WIDGET_HTML_PATH, "utf-8"),
                _meta: {
                    ui: {
                        csp: {
                            resourceDomains: RESOURCE_DOMAINS,
                            connectDomains: CONNECT_DOMAINS,
                        },
                    },
                },
            },
        ],
    }));
    // --- generate_merchant_qr: model-visible, renders the card -------------
    registerAppTool(server, "generate_merchant_qr", {
        title: "Generate Merchant QR",
        description: "Finds the best available open BUY order for a fiat amount/currency and " +
            "renders a live merchant payment card (QR, payout details, and a status " +
            "badge that updates itself the instant the customer's payment settles) " +
            "-- no follow-up 'is it downloadable' or 'poll the receipt' turns needed.",
        inputSchema: {
            currency: z.string(),
            fiatAmount: z.number(),
            payoutDetails: z.object({
                accountNumber: z.string(),
                bankCode: z.string(),
                bankName: z.string(),
                beneficiaryName: z.string(),
            }),
        },
        _meta: { ui: { resourceUri: RESOURCE_URI } },
    }, async (args) => {
        const result = await generateMerchantQr(args);
        return {
            content: [
                {
                    type: "text",
                    text: result.found
                        ? `Generated a ₦${args.fiatAmount} merchant QR for ${args.payoutDetails.beneficiaryName}.`
                        : result.message ?? "No liquidity available.",
                },
            ],
            structuredContent: result,
        };
    });
    // --- get_receipt_by_order: app-only, manual fallback --------------------
    registerAppTool(server, "get_receipt_by_order", {
        title: "Get Receipt By Order",
        description: "Internal: on-demand fallback receipt check for the merchant-qr-card " +
            "'Check now' button, used only if its Realtime subscription drops.",
        inputSchema: { orderAddress: z.string(), fiatAmount: z.number(), currency: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await getReceiptByOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
}
