// src/qrProxy.ts
// Short-lived id -> full Next.js instant-reserve URL. Wallets fetch the
// short /qr/:id URL (that's what's IN the QR); this proxies the real
// request through to your existing route server-to-server, so the QR
// itself stays tiny regardless of how much the actual request needs.
import type { Request, Response } from "express";

const shortLinks = new Map<string, string>();

// Exported so checkoutPage.ts's landing page can genuinely reuse this TTL
// instead of hardcoding "5 minutes" a second time somewhere else -- if
// this ever changes, both the proxy and the human-facing page stay in sync
// automatically instead of silently drifting apart.
export const SHORT_LINK_TTL_MS = 5 * 60 * 1000;

export function registerShortLink(targetUrl: string): string {
  const id = Math.random().toString(36).slice(2, 10);
  shortLinks.set(id, targetUrl);
  setTimeout(() => shortLinks.delete(id), SHORT_LINK_TTL_MS).unref();
  return id;
}

/** Used by proxyQr (POST/GET passthrough) AND checkoutPage.ts (renders the
 * human-facing landing page) -- both read from the same store, so a link
 * that's expired for one is expired for the other, by construction. */
export function getShortLink(id: string): string | undefined {
  return shortLinks.get(id);
}

export async function proxyQr(req: Request, res: Response) {
  const target = getShortLink(String(req.params.id));
  if (!target) return res.status(404).json({ error: "Unknown or expired QR" });
  const upstream = await fetch(target, {
    method: req.method,
    headers: { "Content-Type": "application/json" },
    body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
  });
  res.status(upstream.status).json(await upstream.json());
}