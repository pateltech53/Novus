import { goToCheckout } from "@/lib/cloud/billing";
import type { ProPlanId } from "@/lib/monetization";

/**
 * The plan a player chose before they had an account to attach it to.
 *
 * ── The dead end this exists to remove ──────────────────────────────────────
 *
 * `/api/billing/checkout` refuses to sell to a request with no session, and it
 * is right to: a subscription has to hang off an account or the player has no
 * way on earth to prove they paid. But the pricing section on the front page is
 * reachable — and is *arrived at* — by people who are not signed in. The App
 * Store build cannot sell anything itself, so its GET PRO link opens
 * `/#pro` in the player's own browser (lib/commerce.ts), and that browser is a
 * different cookie jar from the app's webview. Everyone taking that route lands
 * on the plans signed out, presses MONTHLY or YEARLY, and gets refused.
 *
 * Telling them to sign in is necessary and not sufficient: signing in reloads
 * the page (AccountGate's submitSignIn — the cloud restore has to run), and
 * signing up walks into onboarding. Either way the intent they expressed by
 * pressing a plan is gone, and they have to find the pricing section again and
 * remember which one they picked.
 *
 * So the intent outlives the identity step. Pressing a plan while signed out
 * records it here; finishing sign-up or sign-in reads it back and opens the
 * checkout the player already asked for.
 *
 * ── Why sessionStorage, and why it expires ──────────────────────────────────
 *
 * sessionStorage rather than localStorage because this belongs to one attempt
 * in one tab, not to the device — a plan chosen last week must not open a
 * payment page today. `wipeDevice()` in lib/cloud/auth.ts clears localStorage
 * on sign-in, which is another reason not to keep it there.
 *
 * The timestamp is the second half of that. Redirecting to a payment page is a
 * strong thing to do on someone's behalf, so it only happens while the tap that
 * asked for it is still recent. Past the window the record is dropped and the
 * player lands where they normally would.
 */

const KEY = "novus:pending-pro";

/** How long a chosen plan may sit before it stops meaning anything. */
const FRESH_MS = 30 * 60 * 1000;

interface Pending {
  plan: ProPlanId;
  at: number;
}

const isPlan = (v: unknown): v is ProPlanId =>
  v === "pro_monthly" || v === "pro_yearly";

/** Records the plan a signed-out player pressed. */
export function rememberPendingPro(plan: ProPlanId): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ plan, at: Date.now() } satisfies Pending));
  } catch {
    // Private mode, or storage full. The player still gets the message telling
    // them to sign in; they just have to press the plan again afterwards.
  }
}

/**
 * Reads the pending plan and forgets it, in one step.
 *
 * Consuming on read is deliberate: a resume that fails must not leave a record
 * behind that tries again on the next navigation, which is how one refused
 * checkout turns into a loop the player cannot get out of.
 */
export function takePendingPro(): ProPlanId | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<Pending>;
    if (!isPlan(parsed.plan)) return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > FRESH_MS) return null;
    return parsed.plan;
  } catch {
    return null;
  }
}

export function forgetPendingPro(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}

/**
 * Opens the checkout a player asked for before they signed in.
 *
 * Answers true only when the browser is already on its way to Stripe, so the
 * caller can return instead of navigating somewhere else. Every other outcome —
 * no pending plan, a stale one, a refusal — is false, and the caller carries on
 * with whatever it would have done anyway. A player is never stranded on this
 * step: the worst case is landing in the game with the purchase not made.
 */
export async function resumePendingPro(): Promise<boolean> {
  const plan = takePendingPro();
  if (!plan) return false;
  const result = await goToCheckout(plan);
  return result.ok;
}
