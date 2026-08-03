// src/tools/credentialCheck.ts
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
/**
 * Checks whether a wallet already has a saved, active processor credential
 * -- BEFORE offering to create an order via chat. Reuses the same list
 * routes the Settings page's credential picker calls
 * (/api/flutterwave/{buyer,seller}-credentials/list), which return only
 * {id, label, created_at, is_active, last_verified} -- no secrets, ever.
 *
 * Why this check has to happen first: flutterwave_credential_id is
 * OPTIONAL at the instruction level (create_express_buy_order/sell don't
 * require it), so a credential-less order succeeds on-chain and looks
 * completely normal in list_open_orders -- right up until someone reserves
 * against it and bot.ts's lookup throws "No credential linked to this
 * sell order." For sell orders specifically, tokens are already deposited
 * at creation, so a credential-less sell order can leave real funds
 * escrowed with no way to ever settle a trade against them.
 */
export async function findActiveCredential(args) {
    if (!APP_URL) {
        throw new Error("NEXT_PUBLIC_APP_URL is not set -- needed to check saved credentials.");
    }
    const path = args.side === "buyer" ? "buyer-credentials" : "seller-credentials";
    const url = new URL(`/api/flutterwave/${path}/list`, APP_URL);
    url.searchParams.set("walletAddress", args.walletAddress);
    const res = await fetch(url.toString());
    if (!res.ok) {
        throw new Error(`Credential lookup failed (${res.status}) -- cannot safely offer order creation without this check.`);
    }
    const { credentials } = (await res.json());
    return credentials.find((c) => c.is_active) ?? null;
}
