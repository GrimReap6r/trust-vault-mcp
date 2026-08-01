# Trust Vault MCP Server — Phase 1 (Read-Only)

Exposes 8 read-only Trust Vault tools over MCP (Streamable HTTP transport):
`get_protocol_overview`, `get_supported_tokens`, `get_market_rates`,
`list_open_orders`, `get_order_status`, `get_platform_stats`,
`get_fee_structure`, `get_currencies_and_processors`.

No wallet, no signing, no auth surface — pure on-chain reads + static config.

## Setup

```bash
npm install
```

Set env vars (or a `.env` if you wire one in):

```
TRUST_EXPRESS_IDL_PATH=/path/to/your/trust_express.json   # your real Anchor IDL
SOLANA_RPC_URL=https://api.devnet.solana.com                # or mainnet
TRUST_VAULT_KNOWLEDGE_PATH=/path/to/knowledge/trustvault.md # same file /api/chat already loads
PORT=3939
```

```bash
npm run build
npm start
```

## Before this goes live — 3 things to fix, all flagged inline in code

1. **`src/tools/fetchOrders.ts` — `pricePerToken` scale is unconfirmed.**
   The program docs say "fiat per whole token, raw fiat units" but don't
   state whether NGN is stored as whole naira or kobo (×100). Currently
   passed through raw. Check against `BuyOrderCard`/`SellOrderCard` display
   logic in the client and fix that one line — it's load-bearing for every
   tool that surfaces a price.

2. **`src/program.ts` — point `TRUST_EXPRESS_IDL_PATH` at your real IDL.**
   Deliberately not faked. The server refuses to start (with a clear error)
   if the file is missing, and separately refuses to start if the IDL's
   `address` field doesn't match the known program ID in `constants.ts` —
   catches a devnet/mainnet mix-up before it causes silent wrong reads.

3. **`src/constants.ts` — `FEE_STRUCTURE`.**
   Set to the corrected 50% LP / 30% platform / 20% validators split. The
   `trust-vault` skill file still says 40/40/20 — that's stale, don't copy
   from it. Fix the skill file separately so future docs don't drift again.

## Known issue — needs a look before you rely on multi-request sessions

While testing the Streamable HTTP session handling (`src/server.ts`), I hit
a case where `tools/list` returned `"Server not initialized"` on the request
immediately following a successful `initialize` — i.e. the `onsessioninitialized`
callback's `transports.set(id, transport)` didn't appear to be visible yet
on the next request in the same process. I didn't get to root-cause this
before switching to just handing off the files — it may be a real race in
how `server.connect()` vs `transport.handleRequest()` are sequenced here,
or it may have been sandbox process weirdness (multiple stale `node`
processes potentially fighting over the port during testing). Worth
re-testing this cleanly in your own environment — if it reproduces there
too, the `app.post("/mcp", ...)` handler in `src/server.ts` is where to dig
in, specifically whether `onsessioninitialized` fires and populates the
`transports` map before the *next* HTTP request's lookup runs.

## Design notes

- Every tool is read-only — no `.methods()` calls, only `.account.fetch()`/`.all()`.
  The Anchor provider has no real signer (see comment in `src/program.ts`) —
  it throws if anything ever tries to sign, as a deliberate guardrail.
- `get_order_status` deliberately does NOT fetch `ValidatorVote` PDAs
  (votes_for/votes_against/executed) — that's a separate account keyed off
  `keccak256(payout_reference)`, out of scope for general-info tools. See
  `src/tools/orderStatus.ts` for the reasoning.
- `get_protocol_overview` reads the same `knowledge/trustvault.md` your
  `/api/chat` route already loads — update one file, both surfaces pick it up.
