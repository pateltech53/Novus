import { adminCheckoutChoice } from "@/lib/cloud/admin-skip";
import { RESTORED_FLAG } from "@/lib/cloud/keys";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
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
    statusCache = fetch(apiUrl("/api/billing/status"), { credentials: API_CREDENTIALS })
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
  | "extra_run_slot"
  | "chapter_35"
  | "chapter_100"
  // The buyer-sized licence. Sent with `seats`; the server computes the
  // price from that count with the same function the screen displayed.
  | "chapter_custom";

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
       *
       * The two `admin-*` reasons exist only for operator sessions
       * (lib/cloud/admin-skip.ts): `admin-skip` means the item was GRANTED
       * without payment — the entitlements are already adopted by the time
       * the caller sees this, so it ends the flow as a success with no
       * navigation — and `admin-cancel` means the admin closed the choice,
       * which every surface treats as "nothing happened".
       */
      reason:
        | "not-configured"
        | "signed-out"
        | "needs-account"
        | "owned"
        | "error"
        | "admin-skip"
        | "admin-cancel";
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
  seats?: number,
): Promise<CheckoutResult> {
  try {
    const res = await fetch(apiUrl("/api/billing/checkout"), {
      method: "POST",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku,
        ...(industry ? { industry } : {}),
        ...(seats !== undefined ? { seats } : {}),
      }),
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
  seats?: number,
): Promise<CheckoutResult> {
  // The operator's fork, and nobody else's: for an admin session this asks
  // "test the real checkout, or skip payment?" through the globally mounted
  // prompt. A skip has already granted and adopted the entitlements by the
  // time it returns. For every other player the answer is null and nothing
  // here happened.
  const choice = await adminCheckoutChoice(sku, industry, seats);
  if (choice === "skipped") return { ok: false, reason: "admin-skip" };
  if (choice === "cancel") return { ok: false, reason: "admin-cancel" };

  const result = await startCheckout(sku, industry, seats);
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
    const res = await fetch(apiUrl("/api/billing/portal"), {
      method: "POST",
      credentials: API_CREDENTIALS,
    });
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
    local.extraYearCloses === server.extraYearCloses &&
    local.chapter === server.chapter &&
    local.intent === server.intent &&
    // The admin overlay travels in the same object; a view switch in the
    // console changes ONLY this field, and must still count as a change.
    local.admin === server.admin &&
    sameSet(local.industryPacks, server.industryPacks) &&
    sameSet(local.cosmeticBundles, server.cosmeticBundles);

  if (same) return false;
  saveEntitlements(server);
  return true;
}

// ── Restore ─────────────────────────────────────────────────────────────────

export type RestoreResult =
  | { ok: true; changed: boolean; pro: boolean }
  | { ok: false; reason: "signed-out" | "not-configured" | "offline" };

/**
 * "Restore purchases" — ask the server what this account owns and adopt it.
 *
 * App Review looks for this control in any app where something can be bought,
 * and it is the load-bearing one here rather than a formality: nothing is sold
 * inside the store builds (see lib/commerce.ts), so signing in and restoring
 * is the ONLY way Pro appears on a phone. A player who paid on a laptop and
 * then installed the app has to have a button that makes it true.
 *
 * It grants nothing on its own — it reads the server's receipt and copies it
 * down, which is the direction of authority `adoptEntitlements` already
 * enforces. A player with no purchases gets an honest "nothing to restore"
 * rather than an error, because for most people that is the correct answer and
 * not a failure.
 */
export async function restorePurchases(): Promise<RestoreResult> {
  let body: {
    configured?: boolean;
    signedIn?: boolean;
    entitlements?: Entitlements | null;
  };
  try {
    const res = await fetch(apiUrl("/api/billing/entitlements"), {
      credentials: API_CREDENTIALS,
    });
    if (!res.ok) return { ok: false, reason: "offline" };
    body = (await res.json()) as typeof body;
  } catch {
    // Offline, blocked, or no server behind this build. Not a failed purchase.
    return { ok: false, reason: "offline" };
  }

  if (body.configured === false) return { ok: false, reason: "not-configured" };
  if (body.signedIn === false) return { ok: false, reason: "signed-out" };

  const changed = adoptEntitlements(body.entitlements);
  // Report against what is on the device AFTER the adopt, so a restore that
  // found nothing new still tells the truth about what the player has.
  return { ok: true, changed, pro: loadEntitlements().pro };
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
      const res = await fetch(apiUrl("/api/billing/entitlements"), {
        credentials: API_CREDENTIALS,
      });
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

/**
 * Set equality for the entitlement arrays.
 *
 * The separator is written as an ESCAPE rather than as a literal control
 * character. Raw, it put two NUL bytes into this file and made git and grep
 * treat a TypeScript source as a binary blob. The character itself is still
 * the right separator: it cannot occur in an industry code or a cosmetic
 * bundle id, so no two different sets can join to the same string.
 */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
