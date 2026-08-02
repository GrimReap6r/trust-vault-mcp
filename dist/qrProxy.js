const shortLinks = new Map();
const TTL_MS = 5 * 60 * 1000;
export function registerShortLink(targetUrl) {
    const id = Math.random().toString(36).slice(2, 10);
    shortLinks.set(id, targetUrl);
    setTimeout(() => shortLinks.delete(id), TTL_MS).unref();
    return id;
}
export async function proxyQr(req, res) {
    const target = shortLinks.get(String(req.params.id));
    if (!target)
        return res.status(404).json({ error: "Unknown or expired QR" });
    const upstream = await fetch(target, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });
    res.status(upstream.status).json(await upstream.json());
}
