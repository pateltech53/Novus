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

/**
 * "$6.99" — and "$299" rather than "$299.00", because that is how it is sold.
 *
 * Grouped above a thousand. Nothing here reached four figures while a custom
 * chapter stopped at 500 seats; now that it does not, the same function prints
 * the largest number on the site, and "$59900" is a figure a buyer has to stop
 * and count digits on. Only values over $999 change — every published price is
 * three digits or fewer and formats exactly as before.
 */
export function formatPrice(cents: Cents): string {
  const whole = cents % 100 === 0;
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
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

/**
 * Every licence a chapter row can carry: the two fixed sizes, and the
 * buyer-sized one. `chapter_custom` is not a ChapterLicence — it has no one
 * seat count or price to write down; both come from the buyer's number
 * through `customChapterPriceCents` below.
 */
export type ChapterId = ChapterLicence["id"] | "chapter_custom";

/** The number a budget holder actually asks for. Rounded to the cent. */
export const perSeatCents = (licence: ChapterLicence): Cents =>
  Math.round(licence.priceCents / licence.seats);

// ── The custom size ──────────────────────────────────────────────────────────

/**
 * The floor is where a "classroom" stops being one: below ten seats a custom
 * licence undercuts buying Pro for each person, and a licence priced under a
 * couple of personal plans is a discount code, not a chapter.
 *
 * ── Why the ceiling moved off 500 ──────────────────────────────────────────
 *
 * 500 was 0007's sanity bound on `chapters.seats`, adopted here because it was
 * the number already in the schema — not because 500 was a size anybody had
 * decided a chapter stops at. It turned out to be one: a secondary school with
 * a year group in the programme, a district running it across campuses, a
 * summer programme with a thousand places. Those buyers hit a form that told
 * them their number was invalid, which is the worst possible answer to give
 * the largest cheque on the page.
 *
 * The ceiling is still a real bound, because an unbounded seat field is a
 * typo away from a six-figure charge and a chapter nobody can fill. 10,000 is
 * chosen to sit far above any real buyer and well below a pasted phone number
 * or a doubled keystroke, so it only ever catches mistakes.
 *
 * Two things follow this number and must move with it, or a quote is taken
 * that cannot be stored: `chapters.seats` in the schema, and the guard inside
 * `admin_create_comp_chapter`. Both are widened in
 * supabase/migrations/0014_chapter_seats_ceiling.sql.
 */
export const CHAPTER_CUSTOM_MIN_SEATS = 10;
export const CHAPTER_CUSTOM_MAX_SEATS = 10_000;

export const isCustomSeatCount = (v: unknown): v is number =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= CHAPTER_CUSTOM_MIN_SEATS &&
  v <= CHAPTER_CUSTOM_MAX_SEATS;

/**
 * What N seats cost for a year, derived from the two fixed licences so the
 * three prices can never disagree: below 35 seats the 35-seat per-seat rate,
 * from 35 to 100 a straight line through the two tiers ($299 → $599), above
 * 100 the 100-seat rate carried on. At exactly 35 or 100 it lands on the
 * tier price to the cent, so the custom row can never undercut — or shame —
 * the fixed one beside it. Rounded to whole dollars, because that is how a
 * quote is written; the checkout charges this exact number.
 *
 * The caller validates with `isCustomSeatCount` first — this function is
 * arithmetic, not a gate.
 */
export function customChapterPriceCents(seats: number): Cents {
  const [small, large] = CHAPTER_LICENCES;
  let exact: number;
  if (seats <= small.seats) {
    exact = (small.priceCents * seats) / small.seats;
  } else if (seats <= large.seats) {
    const perExtraSeat =
      (large.priceCents - small.priceCents) / (large.seats - small.seats);
    exact = small.priceCents + (seats - small.seats) * perExtraSeat;
  } else {
    exact = large.priceCents + (seats - large.seats) * (large.priceCents / large.seats);
  }
  return Math.round(exact / 100) * 100;
}

// ── One-time purchases ───────────────────────────────────────────────────────

/**
 * Sold in the Closet, not in a separate shop. One tap, no subscription, and
 * every one of them is content — see NEVER_PURCHASABLE for the other half of
 * the rule.
 */
export interface OneTimePurchase {
  id: "industry_pack" | "cosmetic_bundle" | "extra_island";
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
    /*
     * Renamed from `extra_run_slot`, and the rename is the fix.
     *
     * This SKU's own description has always promised CONCURRENCY — "one more
     * company running at the same time", repeated verbatim in the one-time
     * shelf and, more seriously, in the Terms of Service. What it granted was
     * `extraRunSlots`, which `runSlotsFor()` added to the DAILY FOUNDING
     * ration. Those are different products, and the one the player received
     * destroyed the company they already had, because founding was the only
     * thing the app could spend it on.
     *
     * The Stripe price is deliberately unchanged: same purchase link, same
     * catalogue entry, same $1.99. Only what arrives is different, and what
     * arrives is now what the description said.
     */
    id: "extra_island",
    name: "Extra Island",
    priceCents: 199,
    what: "One more company running at the same time.",
  },
];

export const priceLabel = (item: OneTimePurchase): string =>
  item.maxPriceCents
    ? formatRange(item.priceCents, item.maxPriceCents)
    : formatPrice(item.priceCents);

// ── The limits ───────────────────────────────────────────────────────────────

/**
 * The hard ceiling on companies held at once, for every tier including admin.
 *
 * This is a STORAGE bound, not a pricing one. `public.saves` is keyed
 * `(profile_id, slot)` with `slot smallint check (slot between 0 and 9)`, so
 * the eleventh company has nowhere to be written. Pro is described to players
 * as unlimited islands and receives this number; nobody is expected to reach
 * it, and the check constraint is what makes the claim safe to print.
 */
export const ISLAND_CAP = 10;

export interface Limits {
  /** New companies you may found per real day. */
  runsPerDay: number;
  /**
   * Companies that may exist AT ONCE — islands.
   *
   * Deliberately the sibling of `runsPerDay` rather than a number derived from
   * it: they are the two halves of a distinction this product got wrong once
   * already. `runsPerDay` is a rate (how often you may start), `islands` is a
   * stock (how many you may hold). A player at their island cap with foundings
   * left has to bury something first; a player with islands free and no
   * foundings left has to wait for tomorrow.
   *
   * Capped at 10 everywhere by ISLAND_CAP — `saves.slot` is checked
   * `between 0 and 9`, and an allowance that outruns its own storage is a
   * promise the database refuses to keep.
   */
  islands: number;
  /** Whether a company that went under can be restarted the same day. */
  redoFailedRun: boolean;
  /** Industries you may found in. */
  industries: number;
  /** Cold calls per real day in The Room. Zero means the room is closed. */
  coldCallsPerDay: number;
  /**
   * Fiscal years a player may CLOSE per real day, across all companies.
   * The gate is at the year close, not the month: twelve months still play
   * out, and it is closing the books that spends one. Rolls over on the UTC
   * date, same clock the cold-call ration uses.
   */
  yearClosesPerDay: number;
}

export const FREE_LIMITS: Limits = {
  runsPerDay: 1,
  islands: 2,
  redoFailedRun: false,
  industries: 4,
  coldCallsPerDay: 0,
  yearClosesPerDay: 4,
};

export const PRO_LIMITS: Limits = {
  runsPerDay: 3,
  islands: ISLAND_CAP,
  redoFailedRun: true,
  industries: 12,
  // Matches the gate in lib/engine/activities.ts — three a real day, and
  // advancing the fiscal year does not refill them.
  coldCallsPerDay: 3,
  // Effectively uncapped; 99 rather than Infinity for the same reason as
  // ADMIN_LIMITS — every surface that formats it stays honest and finite.
  yearClosesPerDay: 99,
};

/**
 * What an operator's own account plays at. Never sold, never granted by any
 * purchase path: the only way `Entitlements.admin` becomes true is the server
 * overlay in lib/admin/entitlements.ts reading `profiles.role = 'admin'` — a
 * cell flipped by an admin (the console's ROLE band) or, for the first one,
 * in the Supabase dashboard (docs/ADMIN.md).
 *
 * 99 rather than Infinity so every surface that formats the number stays
 * honest and finite. The server-side ledger allows 999 for the same account;
 * nobody is expected to reach either. Cold calls keep Pro's cadence — the cap
 * lives inside the engine (lib/engine/activities.ts), which deliberately
 * knows nothing about entitlements beyond `run.pro`.
 */
export const ADMIN_LIMITS: Limits = {
  runsPerDay: 99,
  // Not 99. Unlike every other number here, this one is bounded by storage
  // rather than by policy: there is no eleventh row to put a company in.
  islands: ISLAND_CAP,
  redoFailedRun: true,
  industries: 12,
  coldCallsPerDay: 3,
  yearClosesPerDay: 99,
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
  id: "the_room" | "industries" | "run_slots" | "islands" | "cosmetics";
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
    id: "islands",
    title: "Ten islands",
    free: "Two",
    body: "Companies running at the same time. Switch between them whenever.",
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
  /**
   * Bought islands stack on top of the plan's allowance, up to ISLAND_CAP.
   *
   * Was `extraRunSlots`, which added to the daily founding ration instead —
   * see the `extra_island` SKU above for why that was the wrong product, and
   * supabase/migrations/0013_islands.sql for the column rename that matches.
   * `loadEntitlements()` backfills the old field so a player who bought one
   * before the split does not lose it.
   */
  extraIslands: number;
  /**
   * Fiscal-year closes an operator granted this account, on top of the tier's
   * own allowance. Never sold — the store has no SKU for pace — and written
   * only by /api/admin/years (0012). Pace is what Pro sells, so a gift here
   * buys nothing money cannot; a score or a survival stays ungiftable.
   */
  extraYearCloses: number;
  industryPacks: Industry[];
  cosmeticBundles: string[];
  /** A chapter licence covering this seat, if a teacher enrolled it. */
  chapter: ChapterId | null;
  /**
   * The plan the player asked for. Recorded so onboarding is not a dead end
   * while billing does not exist — it is an intent, never a receipt.
   */
  intent: PlanId | null;
  /**
   * This account is an operator viewing at full unlock. Set ONLY by the
   * server overlay (lib/admin/entitlements.ts) from `profiles.role`; nothing
   * client-side may write it true, and nothing here treats it as a tier a
   * player can reach — it is ADMIN_LIMITS' one switch.
   */
  admin: boolean;
}

export const NO_ENTITLEMENTS: Entitlements = {
  pro: false,
  extraIslands: 0,
  extraYearCloses: 0,
  industryPacks: [],
  cosmeticBundles: [],
  chapter: null,
  intent: null,
  admin: false,
};

/** A chapter seat is Pro for the year — same content, bought by the school. */
export const isPro = (e: Entitlements): boolean => e.pro || e.chapter !== null;

export const limitsFor = (e: Entitlements): Limits =>
  e.admin ? ADMIN_LIMITS : isPro(e) ? PRO_LIMITS : FREE_LIMITS;

/**
 * Foundings allowed per real day. Tier alone — nothing is sold that raises it.
 *
 * This used to read `limitsFor(e).runsPerDay + e.extraRunSlots`, which is how
 * a SKU advertising concurrency came to hand out a daily rate. The purchasable
 * component moved to `islandCapFor` below, where its own description always
 * said it belonged.
 */
export const runsPerDayFor = (e: Entitlements): number => limitsFor(e).runsPerDay;

/**
 * Companies allowed at once. Tier plus whatever was bought, then the storage
 * ceiling, which wins over both.
 */
export const islandCapFor = (e: Entitlements): number =>
  Math.min(ISLAND_CAP, limitsFor(e).islands + Math.max(0, e.extraIslands));

/**
 * Fiscal years this account may close today, tier plus operator grant. The
 * same stacking `runSlotsFor` does, and stated once here so the gate, the
 * refusal copy and the ledger cannot each derive it differently.
 */
export const yearClosesFor = (e: Entitlements): number =>
  limitsFor(e).yearClosesPerDay + e.extraYearCloses;

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
    const stored = JSON.parse(raw) as Partial<Entitlements> & { extraRunSlots?: number };
    const merged = { ...NO_ENTITLEMENTS, ...stored };
    /*
     * A device that last wrote this before 0013 holds `extraRunSlots`. That
     * player paid for concurrency and was given a daily founding; the honest
     * conversion is one for one, into the thing the receipt described. Read
     * only when the new field is absent, so a device that has already been
     * converted — or has since synced a real value down from the server —
     * is never overwritten by the stale key sitting beside it.
     */
    if (stored.extraIslands === undefined && typeof stored.extraRunSlots === "number") {
      merged.extraIslands = Math.max(0, stored.extraRunSlots);
    }
    delete (merged as { extraRunSlots?: number }).extraRunSlots;
    return merged;
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

// ── The daily year-close ration ──────────────────────────────────────────────

/**
 * How many fiscal years this DEVICE has closed today, for the free tier's
 * pace limit. Device-level rather than per-run on purpose: the limit is "four
 * years of progress a day", and counting per company would make founding a
 * second company the workaround. The player's LOCAL calendar day, same clock
 * as the run ledger above and for the same reason: a personal daily allowance
 * resets at the person's own midnight, not Greenwich's.
 */
const YEAR_CLOSE_KEY = "novus:yearcloses:v1";

function yearClosesToday(): number {
  if (!canStore()) return 0;
  try {
    const raw = localStorage.getItem(YEAR_CLOSE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { day?: string; closed?: number };
    return parsed.day === todayISO() ? Math.max(0, parsed.closed ?? 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * Year closes left today under the CURRENT entitlements. Pro is ~unlimited, and
 * an operator's grant (0012) is added to whatever the tier allows.
 */
export function yearClosesRemainingToday(e: Entitlements = loadEntitlements()): number {
  return Math.max(0, yearClosesFor(e) - yearClosesToday());
}

/** Spend one. Called by the game when a fiscal year actually closes. */
export function recordYearClose(): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(
      YEAR_CLOSE_KEY,
      JSON.stringify({ day: todayISO(), closed: yearClosesToday() + 1 }),
    );
  } catch {
    // A blocked store must not take the year-end screen down with it.
  }
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
 * Counts run STARTS per real calendar day, against `runsPerDayFor()`.
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

/**
 * The player's OWN calendar day, not UTC's.
 *
 * This was `toISOString()`, which is the UTC date — and for anyone west of
 * Greenwich the UTC day rolls over mid-afternoon or evening. Found a company
 * at 8pm in California and the ledger stamps TOMORROW's UTC date on it, so
 * the slot stays spent through almost all of the player's actual next day:
 * the reported "the number of runs does not reset every day". A daily ration
 * promised to a person resets at that person's midnight. (Today's Market
 * stays on UTC deliberately — it is one shared event for everyone — but a
 * personal allowance is personal.)
 */
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

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
  return Math.max(0, runsPerDayFor(e) - loadRunLedger().started);
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
