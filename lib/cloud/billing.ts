import { RESTORED_FLAG } from "@/lib/cloud/keys";
import {
  loadEntitlements,
  saveEntitlements,
  type Entitlements,
} from "@/lib/monetization";

/**
 * The browser's half of billing.
 *
 * Two calls and one rule. The calls hand back a Stripe URL to navigate to; the
 * rule is that **the server's entitlements always win**.
 *
 * That rule is the exact opposite of the one lib/cloud/sync.ts uses for saves,
 * where "local always wins" stops a tab from swapping out the company you are
 * halfway through. Entitlements are not the player's data in that sense — they
 * are the receipt, and the receipt lives on the server precisely so that
 * editing localStorage does not buy anything. A device-local copy that
 * disagreed with the server would be the thing a player edits.
 *
 * The one exception is a device with no server row at all, which means no
 * purchase has ever been recorded. Then the local copy stands, because that is
 * the pre-billing `grantProLocally` grant and it is still the honest behaviour
 * on a deploy with no Stripe keys.
 */

export interface BillingStatus {
  configured: boolean;
  live: boolean;
  skus: string[];
}

/**
 * Whether this deploy can take money, for screens whose copy depends on it.
 *
 * Cached for the tab: it is derived from environment variables, so it cannot
 * change between two renders of the same page, and every pricing surface asks
 * the same question. Failure reads as "not configured", which is the answer
 * that keeps the pre-billing copy and the pre-billing behaviour together.
 */
let statusCache: Promise<BillingStatus> | null = null;

export function billingStatus(): Promise<BillingStatus> {
  if (!statusCache) {
    statusCache = fetch("/api/billing/status")
      .then((res) => (res.ok ? (res.json() as Promise<BillingStatus>) : null))
      .then((body) => body ?? { configured: false, live: false, skus: [] })
      .catch(() => ({ configured: false, live: false, skus: [] }));
  }
  return statusCache;
}

export type CheckoutSku =
  | "pro_monthly"
  | "pro_yearly"
  | "industry_pack"
  | "extra_run_slot";

/** What a checkout attempt can come back as. `url` means go there now. */
export type CheckoutResult =
  | { ok: true; url: string }
  | {
      ok: false;
      /**
       * `needs-account` is the refusal that matters. The player is signed in,
       * but only as an anonymous identity that lives in a cookie — checkout
       * will not sell to one, because clearing the browser would destroy the
       * purchase with no way to prove it happened. The caller sends them to
       * sign up and back.
       */
      reason: "not-configured" | "signed-out" | "needs-account" | "owned" | "error";
      message?: string;
    };

/**
 * Opens Stripe Checkout. Returns rather than navigating, so the caller decides
 * what a failure looks like — the pricing sheet falls back to the device-local
 * grant, and a paywall inside the game would rather show a message.
 */
export async function startCheckout(
  sku: CheckoutSku,
  industry?: string,
): Promise<CheckoutResult> {
  try {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku, ...(industry ? { industry } : {}) }),
    });
    const body = (await res.json()) as {
      configured?: boolean;
      signedIn?: boolean;
      needsAccount?: boolean;
      url?: string;
      error?: string;
    };

    // No Stripe keys on this deploy. Not an error: the caller falls back to the
    // behaviour the app had before billing existed.
    if (body.configured === false) return { ok: false, reason: "not-configured" };
    if (body.needsAccount) {
      return { ok: false, reason: "needs-account", message: body.error };
    }
    if (body.signedIn === false) return { ok: false, reason: "signed-out" };
    if (res.status === 409) return { ok: false, reason: "owned", message: body.error };
    if (!res.ok || !body.url) {
      return { ok: false, reason: "error", message: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, url: body.url };
  } catch (e) {
    // Offline, or the request was blocked. The game keeps working; only the
    // purchase does not happen.
    return { ok: false, reason: "error", message: (e as Error).message };
  }
}

/** Navigates to Stripe's hosted checkout, or reports why it could not. */
export async function goToCheckout(
  sku: CheckoutSku,
  industry?: string,
): Promise<CheckoutResult> {
  const result = await startCheckout(sku, industry);
  if (result.ok) window.location.href = result.url;
  return result;
}

/**
 * Opens the Stripe customer portal — cancel, switch plan, update card,
 * receipts. Returns false when this player has never bought anything, which is
 * the signal to keep the "Manage subscription" row hidden rather than show a
 * button that opens an error.
 */
export async function openBillingPortal(): Promise<boolean> {
  try {
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const body = (await res.json()) as { url?: string };
    if (!res.ok || !body.url) return false;
    window.location.href = body.url;
    return true;
  } catch {
    return false;
  }
}

/**
 * Adopts the server's entitlements into the local cache.
 *
 * Returns true when something actually changed, because the caller uses that
 * to decide whether the screen needs re-entering: several screens read
 * entitlements once at mount (`useState(() => isPro(loadEntitlements()))` in
 * ClosetScreen, and the industry grid in found), so a purchase completed on a
 * phone will not appear on a laptop mid-session without one.
 *
 * Passing `null` — no server row — leaves local alone. See the file comment.
 */
export function adoptEntitlements(server: Entitlements | null | undefined): boolean {
  if (!server) return false;
  const local = loadEntitlements();
  // Field-wise rather than a JSON string compare: the arrays come back from
  // Postgres in whatever order it stored them, and a reload on every boot
  // because two equal arrays sorted differently would be a nasty little loop.
  const same =
    local.pro === server.pro &&
    local.extraRunSlots === server.extraRunSlots &&
    local.chapter === server.chapter &&
    local.intent === server.intent &&
    sameSet(local.industryPacks, server.industryPacks) &&
    sameSet(local.cosmeticBundles, server.cosmeticBundles);

  if (same) return false;
  saveEntitlements(server);
  return true;
}

// ── Coming back from Stripe ─────────────────────────────────────────────────

/**
 * The player has just returned from checkout. Wait for the grant to land.
 *
 * Two things make this its own path rather than part of the boot restore.
 *
 * **The tab is not new.** Checkout leaves for `checkout.stripe.com` and comes
 * back to the same tab, so sessionStorage survived — and `restoreOnBoot`'s
 * once-per-tab flag is already set from before the player left. Left to it,
 * the boot restore would return early and the thing they just paid for would
 * not appear until they opened a new tab. This clears that flag.
 *
 * **The webhook may be behind them.** Stripe redirects the browser and calls
 * our webhook independently, and the redirect usually wins the race. So this
 * polls rather than reading once, with a ceiling — after which the player is
 * left as they were, because the webhook is authoritative and it will land.
 * Nothing here grants anything: it only asks the server what it decided.
 */
const POLL_MS = [400, 800, 1200, 2000, 3000, 4000] as const;

export async function awaitPurchase(): Promise<boolean> {
  for (const wait of POLL_MS) {
    await new Promise((resolve) => setTimeout(resolve, wait));

    let body: { entitlements?: Entitlements | null; signedIn?: boolean };
    try {
      const res = await fetch("/api/billing/entitlements");
      if (!res.ok) continue;
      body = (await res.json()) as typeof body;
    } catch {
      continue; // a dropped poll is not a failed purchase
    }
    if (body.signedIn === false) return false;

    if (adoptEntitlements(body.entitlements)) {
      // Clear the boot guard before reloading, or restoreOnBoot's early return
      // is the next thing to run and this looks like it did nothing.
      try {
        window.sessionStorage.removeItem(RESTORED_FLAG);
      } catch {
        /* private mode: the adopt already happened, only the reload is lost */
      }
      window.location.reload();
      return true;
    }
  }
  return false;
}

/**
 * True when this page load is the one straight after a checkout. Reads the
 * `?purchase=` marker set by the success and cancel URLs in
 * app/api/billing/checkout/route.ts.
 */
export function returningFromCheckout(): "ok" | "cancelled" | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("purchase");
  return value === "ok" || value === "cancelled" ? value : null;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");
