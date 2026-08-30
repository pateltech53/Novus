import { rngFor } from "./seed";
import { TEMPLATES, type Template } from "./templates";
import type { Band } from "./tables";

/**
 * The five challenges everyone in the world gets today.
 *
 * ── Why it stores nothing ───────────────────────────────────────────────────
 *
 * The day is a pure function of its date. No table, no cron, no "who generated
 * today first" race between two serverless instances — any server, at any
 * time, can recompute any day and get the same five challenges. That is also
 * what makes the anti-repeat window cheap: yesterday's picks are not looked
 * up, they are recomputed.
 *
 * The recursion that implies is bounded at two levels deep and memoised below,
 * so generating a day costs three cheap passes, not an unbounded chain back to
 * the launch date.
 *
 * ── Why everyone gets the same five ─────────────────────────────────────────
 *
 * A shared day is a shared conversation — "did you get the Serena one?" — and
 * it keeps the leaderboard honest, because everyone is racing the same list.
 * Per-player generation would tune difficulty better and kill both.
 */

export interface DailySlot {
  slot: number;
  id: string;
  band: Band;
  /** The template's text with its parameters substituted in. */
  text: string;
  param: Record<string, string | number>;
  event: string;
  target: number;
}

export interface DailyConfig {
  date: string;
  slots: DailySlot[];
}

/**
 * Feature flags a template can require.
 *
 * A template behind a false flag never enters the pool, which is how a mission
 * for a mechanic that does not exist stays out of a player's day instead of
 * sitting at 0/1 until the reset. Two are dark for different reasons:
 *
 *   · `coldcall` — The Room HAS shipped, but the activity that opens it is
 *     Pro-only. A daily mission a free account is structurally unable to
 *     complete is worse than one fewer mission, so it stays off until the
 *     mission generator can be told which slots an account can actually reach.
 *   · `debt` — there is no loan in the engine at all. Nothing to pay off.
 *   · `customers` — the sim models market share, brand and churn, never a
 *     customer count, so "reach 1,000 customers" has no number to read.
 */
export interface DailyFlags {
  coldcall?: boolean;
  energy?: boolean;
  sharks?: boolean;
  debt?: boolean;
  customers?: boolean;
}

const DEFAULT_FLAGS: DailyFlags = {
  coldcall: false, energy: false, sharks: true, debt: false, customers: false,
};

const flagLive = (flags: string[], live: DailyFlags): boolean =>
  flags.every((flag) => {
    const key = flag.replace(/^requires:/, "") as keyof DailyFlags;
    return live[key] !== false;
  });

/** Sample n distinct items, seeded. */
function sample<T>(pool: T[], n: number, rand: () => number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  while (out.length < n && copy.length) {
    out.push(...copy.splice(Math.floor(rand() * copy.length), 1));
  }
  return out;
}

const choose = <T>(list: T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

const SHARKS = ["Marcus", "Serena", "Dev", "Lily", "Viktor"];
const FREE_INDUSTRIES = ["FOOD", "ECOM", "TECH", "CONTENT"];
const ALL_INDUSTRIES = [...FREE_INDUSTRIES, "FASHION", "GAMING", "FITNESS", "BEAUTY",
  "EDTECH", "SUSTAIN", "TOYS", "PET"];

const cache = new Map<string, DailyConfig>();

/**
 * The first day the anti-repeat window has anything to look back at.
 *
 * The window has to exclude what the PREVIOUS TWO DAYS ACTUALLY SHOWED, and
 * what they showed was itself shaped by their own windows. Recomputing a
 * neighbour without its window produces a different day than the one players
 * saw, and the exclusion silently stops working — which is exactly the bug
 * this constant fixes.
 *
 * So the chain is anchored: on the epoch and before it there is no window, and
 * every later day is built forward from there. Walking a year costs 365 passes
 * of a pure function, once per process, and the cache below means only the
 * first request after a cold start pays even that.
 */
const EPOCH = "2026-01-01";

const dayBefore = (dateISO: string): string => {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function generateDaily(dateISO: string, live: DailyFlags = DEFAULT_FLAGS): DailyConfig {
  const flagKey = JSON.stringify(live);
  const cached = cache.get(`${dateISO}|${flagKey}`);
  if (cached) return cached;

  // Collect the run of days back to the epoch (or to the nearest cached day),
  // then build FORWARD. Iterative rather than recursive: a deployment still
  // running in ten years would otherwise recurse 3,650 frames deep on its
  // first request.
  const chain: string[] = [];
  for (let d = dateISO; ; d = dayBefore(d)) {
    chain.unshift(d);
    if (d <= EPOCH || cache.has(`${dayBefore(d)}|${flagKey}`)) break;
  }

  let result: DailyConfig | undefined;
  for (const date of chain) {
    const key = `${date}|${flagKey}`;
    const hit = cache.get(key);
    if (hit) { result = hit; continue; }

    // What the previous two days actually showed — read from the cache the
    // loop is filling, so it is the real thing and not a re-derivation.
    const recent = new Set(
      [1, 2]
        .map((back) => {
          let prev = date;
          for (let i = 0; i < back; i++) prev = dayBefore(prev);
          return cache.get(`${prev}|${flagKey}`);
        })
        .filter((c): c is DailyConfig => Boolean(c))
        .flatMap((c) => c.slots.map((s) => s.id)),
    );

    const rand = rngFor(`novus-daily-v1:${date}`);
    const eligible = TEMPLATES.filter((t) => flagLive(t.flags, live) && !recent.has(t.id));
    result = { date, slots: pick(eligible, rand) };
    cache.set(key, result);
  }

  return result!;
}

function pick(eligible: Template[], rand: () => number): DailySlot[] {
  const bands: Band[] = ["easy", "easy", "medium", "medium", "hard"];
  const used = new Set<string>();
  const slots: DailySlot[] = [];

  bands.forEach((band, index) => {
    const pool = eligible.filter((t) => t.params[band]?.length && !used.has(t.id));
    // The pool cannot realistically empty — six categories stay ≥8 deep after
    // flags — but a starved generator must still return five slots rather than
    // throw on a day nobody can then play.
    const fallback = TEMPLATES.filter((t) => t.params[band]?.length && !used.has(t.id));
    const template = sample(pool.length ? pool : fallback, 1, rand)[0];
    used.add(template.id);

    const param = { ...choose(template.params[band]!, rand) } as Record<string, string | number>;
    if (template.text.includes("{shark}")) param.shark = choose(SHARKS, rand);
    if (template.text.includes("{industry}")) {
      param.industry = choose(band === "easy" ? FREE_INDUSTRIES : ALL_INDUSTRIES, rand);
    }

    slots.push({
      slot: index + 1,
      id: template.id,
      band,
      text: fill(template.text, param),
      param,
      event: template.event,
      target: typeof param.n === "number" ? param.n : 1,
    });
  });

  return slots;
}

/** `Play for {n} minutes today` + {n: 20} → `Play for 20 minutes today`. */
export function fill(text: string, param: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in param ? String(param[key]) : whole);
}
