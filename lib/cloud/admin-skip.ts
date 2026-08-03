import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import type { CheckoutSku } from "@/lib/cloud/billing";

/**
 * The admin's fork in the checkout road.
 *
 * Every paid surface funnels through goToCheckout (lib/cloud/billing.ts).
 * When the signed-in account is an operator, that call pauses here and asks —
 * through the globally mounted AdminSkipPrompt — whether this purchase should
 * exercise the REAL Stripe flow or be skipped: granted to the account
 * immediately, server-side, exactly as if the webhook had fired
 * (app/api/admin/skip). For every other player alive this module is two
 * cached answers: "no prompt mounted" and "not an admin", and checkout
 * proceeds untouched.
 *
 * The admin check is one request per tab, made lazily at the first purchase
 * press and cached — a player pays it once as a fast 404. The prompt itself
 * re-checks freshly when it opens, so a demotion mid-session falls back to
 * the ordinary checkout rather than trusting a stale yes.
 */

export type AdminChoice = "stripe" | "skipped" | "cancel";

export interface AdminSkipRequest {
  sku: CheckoutSku;
  industry?: string;
  /** chapter_custom only: the seat count the operator typed. */
  seats?: number;
}

// ── Am I an operator? ───────────────────────────────────────────────────────

let adminCache: Promise<boolean> | null = null;

export function isAdminAccount(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!adminCache) {
    adminCache = fetch(apiUrl("/api/admin/me"), { credentials: API_CREDENTIALS })
      .then((res) => res.ok)
      .catch(() => {
        // A network hiccup must not brand an admin "player" for the whole
        // tab — forget the answer so the next press asks again.
        adminCache = null;
        return false;
      });
  }
  return adminCache;
}

// ── The prompt registry ─────────────────────────────────────────────────────
// One globally mounted component (AdminSkipPrompt in app/layout.tsx) registers
// itself here; goToCheckout asks through it. No component mounted — a test, a
// stripped build — resolves to "no choice" and checkout runs as ever.

type PromptFn = (req: AdminSkipRequest) => Promise<AdminChoice>;

let prompt: PromptFn | null = null;

/** Returns its own unregister, for a useEffect cleanup to return directly. */
export function registerAdminSkipPrompt(fn: PromptFn): () => void {
  prompt = fn;
  return () => {
    if (prompt === fn) prompt = null;
  };
}

/**
 * Null means "no opinion — run the normal checkout": the caller is not an
 * admin, or no prompt is mounted. Everything else is the admin's answer.
 */
export async function adminCheckoutChoice(
  sku: CheckoutSku,
  industry?: string,
  seats?: number,
): Promise<AdminChoice | null> {
  if (!prompt) return null;
  if (!(await isAdminAccount())) return null;
  return prompt({ sku, industry, seats });
}

// ── The skip itself ─────────────────────────────────────────────────────────

/**
 * Grants the SKU to the calling admin's own account, server-side, as if paid
 * — the same grant functions the Stripe webhook calls, with an audit row
 * saying checkout was skipped. The caller follows success with
 * restorePurchases() so the fresh entitlements land before any screen asks.
 */
export async function skipPurchase(
  sku: CheckoutSku,
  industry?: string,
  seats?: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(apiUrl("/api/admin/skip"), {
      method: "POST",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku,
        ...(industry ? { industry } : {}),
        ...(seats !== undefined ? { seats } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
