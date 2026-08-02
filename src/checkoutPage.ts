// src/checkoutPage.ts
import type { Request, Response } from "express";
import { getShortLink } from "./qrProxy.js";
import { qrDataUri } from "./solanaPay.js";

/**
 * Human-facing landing page for a merchant QR's short link -- what "Copy
 * pay link" copies, NOT the raw solana: URI. Pasting a solana: URI into a
 * browser address bar does nothing useful (no registered protocol
 * handler, confirmed via a real test -- it just falls through to a Google
 * search). This page exists to be the thing that DOES something: shows
 * the QR for a second device to scan, and offers an "Open in wallet" link,
 * which browsers DO respect for registered schemes when it's a real click
 * (a user gesture) rather than a pasted omnibox string. Same split
 * CopyPoolLinkButton already uses for LP pool links (pageLink vs blinkUrl).
 *
 * Uses the SAME expiry as the underlying short link (qrProxy.ts's
 * SHORT_LINK_TTL_MS) -- Option A, decided over moving this into the
 * Next.js app, specifically to avoid making the core web app's checkout
 * page depend on this separately-deployed MCP server's uptime.
 */
export async function renderCheckoutPage(req: Request, res: Response) {
  const target = getShortLink(String(req.params.id));
  if (!target) {
    res.status(404).send(renderExpiredPage());
    return;
  }

  const targetUrl = new URL(target);
  const fiatAmount = targetUrl.searchParams.get("fiatAmount");
  const currency = targetUrl.searchParams.get("currency");
  const solanaUri = `solana:${encodeURIComponent(target)}`;
  const qr = await qrDataUri(solanaUri);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderCard({ fiatAmount, currency, qr, solanaUri }));
}

function renderCard(args: {
  fiatAmount: string | null;
  currency: string | null;
  qr: string;
  solanaUri: string;
}): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pay with Trust Vault</title>
<style>
  body { font-family: -apple-system, sans-serif; background:#0b0c0f; color:#f2f2f2;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { max-width: 360px; padding: 24px; text-align:center; }
  .amount { font-size: 28px; font-weight: 700; margin-bottom: 16px; }
  img { width: 240px; height: 240px; border-radius: 12px; background:#fff; padding: 12px; }
  a.btn { display:block; margin-top:20px; padding:14px; border-radius:10px;
          background:#E8480A; color:#fff; text-decoration:none; font-weight:700; }
  button { margin-top:12px; padding:10px 14px; border-radius:10px; border:1px solid #333;
           background:#1a1b1f; color:#f2f2f2; cursor:pointer; width:100%; }
</style>
</head>
<body>
  <div class="card">
    ${args.fiatAmount ? `<div class="amount">${args.currency ?? ""}${args.fiatAmount}</div>` : ""}
    <img src="${args.qr}" alt="Scan to pay" />
    <a class="btn" href="${args.solanaUri}">Open in wallet</a>
    <button onclick="navigator.clipboard.writeText('${args.solanaUri}').then(()=>{this.textContent='Copied!'})">Copy raw payment link</button>
  </div>
  <script>
    // Best-effort auto-redirect on mobile if a wallet registered the
    // solana: scheme -- harmless no-op otherwise, the button still works.
    if (/Android|iPhone/i.test(navigator.userAgent)) {
      window.location.href = "${args.solanaUri}";
    }
  </script>
</body>
</html>`;
}

function renderExpiredPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Link expired</title>
<style>body{font-family:-apple-system,sans-serif;background:#0b0c0f;color:#f2f2f2;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;}</style>
</head><body><div><h1>This payment link has expired.</h1>
<p>Ask the merchant to generate a new QR code.</p></div></body></html>`;
}