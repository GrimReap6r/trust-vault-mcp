import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
// @coral-xyz/anchor is CommonJS -- see tools/prepareOrder.ts for why BN has
// to come off the default export instead of a named import.
import anchorPkg from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { getMarketRates, listOpenOrders, listKnownTokens } from "./tools/marketData.js";
import { getOrderStatus } from "./tools/orderStatus.js";
import { getPlatformStats, getFeeStructure } from "./tools/platformStats.js";
import { getProtocolOverview, getCurrenciesAndProcessors } from "./tools/staticInfo.js";
import { SUPPORTED_CURRENCIES } from "./constants.js";
import { prepareBuyOrder, buildCreateBuyOrderAccounts } from "./tools/prepareOrder.js";
import { getReceiptByReference, findReceipt } from "./tools/receipt.js";
import { waitForPayment } from "./tools/waitForPayment.js";
import { getIntent } from "./paymentIntents.js";
import { getProgram, getConnection } from "./program.js";
import { proxyQr } from "./qrProxy.js";
import { registerMerchantQrApp } from "./widgets/registerMerchantQrApp.js";

const { BN } = anchorPkg;

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/**
 * For tool results that include a QR code. Previously these shipped the QR
 * as a `data:image/png;base64,...` string inside the JSON text blob --
 * Claude.ai's client rendered that as a clickable "Show Image" link, but
 * clicking it made the browser tab navigate directly to a data: URL, which
 * Chrome blocks as a top-level navigation (has for a few years now, as an
 * anti-phishing measure) -- hence the blank page, not corrupted image data.
 *
 * MCP's content array supports a real `image` block (base64 + mimeType)
 * that MCP clients, including Claude.ai, render inline in the chat with no
 * navigation involved. `qrCodeDataUri` is stripped out of the JSON text
 * (replaced with a pointer) since it'd otherwise be duplicated in full --
 * once as the unusable data: URI, once as the actual image block.
 */
function imageResult(data: Record<string, unknown> & { qrCodeDataUri: string }) {
  const prefix = "base64,";
  const idx = data.qrCodeDataUri.indexOf(prefix);
  if (idx === -1) {
    throw new Error(`qrCodeDataUri is not a base64 data URI: ${data.qrCodeDataUri.slice(0, 40)}...`);
  }
  const base64 = data.qrCodeDataUri.slice(idx + prefix.length);

  const { qrCodeDataUri: _drop, ...rest } = data;
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ ...rest, qrCode: "(see attached image)" }, null, 2) },
      { type: "image" as const, data: base64, mimeType: "image/png" },
    ],
  };
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
    "list_known_tokens",
    {
      title: "Tokens currently traded on Trust Vault",
      description:
        "Lists tokens (mint address + decimals) that currently have at least one open order " +
        "on Trust Vault. Derived live from on-chain orders, not a fixed list -- a token only " +
        "shows up here if it's actually being traded right now.",
      inputSchema: {},
    },
    async () => textResult(await listKnownTokens())
  );

  server.registerTool(
    "get_market_rates",
    {
      title: "Best available market rate",
      description:
        "Returns the best available BUY-order rate for a token/currency pair -- i.e. the best " +
        "rate a seller would get right now. Optionally filter by mint address and/or currency. " +
        "Use list_known_tokens or list_open_orders first to find a valid mint address.",
      inputSchema: {
        token: z.string().optional().describe("Full mint address, e.g. from list_known_tokens"),
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
        "order type, currency, or mint address.",
      inputSchema: {
        orderType: z.enum(["buy", "sell"]).optional(),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
        token: z.string().optional().describe("Full mint address"),
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
        "including available amount and any active reservations. Reservation status labels " +
        "are pending / completed / expired_refunded (confirmed against submit_validator_vote.rs " +
        "and finalize_expired_vote) -- note a REJECTED reservation is indistinguishable from a " +
        "COMPLETED one purely from this on-chain data once it's removed; use get_receipt or " +
        "wait_for_payment for a real success signal, not this alone.",
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
      description:
        "Returns Trust Vault's live protocol fee, read directly from the on-chain GlobalState account.",
      inputSchema: {},
    },
    async () => textResult(await getFeeStructure())
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

  server.registerTool(
    "prepare_buy_order",
    {
      title: "Prepare a new BUY order (LP)",
      description:
        "For an LP creating a new express buy order. Validates inputs, derives the order's " +
        "future TrustExpress PDA, and returns a Solana Pay QR/URL -- scanning it with Phantom " +
        "or Backpack lets the LP review and sign the create_express_buy_order transaction. " +
        "Does not move funds itself.",
      inputSchema: {
        buyerWallet: z.string().describe("LP's base58 wallet pubkey"),
        mint: z.string().describe("Full token mint address"),
        amount: z.number().describe("Amount in display units, e.g. 500 (not raw)"),
        pricePerToken: z.number().describe("Plain whole-currency units per whole token, e.g. 1650 = ₦1650/token"),
        currency: z.enum(SUPPORTED_CURRENCIES),
        paymentInstructions: z.string().max(100),
        credentialId: z.string().optional(),
      },
    },
    async (args) => imageResult(await prepareBuyOrder(args))
  );

  // ── generate_merchant_qr now lives in registerMerchantQrApp -------------
  // Moved out of this plain server.registerTool block: it's now an MCP App
  // tool (renders the live QR/status card widget), registered via
  // registerMerchantQrApp(server) below buildServer(), alongside its
  // supporting app-only tool get_receipt_by_order. See
  // src/widgets/registerMerchantQrApp.ts.

  // ── New: receipt + wait-for-payment tools ────────────────────────────────
  // Neither was previously registered, even though receipt.ts and
  // waitForPayments.ts already implemented them -- get_order_status alone
  // can't tell a completed reservation apart from a rejected one once it's
  // removed (see submit_validator_vote.rs's rejection branch, which calls
  // the same reserved_amounts.remove(idx) as the success branch). These two
  // close that gap: a receipts row is the actual off-chain-verified success
  // signal (receipt.ts's module doc), and wait_for_payment is the bounded
  // poll that watches for one to appear.

  server.registerTool(
    "get_receipt",
    {
      title: "Get a payment receipt",
      description:
        "Looks up a Trust Vault payment receipt by its payout reference (the IP-<timestamp>-" +
        "<takerprefix> string from a reservation event). A receipt row only ever exists after " +
        "the off-chain payout processor (Flutterwave/Paystack/Korapay) verified the transfer " +
        "succeeded -- it is never written on rejection or timeout -- so finding one here is a " +
        "reliable success signal, unlike an absent on-chain reservation alone. Returns null if " +
        "no receipt exists yet (which can mean still pending, rejected, or expired -- use " +
        "get_order_status or wait_for_payment to tell those apart).",
      inputSchema: {
        payoutReference: z.string().describe("The payout_reference emitted at reservation time, e.g. IP-1785657017-7mCgjRcy"),
      },
    },
    async (args) => textResult(await getReceiptByReference(args.payoutReference))
  );

  server.registerTool(
    "find_receipt",
    {
      title: "Find a payment receipt by order + taker",
      description:
        "Alternative receipt lookup for when you have the TrustExpress order address and the " +
        "taker's wallet but not the payout_reference string itself (e.g. right after calling " +
        "generate_merchant_qr, before the wallet has scanned). Matches on " +
        "trust_express_address + taker_address + a since-timestamp, since payout_reference " +
        "isn't known to this server until the customer's wallet generates it on-chain. Returns " +
        "null if no matching receipt exists yet.",
      inputSchema: {
        trustExpressAddress: z.string().describe("Full base58 PDA of the TrustExpress order"),
        takerAddress: z.string().describe("Base58 wallet pubkey of the paying customer"),
        sinceIso: z.string().describe("ISO 8601 timestamp -- only receipts created at or after this time are considered"),
      },
    },
    async (args) => textResult(await findReceipt(args))
  );

  server.registerTool(
    "wait_for_payment",
    {
      title: "Wait for a payment to settle",
      description:
        "Bounded poll (up to ~40s, checking every 4s) for a reservation to resolve. Call this " +
        "right after generate_merchant_qr and a customer scan if you want to wait for " +
        "confirmation instead of asking again later. Distinguishes three outcomes: 'success' " +
        "(a matching receipts row was found -- the only trustworthy success signal), 'unknown' " +
        "(the reservation is no longer active on-chain but no receipt appeared -- could be " +
        "rejected or refunded, check your dashboard/bank app before treating this as paid), or " +
        "'pending' (still active after 40s -- call again, nothing was lost).",
      inputSchema: {
        orderAddress: z.string().describe("Full base58 PDA of the TrustExpress order"),
        trustExpressAddress: z.string().describe("Same PDA as orderAddress -- used as the receipt lookup key"),
        takerWallet: z.string().describe("Base58 wallet pubkey of the paying customer"),
        sinceUnixSeconds: z.number().describe("Unix timestamp (seconds) of when the reservation was created -- only reservations at or after this time are watched"),
      },
    },
    async (args) => textResult(await waitForPayment(args))
  );

  // ── MCP App: merchant QR card (generate_merchant_qr + get_receipt_by_order) ──
  // Renders inline as a live status card instead of raw JSON/base64 -- see
  // src/widgets/registerMerchantQrApp.ts for the full rationale.
  registerMerchantQrApp(server);

  return server;
}

// --- Streamable HTTP transport wiring ---
// One MCP server + transport pair per session, per the SDK's session model.
const app = express();

// Claude.ai (and other MCP clients) connect to this server directly from the
// browser, so the response needs CORS headers -- in particular the session id
// header, which the client reads to keep making calls on the same session.
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Mcp-Session-Id"],
  })
);

app.use(express.json());

// Cheap liveness check for Railway/uptime monitoring. The /mcp routes always
// require a valid MCP session (or reject with 400), so they're not useful
// for a basic "is the process up" check.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Solana Pay transaction-request routes. Only used by prepare_buy_order's
// flow (LP creating a new order) -- generate_merchant_qr points at Trust
// Vault's existing Next.js /api/solana-pay/instant-reserve route instead,
// so it never hits these.
app.get("/pay/:reference", async (req, res) => {
  const intent = getIntent(req.params.reference);
  if (!intent) return res.status(404).json({ error: "Unknown or expired payment request" });
  res.json({
    label: "Trust Vault",
    icon: "https://trustv6ult.xyz/icon.png", // TODO: confirm this asset actually exists
  });
});

app.post("/pay/:reference", async (req, res) => {
  const intent = getIntent(req.params.reference);
  if (!intent) return res.status(404).json({ error: "Unknown or expired payment request" });

  const walletPubkey = new PublicKey(req.body.account); // wallet identifies itself here
  const program = getProgram();

  let transaction;
  if (intent.kind === "create_buy_order") {
    // Accounts confirmed against trust_express.json's
    // instructions[name="create_express_buy_order"].accounts -- see
    // buildCreateBuyOrderAccounts in tools/prepareOrder.ts for the source.
    const accounts = await buildCreateBuyOrderAccounts({
      buyer: walletPubkey,
      mint: intent.mint,
      seed: BigInt(intent.seed),
    });

    transaction = await program.methods
      .createExpressBuyOrder(
        new BN(intent.seed),
        new BN(intent.amountRaw),
        new BN(intent.pricePerToken),
        Array.from(Buffer.from(intent.currency)),
        intent.paymentInstructions,
        intent.credentialId
      )
      .accounts(accounts as any)
      .transaction();
  } else {
    // reserve_against_buy_order path shouldn't reach here in practice --
    // generate_merchant_qr no longer stores this intent kind, it routes
    // straight to the existing instant-reserve endpoint instead. The IDL's
    // instant_reserve accounts ARE now confirmed too (trust_express,
    // maker, taker, mint, taker_ata, trust_express_ata, global_state,
    // token_program, associated_token_program, system_program) if this
    // ever needs wiring up for real.
    return res.status(501).json({ error: "instant_reserve builder not wired for this route" });
  }

  transaction.feePayer = walletPubkey;
  const { blockhash } = await getConnection().getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  const serialized = transaction.serialize({ requireAllSignatures: false }).toString("base64");
  res.json({ transaction: serialized, message: "Confirm your Trust Vault order" });
});

// Short-link proxy for generate_merchant_qr. The QR itself only ever
// encodes solana:<PUBLIC_BASE_URL>/qr/:id -- this forwards the GET/POST
// through to the real (much longer) Next.js instant-reserve URL registered
// in merchantQr.ts, so wallet scanners see a small, low-density code
// instead of the full query-string URL. See src/qrProxy.ts.
app.get("/qr/:id", proxyQr);
app.post("/qr/:id", proxyQr);

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

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", mcpRateLimiter, async (req, res) => {
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
    // Clean up when the SESSION actually ends (client sends DELETE, or the
    // transport itself tears down) -- not when a single request's stream
    // closes. In HTTP/2 (which Railway uses), each POST is its own stream
    // and closes as soon as that response finishes sending, which is not
    // the same as the client being done with the session.
    transport.onclose = () => {
      if (transport?.sessionId) transports.delete(transport.sessionId);
    };
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", mcpRateLimiter, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
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
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing session");
    return;
  }
  await transport.handleRequest(req, res);
  transports.delete(sessionId!);
});

const PORT = process.env.PORT ?? 3939;
app.listen(PORT, () => {
  console.log(`Trust Vault MCP server listening on :${PORT}/mcp`);
});