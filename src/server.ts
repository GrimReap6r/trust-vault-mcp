import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { getMarketRates, listOpenOrders } from "./tools/marketData.js";
import { getOrderStatus } from "./tools/orderStatus.js";
import { getPlatformStats } from "./tools/platformStats.js";
import {
  getProtocolOverview,
  getSupportedTokens,
  getFeeStructure,
  getCurrenciesAndProcessors,
} from "./tools/staticInfo.js";
import { SUPPORTED_CURRENCIES } from "./constants.js";

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function buildServer(): McpServer {
  const server = new McpServer({
    name: "trust-vault",
    version: "0.1.0",
  });

  server.registerTool(
    "get_protocol_overview",
    {
      title: "Trust Vault protocol overview",
      description:
        "Explains what Trust Vault is: non-custodial P2P crypto-to-fiat settlement on Solana, " +
        "how escrow and validator consensus work, LP vs merchant roles. Use for general " +
        '"what is Trust Vault" / "how does it work" questions.',
      inputSchema: {},
    },
    async () => textResult({ overview: getProtocolOverview() })
  );

  server.registerTool(
    "get_supported_tokens",
    {
      title: "Supported tokens",
      description: "Lists tokens Trust Vault supports (symbol, mint address, decimals).",
      inputSchema: {},
    },
    async () => textResult(getSupportedTokens())
  );

  server.registerTool(
    "get_market_rates",
    {
      title: "Best available market rate",
      description:
        "Returns the best available BUY-order rate for a token/currency pair — i.e. the best " +
        "rate a seller would get right now. Optionally filter by token symbol and/or currency.",
      inputSchema: {
        token: z.string().optional().describe('Token symbol, e.g. "USDC"'),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
      },
    },
    async (args) => textResult(await getMarketRates(args))
  );

  server.registerTool(
    "list_open_orders",
    {
      title: "List open orders",
      description:
        "Lists currently open buy and/or sell orders on Trust Vault, optionally filtered by " +
        "order type, currency, or token.",
      inputSchema: {
        orderType: z.enum(["buy", "sell"]).optional(),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
        token: z.string().optional(),
      },
    },
    async (args) => textResult(await listOpenOrders(args))
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get order status",
      description:
        "Fetches the live on-chain status of a specific Trust Vault order by its address (PDA), " +
        "including available amount and any active reservations with their status " +
        "(pending / payment_sent / completed / cancelled / disputed).",
      inputSchema: {
        orderAddress: z.string().describe("Full base58 PDA of the TrustExpress order"),
      },
    },
    async (args) => textResult(await getOrderStatus(args))
  );

  server.registerTool(
    "get_platform_stats",
    {
      title: "Platform statistics",
      description:
        "Returns Trust Vault protocol-wide stats: total orders created/closed, total volume, " +
        "total fees collected, validator count, and dispute count.",
      inputSchema: {},
    },
    async () => textResult(await getPlatformStats())
  );

  server.registerTool(
    "get_fee_structure",
    {
      title: "Fee structure",
      description: "Returns Trust Vault's protocol fee and how it's split between LPs, platform, and validators.",
      inputSchema: {},
    },
    async () => textResult(getFeeStructure())
  );

  server.registerTool(
    "get_currencies_and_processors",
    {
      title: "Supported currencies and payment processors",
      description: "Lists fiat currencies and payment processors Trust Vault currently supports.",
      inputSchema: {},
    },
    async () => textResult(getCurrenciesAndProcessors())
  );

  return server;
}

// --- Streamable HTTP transport wiring ---
// One MCP server + transport pair per session, per the SDK's session model.
const app = express();
app.use(express.json());

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const server = buildServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    res.on("close", () => {
      if (transport?.sessionId) transports.delete(transport.sessionId);
    });
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing session");
    return;
  }
  await transport.handleRequest(req, res);
});

const PORT = process.env.PORT ?? 3939;
app.listen(PORT, () => {
  console.log(`Trust Vault MCP server listening on :${PORT}/mcp`);
});
