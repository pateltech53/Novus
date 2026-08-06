"use client";

import { useEffect, useState } from "react";

import { INDUSTRIES } from "@/lib/engine/constants";
import type { Industry } from "@/lib/engine/types";
import {
  PRO_MONTHLY,
  PRO_YEARLY,
  islandCapFor,
  limitsFor,
  loadEntitlements,
  onEntitlementsChange,
  type Entitlements,
  type ProPlanId,
} from "@/lib/monetization";

/**
 * What this account is on, said once, for every screen that shows it.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * `lib/monetization.ts` answers what a player MAY DO — `isPro`, `limitsFor`,
 * `islandCapFor` — and every gate in the game reads it. Nothing answered the
 * other question, which is what a player who has already paid asks: *what did I
 * buy, and is it on?* So a subscriber saw the same front door, the same
 * CONTINUE AS button and the same MONTHLY / YEARLY pair as somebody who had
 * never paid a penny, and the only surface in the whole product that admitted
 * Pro existed on this account was one row inside Settings — which said "Pro is
 * on" and not which plan, and said nothing at all about an island or a pack
 * bought on its own.
 *
 * This file is that answer. It is display only: nothing here grants, checks or
 * gates anything, and every gate keeps reading monetization.ts. What it adds is
 * a single place where the wording of "you are on the yearly plan" is decided,
 * so the gate, the price list and Settings cannot each phrase it differently —
 * the same reason the prices themselves live in one file.
 *
 * ── The one rule it exists to hold ──────────────────────────────────────────
 *
 * **Never claim a plan that is not being paid for.** `Entitlements.intent` is
 * the field that carries the cadence, and it is written from two places that
 * mean different things: `apply_subscription` (0003) writes the plan read off
 * the actual Stripe price on every subscription event, and `recordPlanIntent`
 * writes whatever the player last pressed, purchase or no purchase. It also
 * deliberately SURVIVES a cancellation — "a record of the ask, not of access",
 * as the migration puts it. So it is only ever read here beside `pro`, and a
 * cadence we cannot vouch for comes back as null rather than as a guess.
 */

// ── Standing ────────────────────────────────────────────────────────────────

/** Why this account plays at the tier it does. */
export type PlanVia = "free" | "subscription" | "chapter" | "operator";

export interface Standing {
  /** Plays at Pro, whatever paid for it. Same answer `isPro` gives a gate. */
  pro: boolean;
  via: PlanVia;
  /**
   * The cadence of the subscription behind Pro, when it is genuinely known.
   * Null means "Pro, cadence unknown" — never "no plan".
   */
  plan: ProPlanId | null;
  /** The short all-caps chip: FREE · NOVUS PRO · YEARLY. */
  badge: string;
}

const CADENCE_WORD: Record<ProPlanId, string> = {
  pro_monthly: "MONTHLY",
  pro_yearly: "YEARLY",
};

/** "Monthly" / "Yearly", for the middle of a sentence. */
export const planName = (plan: ProPlanId): string =>
  plan === PRO_MONTHLY.id ? PRO_MONTHLY.label : PRO_YEARLY.label;

/** "MONTHLY" / "YEARLY" — the cadence alone, for a chip that already sits
 *  beside the word Pro and would only repeat it. */
export const planWord = (plan: ProPlanId): string => CADENCE_WORD[plan];

/**
 * The cadence being paid for, or null.
 *
 * Gated on `pro` for the reason in the file header: an intent with no access
 * behind it is somebody who pressed a price and did not finish, or somebody
 * whose subscription lapsed months ago, and printing "YEARLY" for either of
 * them invents a subscription that is not being billed.
 */
export function subscriptionPlan(e: Entitlements): ProPlanId | null {
  if (!e.pro) return null;
  return e.intent === PRO_MONTHLY.id || e.intent === PRO_YEARLY.id ? e.intent : null;
}

/**
 * Which of the four standings this account is in.
 *
 * The order is the order of authority. An operator's unlock is derived from
 * `profiles.role` and is not a purchase, so it is named as itself rather than
 * dressed up as a subscription. A player's own subscription comes next. A
 * chapter seat is Pro that a school is paying for — the player has no plan to
 * manage and no card on file, and telling them to cancel something they never
 * bought would be a dead end.
 */
export function planStanding(e: Entitlements): Standing {
  if (e.admin) return { pro: true, via: "operator", plan: null, badge: "NOVUS PRO · OPERATOR" };
  if (e.pro) {
    const plan = subscriptionPlan(e);
    return {
      pro: true,
      via: "subscription",
      plan,
      badge: plan ? `NOVUS PRO · ${CADENCE_WORD[plan]}` : "NOVUS PRO",
    };
  }
  if (e.chapter) {
    return { pro: true, via: "chapter", plan: null, badge: "NOVUS PRO · CHAPTER SEAT" };
  }
  return { pro: false, via: "free", plan: null, badge: "FREE" };
}

/**
 * What the standing actually gets you, in this account's own numbers.
 *
 * Built from `limitsFor` and `islandCapFor` rather than written out, so a
 * bought island shows up in the island count the moment it lands — which is
 * the plainest possible proof that a one-time purchase arrived, and it costs
 * no extra line on the screen.
 */
export function standingLine(e: Entitlements): string {
  const limits = limitsFor(e);
  const islands = islandCapFor(e);
  const runs = limits.runsPerDay;
  return `${limits.industries} industries · ${islands} islands at once · ${runs} ${
    runs === 1 ? "company" : "companies"
  } a day`;
}

/** One sentence on where the standing came from, for a line under the chip. */
export function standingNote(s: Standing): string {
  switch (s.via) {
    case "subscription":
      return s.plan
        ? `Billed ${planName(s.plan).toLowerCase()}, and it renews until you cancel.`
        : "Your subscription is active.";
    case "chapter":
      return "Your chapter's licence covers this seat — there is nothing for you to pay or cancel.";
    case "operator":
      return "Operator account. Every industry and room is open, and no card is attached.";
    default:
      return "Free is the whole game — same year, same pitch, same board.";
  }
}

// ── What was bought on its own ──────────────────────────────────────────────

const industryName = (code: Industry): string =>
  INDUSTRIES.find((i) => i.code === code)?.name ?? code;

/**
 * The one-time buys as one line — "1 extra island · Fashion / Streetwear" —
 * or null when there is nothing to say.
 *
 * Named for what the player bought, never for what it is worth: this is a
 * receipt, not a second pitch, and no price appears in it. Industry packs are
 * listed by name because "2 industry packs" is not an answer to "which ones did
 * I buy". Cosmetic bundles are counted rather than named — they have no SKUs
 * yet, so the ids in that array are not words anybody has seen on a screen.
 *
 * Kept separate from the standing above because it OUTLIVES it: cancelling a
 * subscription takes back nothing on this line.
 */
export function ownedLine(e: Entitlements): string | null {
  const islands = Math.max(0, e.extraIslands);
  const parts: string[] = [];

  if (islands > 0) parts.push(`${islands} extra island${islands === 1 ? "" : "s"}`);
  parts.push(...e.industryPacks.map(industryName));
  if (e.cosmeticBundles.length > 0) {
    const n = e.cosmeticBundles.length;
    parts.push(`${n} cosmetic bundle${n === 1 ? "" : "s"}`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

// ── Reading it on a screen ──────────────────────────────────────────────────

/**
 * This account's entitlements, live, or null until they are knowable.
 *
 * **Null is the first render, and callers must draw nothing for it.**
 * Entitlements live in localStorage, which does not exist during the server
 * render or in the prerendered HTML a store build ships — so a component that
 * read them during render would either desync hydration or paint one frame of
 * FREE at a player who has paid. Same shape `useSellsHere` uses, and for the
 * same reason.
 *
 * It re-reads on every write, which is the half that matters here. The boot
 * restore adopts the server's copy a second or two after mount
 * (lib/cloud/sync.ts), the once-a-minute heartbeat adopts a change made on
 * another device, and a purchase completed in this very tab announces itself —
 * so a screen that read once at mount would show a signed-in subscriber FREE
 * for as long as they stood on it. `onEntitlementsChange` is exactly that
 * signal; see lib/monetization.ts for why it is not the `storage` event.
 */
export function useEntitlements(): Entitlements | null {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);

  useEffect(() => {
    const sync = () => setEntitlements(loadEntitlements());
    sync();
    return onEntitlementsChange(sync);
  }, []);

  return entitlements;
}

/** The entitlements and the standing read off them, for the screens that show
 *  both. Null carries straight through from `useEntitlements` above. */
export function usePlan(): { entitlements: Entitlements; standing: Standing } | null {
  const entitlements = useEntitlements();
  return entitlements ? { entitlements, standing: planStanding(entitlements) } : null;
}
