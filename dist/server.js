import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { getMarketRates, listOpenOrders, listKnownTokens } from "./tools/marketData.js";
import { getOrderStatus } from "./tools/orderStatus.js";
import { getPlatformStats, getFeeStructure } from "./tools/platformStats.js";
import { getProtocolOverview, getCurrenciesAndProcessors } from "./tools/staticInfo.js";
import { SUPPORTED_CURRENCIES } from "./constants.js";
function textResult(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function buildServer() {
    const server = new McpServer({
        name: "trust-vault",
        version: "0.1.0",
    });
    server.registerTool("get_protocol_overview", {
        title: "Trust Vault protocol overview",
        description: "Explains what Trust Vault is: non-custodial P2P crypto-to-fiat settlement on Solana, " +
            "how escrow and validator consensus work, LP vs merchant roles. Use for general " +
            '"what is Trust Vault" / "how does it work" questions.',
        inputSchema: {},
    }, async () => textResult({ overview: getProtocolOverview() }));
    server.registerTool("list_known_tokens", {
        title: "Tokens currently traded on Trust Vault",
        description: "Lists tokens (mint address + decimals) that currently have at least one open order " +
            "on Trust Vault. Derived live from on-chain orders, not a fixed list -- a token only " +
            "shows up here if it's actually being traded right now.",
        inputSchema: {},
    }, async () => textResult(await listKnownTokens()));
    server.registerTool("get_market_rates", {
        title: "Best available market rate",
        description: "Returns the best available BUY-order rate for a token/currency pair -- i.e. the best " +
            "rate a seller would get right now. Optionally filter by mint address and/or currency. " +
            "Use list_known_tokens or list_open_orders first to find a valid mint address.",
        inputSchema: {
            token: z.string().optional().describe("Full mint address, e.g. from list_known_tokens"),
            currency: z.enum(SUPPORTED_CURRENCIES).optional(),
        },
    }, async (args) => textResult(await getMarketRates(args)));
    server.registerTool("list_open_orders", {
        title: "List open orders",
        description: "Lists currently open buy and/or sell orders on Trust Vault, optionally filtered by " +
            "order type, currency, or mint address.",
        inputSchema: {
            orderType: z.enum(["buy", "sell"]).optional(),
            currency: z.enum(SUPPORTED_CURRENCIES).optional(),
            token: z.string().optional().describe("Full mint address"),
        },
    }, async (args) => textResult(await listOpenOrders(args)));
    server.registerTool("get_order_status", {
        title: "Get order status",
        description: "Fetches the live on-chain status of a specific Trust Vault order by its address (PDA), " +
            "including available amount and any active reservations with their status " +
            "(pending / payment_sent / completed / cancelled / disputed).",
        inputSchema: {
            orderAddress: z.string().describe("Full base58 PDA of the TrustExpress order"),
        },
    }, async (args) => textResult(await getOrderStatus(args)));
    server.registerTool("get_platform_stats", {
        title: "Platform statistics",
        description: "Returns Trust Vault protocol-wide stats: total orders created/closed, total volume, " +
            "total fees collected, validator count, and dispute count.",
        inputSchema: {},
    }, async () => textResult(await getPlatformStats()));
    server.registerTool("get_fee_structure", {
        title: "Fee structure",
        description: "Returns Trust Vault's live protocol fee, read directly from the on-chain GlobalState account.",
        inputSchema: {},
    }, async () => textResult(await getFeeStructure()));
    server.registerTool("get_currencies_and_processors", {
        title: "Supported currencies and payment processors",
        description: "Lists fiat currencies and payment processors Trust Vault currently supports.",
        inputSchema: {},
    }, async () => textResult(getCurrenciesAndProcessors()));
    return server;
}
// --- Streamable HTTP transport wiring ---
// One MCP server + transport pair per session, per the SDK's session model.
const app = express();
// Claude.ai (and other MCP clients) connect to this server directly from the
// browser, so the response needs CORS headers -- in particular the session id
// header, which the client reads to keep making calls on the same session.
app.use(cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Mcp-Session-Id"],
}));
app.use(express.json());
// Cheap liveness check for Railway/uptime monitoring. The /mcp routes always
// require a valid MCP session (or reject with 400), so they're not useful
// for a basic "is the process up" check.
app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
});
// This service has no auth in front of it, so a simple per-IP rate limit
// keeps a stray script or scraper from burning through the Solana RPC
// provider's request quota. Tune the numbers as real usage patterns emerge.
const mcpRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please slow down." },
});
const transports = new Map();
app.post("/mcp", mcpRateLimiter, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
        const server = buildServer();
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
                transports.set(id, transport);
            },
        });
        // Clean up when the SESSION actually ends (client sends DELETE, or the
        // transport itself tears down) -- not when a single request's stream
        // closes. In HTTP/2 (which Railway uses), each POST is its own stream
        // and closes as soon as that response finishes sending, which is not
        // the same as the client being done with the session.
        transport.onclose = () => {
            if (transport?.sessionId)
                transports.delete(transport.sessionId);
        };
        await server.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", mcpRateLimiter, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
        res.status(400).send("Unknown or missing session");
        return;
    }
    await transport.handleRequest(req, res);
});
// Streamable HTTP clients may DELETE the session explicitly when they're
// done, so they don't leak in the in-memory transports map.
app.delete("/mcp", mcpRateLimiter, async (req, res) => {
    const sessionId = req.headers["mcp-session-id"];
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
        res.status(400).send("Unknown or missing session");
        return;
    }
    await transport.handleRequest(req, res);
    transports.delete(sessionId);
});
const PORT = process.env.PORT ?? 3939;
app.listen(PORT, () => {
    console.log(`Trust Vault MCP server listening on :${PORT}/mcp`);
});
