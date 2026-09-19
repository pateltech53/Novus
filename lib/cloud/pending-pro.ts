import { goToCheckout } from "@/lib/cloud/billing";
import { isNative } from "@/lib/native/platform";
import type { ProPlanId } from "@/lib/monetization";

/** Browser checkout intent survives authentication for up to 30 minutes.
 * Native shells discard it instead of resuming an external payment flow.
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
  if (isNative()) {
    forgetPendingPro();
    return false;
  }
  const plan = takePendingPro();
  if (!plan) return false;
  const result = await goToCheckout(plan);
  return result.ok;
}
