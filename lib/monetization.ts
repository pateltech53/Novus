import { INDUSTRIES } from "@/lib/engine/constants";
import type { Industry } from "@/lib/engine/types";

/**
 * What Novus sells, in one place.
 *
 * Three surfaces need these numbers — the onboarding Pro screen, Settings, and
 * the paywall that will exist once billing does. They were about to be typed
 * three times, which is how a price ends up wrong on one screen and right on
 * the other for six months. Prices live here as integer cents; nothing formats
 * a price by hand.
 *
 * ── The line this file exists to hold ────────────────────────────────────────
 *
 * Brand Law 4 is not a disclaimer, it is the schema. Everything sellable below
 * is CONTENT — industries, cosmetics, run slots, seats. Score, survival,
 * revives and leaderboard position appear in this file exactly once, in
 * NEVER_PURCHASABLE, and there is no code path that puts a price on them. The
 * app is used by minors and sold to schools; treat that list as load-bearing.
 *
 * ── No billing ───────────────────────────────────────────────────────────────
 *
 * There is no payment processor wired up. `Entitlements.pro` is set by the
 * simulated switch in ProSheet, and `Entitlements.intent` records that someone
 * asked for a plan during onboarding. Intent is not a purchase and no screen
 * may present it as one.
 */

// ── Money ────────────────────────────────────────────────────────────────────

/** Cents, always. Floating-point dollars round wrong at the worst moment. */
export type Cents = number;

export type Cadence = "month" | "year" | "once";

/** "$6.99" — and "$299" rather than "$299.00", because that is how it is sold. */
export function formatPrice(cents: Cents): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toFixed(whole ? 0 : 2)}`;
}

/** "$1.99–$4.99". Used for the bundles, which are a shelf and not one item. */
export function formatRange(low: Cents, high: Cents): string {
  return `${formatPrice(low)}–${formatPrice(high)}`;
}

export const CADENCE_SUFFIX: Record<Cadence, string> = {
  month: "/month",
  year: "/year",
  once: "",
};

// ── Subscription ─────────────────────────────────────────────────────────────

export type PlanId = "free" | "pro_monthly" | "pro_yearly";

/**
 * The plans that are actually bought. "free" is a PlanId because it is a
 * choice a player can record, but it is not a SubscriptionPlan — there is no
 * price, no cadence and nothing to check out with. Splitting the two means the
 * checkout call below cannot be handed "free" by a screen that iterates
 * SUBSCRIPTIONS, which is a mistake the compiler should catch rather than
 * Stripe.
 */
export type ProPlanId = Exclude<PlanId, "free">;

export interface SubscriptionPlan {
  id: ProPlanId;
  /** What the button says the player is starting. */
  label: string;
  priceCents: Cents;
  cadence: Cadence;
}

export const PRO_MONTHLY: SubscriptionPlan = {
  id: "pro_monthly",
  label: "Monthly",
  priceCents: 699,
  cadence: "month",
};

export const PRO_YEARLY: SubscriptionPlan = {
  id: "pro_yearly",
  label: "Yearly",
  priceCents: 3999,
  cadence: "year",
};

export const SUBSCRIPTIONS: readonly SubscriptionPlan[] = [PRO_MONTHLY, PRO_YEARLY];

/** What twelve months of the monthly plan costs. Shown beside the year price
 *  so the annual plan is compared rather than merely recommended. */
export const MONTHLY_ANNUALISED_CENTS: Cents = PRO_MONTHLY.priceCents * 12;

/**
 * What a year saves against paying monthly, in cents. Derived rather than
 * written down so it cannot drift out of step with the two prices above.
 */
export const YEARLY_SAVING_CENTS: Cents =
  MONTHLY_ANNUALISED_CENTS - PRO_YEARLY.priceCents;

// ── Chapter licences ─────────────────────────────────────────────────────────

/**
 * A chapter is one classroom or one club. The licence covers every seat in it
 * for a year — there is no per-student upsell inside a chapter, because a
 * teacher cannot supervise thirty separate storefronts.
 */
export interface ChapterLicence {
  id: "chapter_35" | "chapter_100";
  seats: number;
  priceCents: Cents;
  cadence: "year";
}

export const CHAPTER_LICENCES: readonly ChapterLicence[] = [
  { id: "chapter_35", seats: 35, priceCents: 29900, cadence: "year" },
  { id: "chapter_100", seats: 100, priceCents: 59900, cadence: "year" },
];

/** The number a budget holder actually asks for. Rounded to the cent. */
export const perSeatCents = (licence: ChapterLicence): Cents =>
  Math.round(licence.priceCents / licence.seats);

// ── One-time purchases ───────────────────────────────────────────────────────

/**
 * Sold in the Closet, not in a separate shop. One tap, no subscription, and
 * every one of them is content — see NEVER_PURCHASABLE for the other half of
 * the rule.
 */
export interface OneTimePurchase {
  id: "industry_pack" | "cosmetic_bundle" | "extra_run_slot";
  name: string;
  priceCents: Cents;
  /** Set when the item is a shelf with several prices on it, not one SKU. */
  maxPriceCents?: Cents;
  what: string;
}

export const ONE_TIME_PURCHASES: readonly OneTimePurchase[] = [
  {
    id: "industry_pack",
    name: "Industry Pack",
    priceCents: 299,
    what: "One locked industry, kept for good.",
  },
  {
    id: "cosmetic_bundle",
    name: "Cosmetic Bundles",
    priceCents: 199,
    maxPriceCents: 499,
    what: "Wardrobe only. Changes how you look in the panel.",
  },
  {
    id: "extra_run_slot",
    name: "Extra Run Slot",
    priceCents: 199,
    what: "One more company running at the same time.",
  },
];

export const priceLabel = (item: OneTimePurchase): string =>
  item.maxPriceCents
    ? formatRange(item.priceCents, item.maxPriceCents)
    : formatPrice(item.priceCents);

// ── The limits ───────────────────────────────────────────────────────────────

export interface Limits {
  /** New companies you may found per real day. */
  runsPerDay: number;
  /** Whether a company that went under can be restarted the same day. */
  redoFailedRun: boolean;
  /** Industries you may found in. */
  industries: number;
  /** Cold calls per real day in The Room. Zero means the room is closed. */
  coldCallsPerDay: number;
}

export const FREE_LIMITS: Limits = {
  runsPerDay: 1,
  redoFailedRun: false,
  industries: 4,
  coldCallsPerDay: 0,
};

export const PRO_LIMITS: Limits = {
  runsPerDay: 3,
  redoFailedRun: true,
  industries: 12,
  // Matches the gate in lib/engine/activities.ts — three a real day, and
  // advancing the fiscal year does not refill them.
  coldCallsPerDay: 3,
};

/** The four codes anyone can found in, read off the industry table itself. */
export const FREE_INDUSTRY_CODES: readonly Industry[] = INDUSTRIES.filter(
  (i) => i.free,
).map((i) => i.code);

export const PRO_INDUSTRY_CODES: readonly Industry[] = INDUSTRIES.filter(
  (i) => !i.free,
).map((i) => i.code);

// ── Brand Law 4, as data ─────────────────────────────────────────────────────

/** Sellable. Every one of them is something to look at or somewhere to play. */
export const PURCHASABLE: readonly string[] = [
  "Cosmetics",
  "Run slots",
  "Scenario and industry packs",
  "Chapter seats",
];

/**
 * Not sellable at any price, on any surface, in any build. If a feature
 * request needs a new entry here, the answer to the feature request is no.
 */
export const NEVER_PURCHASABLE: readonly string[] = [
  "Score",
  "Survival",
  "Revives",
  "Leaderboard position",
];

/**
 * One sentence, one wording. Onboarding, Settings and the paywall all print
 * this exact string so a player never sees two versions of the promise.
 */
export const PRO_PROMISE =
  "Pro never buys a score, a survival, a revive, or a place on Still Standing. Those are earned or they are nothing.";

// ── What Pro adds ────────────────────────────────────────────────────────────

/**
 * Copy is kept to one line per field on purpose. A pricing screen that needs
 * three lines per feature does not fit a 390×844 phone above the fold, and a
 * player who has to scroll to find the free button has been nudged.
 */
export interface ProFeature {
  id: "the_room" | "industries" | "run_slots" | "cosmetics";
  title: string;
  /** Free's honest position. Stated flat — free is a complete game, not a demo. */
  free: string;
  body: string;
}

export const PRO_FEATURES: readonly ProFeature[] = [
  {
    id: "the_room",
    title: "The Room",
    free: "Closed",
    body: "Cold call angels, operators, buyers. Three a day.",
  },
  {
    id: "industries",
    title: "Twelve industries",
    free: "Four",
    body: "The other eight, each with its own way to fail.",
  },
  {
    id: "run_slots",
    title: "Three runs a day",
    free: "One, no redo",
    body: "Lose one and found again the same day.",
  },
  {
    id: "cosmetics",
    title: "The long wardrobe",
    free: "Also unlocks",
    body: "Earned by finishing runs. Changes nothing but you.",
  },
];

// ── Entitlements ─────────────────────────────────────────────────────────────

export interface Entitlements {
  /** Pro is active. Today only the simulated switch sets this. */
  pro: boolean;
  /** Bought slots stack on top of the plan's allowance. */
  extraRunSlots: number;
  industryPacks: Industry[];
  cosmeticBundles: string[];
  /** A chapter licence covering this seat, if a teacher enrolled it. */
  chapter: ChapterLicence["id"] | null;
  /**
   * The plan the player asked for. Recorded so onboarding is not a dead end
   * while billing does not exist — it is an intent, never a receipt.
   */
  intent: PlanId | null;
}

export const NO_ENTITLEMENTS: Entitlements = {
  pro: false,
  extraRunSlots: 0,
  industryPacks: [],
  cosmeticBundles: [],
  chapter: null,
  intent: null,
};

/** A chapter seat is Pro for the year — same content, bought by the school. */
export const isPro = (e: Entitlements): boolean => e.pro || e.chapter !== null;

export const limitsFor = (e: Entitlements): Limits =>
  isPro(e) ? PRO_LIMITS : FREE_LIMITS;

export const runSlotsFor = (e: Entitlements): number =>
  limitsFor(e).runsPerDay + e.extraRunSlots;

export const industryUnlocked = (code: Industry, e: Entitlements): boolean =>
  FREE_INDUSTRY_CODES.includes(code) ||
  isPro(e) ||
  e.industryPacks.includes(code);

// ── Persistence ──────────────────────────────────────────────────────────────

const KEY = "novus:entitlements:v1";

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

/** Backfilled on read, like every other save in this app. */
export function loadEntitlements(): Entitlements {
  if (!canStore()) return NO_ENTITLEMENTS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return NO_ENTITLEMENTS;
    return { ...NO_ENTITLEMENTS, ...(JSON.parse(raw) as Partial<Entitlements>) };
  } catch {
    return NO_ENTITLEMENTS;
  }
}

export function saveEntitlements(next: Entitlements): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store must not take the screen down with it.
  }
  announce();
}

// ── Watching the receipt ─────────────────────────────────────────────────────

/**
 * Told when entitlements change, so a purchase reaches the screen that is
 * already open.
 *
 * Several surfaces read entitlements exactly once — `useState(() =>
 * isPro(loadEntitlements()))` in ClosetScreen, the industry grid in /found, and
 * `run.pro`, which is copied out of the store when a company is founded and
 * never again. Before this, buying Pro from a gate in month seven left The Room
 * shut until the next company: the money moved and nothing on screen did, which
 * is indistinguishable from a purchase that failed.
 *
 * Deliberately not the `storage` event. That one fires in OTHER tabs and never
 * in the tab that wrote, which is precisely backwards for this — the tab that
 * just took the payment is the one holding the stale screen.
 *
 * Listeners re-read the store themselves rather than being handed a value, so a
 * write that localStorage refused still resolves to the truth rather than to
 * what the caller hoped it had saved.
 */
type EntitlementListener = () => void;

const listeners = new Set<EntitlementListener>();

/** Returns its own unsubscribe, for a `useEffect` cleanup to return directly. */
export function onEntitlementsChange(fn: EntitlementListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function announce(): void {
  // A throwing listener must not stop the others from hearing about a purchase.
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* one broken screen, not all of them */
    }
  }
}

/**
 * Records which plan the player picked. Grants nothing: `pro` is untouched,
 * because no money changed hands and pretending otherwise would be a lie the
 * player discovers at the first locked industry.
 */
export function recordPlanIntent(plan: PlanId): void {
  saveEntitlements({ ...loadEntitlements(), intent: plan });
}

/**
 * Grant Pro on this device, now.
 *
 * Until real billing lands, choosing Pro GRANTS Pro locally — recording an
 * intent and delivering nothing meant the player pressed the button, saw no
 * skins, no Room, no third run, and reasonably concluded the feature was
 * broken. The honest version of "checkout is not built" is: everything Pro
 * unlocks turns on, no card is taken, and the screen says the entitlement is
 * device-local until accounts arrive. When billing ships, this becomes the
 * post-payment success path instead of the button handler.
 */
export function grantProLocally(plan: PlanId): void {
  saveEntitlements({ ...loadEntitlements(), intent: plan, pro: true });
}


// ── The run-a-day ledger ────────────────────────────────────────────────────

/**
 * Counts run STARTS per real calendar day, against `runSlotsFor()`.
 *
 * This exists because the Pro screen says "FREE · ONE, NO REDO" and for a while
 * that was a claim the engine did not enforce — startRun would happily create a
 * tenth run of the day. A pricing page that overstates the free tier's limits is
 * worse than either honest option, so the rule now lives one module away from
 * the copy that states it.
 *
 * "No redo" falls out of counting STARTS rather than completions: abandoning a
 * dead company and starting over consumes the day's slot, which is exactly what
 * one life per day means. The real clock is the same one Today's Market and the
 * cold-call ration run on — advancing the fiscal year refills nothing.
 */
const RUN_LEDGER_KEY = "novus:runledger:v1";

interface RunLedger {
  dayISO: string;
  started: number;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function loadRunLedger(): RunLedger {
  if (typeof window === "undefined") return { dayISO: todayISO(), started: 0 };
  try {
    const raw = window.localStorage.getItem(RUN_LEDGER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RunLedger;
      if (parsed.dayISO === todayISO()) return parsed;
    }
  } catch {
    /* corrupt ledger reads as a fresh day — the generous failure mode */
  }
  return { dayISO: todayISO(), started: 0 };
}

/** Runs still startable today, given the player's entitlements. */
export function runsRemainingToday(e: Entitlements = loadEntitlements()): number {
  return Math.max(0, runSlotsFor(e) - loadRunLedger().started);
}

/** Consume one slot. Call from startRun, nowhere else. */
export function recordRunStart(): void {
  if (typeof window === "undefined") return;
  const ledger = loadRunLedger();
  try {
    window.localStorage.setItem(
      RUN_LEDGER_KEY,
      JSON.stringify({ dayISO: ledger.dayISO, started: ledger.started + 1 }),
    );
  } catch {
    /* storage full or blocked: fail open, never lock a player out of playing */
  }
}
