import type { Choice, GameEvent, Outcome, PerformSpec, RunState } from "./types";
import { earningItems, ensurePortfolio, liveItems, type LineItem } from "./portfolio";

/**
 * INTERPOLATION TOKENS — Addendum B §3.3.
 *
 * One string replacement upgrades the whole authored library at once: a tax
 * notice, a grandma letter and a supplier crisis stop happening to "a company"
 * and start happening to yours, naming your products and your people.
 *
 * ── The two rules that govern this file ────────────────────────────────────
 *
 * 1. TOKENS RESOLVE AT DRAW TIME AND FREEZE INTO THE CARD.
 *    Resolving lazily at render time would let the card rewrite itself under
 *    the player: retire {topItem} from the portfolio sheet while a decision is
 *    open and the situation text would silently start naming a different
 *    product than the one the question is about. `freezeEvent()` takes the
 *    snapshot once, and every string on the drawn card — situation, reskin,
 *    choice labels, and every consequence line that can follow from it — is
 *    resolved against that one snapshot.
 *
 * 2. A TOKEN WHOSE SUBJECT DOES NOT EXIST USES ITS FALLBACK.
 *    So an event may use any token unconditionally without checking state
 *    first. The exception the doc calls out: an event whose PREMISE requires
 *    the subject (anything built on {deadItem}) must gate on an authored flag
 *    rather than lean on the fallback — "the one you killed" is a phrase, not
 *    a dead product. `hasTokenSubject()` is here so the draw layer can assert
 *    that in tests; the validator warns about it in the data.
 *
 * Pure TS, no React, no RNG — the balance harness imports this directly.
 */

// ── Registry ────────────────────────────────────────────────────────────────

/**
 * The registry. `scripts/validate-tokens.mjs` PARSES THIS ARRAY out of this
 * file and fails the build on any token in the event data that is not in it,
 * so this literal is the single source of truth. Keep it a plain array of
 * quoted strings on one declaration or the validator will not find it.
 */
export const TOKEN_NAMES = [
  "company",
  "founderName",
  "topItem",
  "worstItem",
  "newestItem",
  "deadItem",
  "rival",
  "topHire",
  "hq",
  /**
   * Not in §3.3's table. It is already in the shipped library — E-PPL-006 and
   * K-TEC-2 both say "Year {y}" — and nothing has ever resolved it, so both
   * events have been rendering a literal brace at the player. Registering it
   * is what makes the validator's hard fail survivable and fixes the leak.
   */
  "y",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/**
 * What the player reads when the subject does not exist.
 *
 * `company` and `founderName` are always set in a real run; their entries are
 * defensive only, for a half-built state in a harness or a save written before
 * a field existed. Everything else is a fallback the doc specifies verbatim.
 */
export const TOKEN_FALLBACKS: Record<TokenName, string> = {
  company: "the company",
  founderName: "the founder",
  topItem: "your flagship",
  worstItem: "your slowest product",
  newestItem: "your newest launch",
  deadItem: "the one you killed",
  rival: "Marco's company",
  topHire: "your first hire",
  hq: "the office",
  // Unreachable — `y` always resolves. Present because the record is total.
  y: "1",
};

const TOKEN_SET: ReadonlySet<string> = new Set<string>(TOKEN_NAMES);

export const isTokenName = (name: string): name is TokenName => TOKEN_SET.has(name);

/** Matches `{token}`. Authored flag syntax never uses braces, so this is safe. */
const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** Every token in a string, in order of first appearance. */
export function tokensIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// ── Subjects ────────────────────────────────────────────────────────────────

/**
 * The rival layer (Addendum B §5) does not exist yet, and this module must not
 * wait for it. Read structurally: the day `positioning.ts` hangs a rival on the
 * run, `{rival}` starts naming it with no change here.
 */
export interface RivalRef {
  companyName?: string;
  founderName?: string;
}

/** Likewise for the office tier, which is Closet content and not built yet. */
interface HqRef {
  label?: string;
}

type RunStateWithLater = RunState & { rival?: RivalRef; hq?: string | HqRef };

/**
 * Company property, worst to best. Ids are `ASSET_CATALOG` ids from
 * holdings.ts. The office the player actually paid for is the truest available
 * answer to "where does this company sit" until the Closet ships a tier.
 */
const HQ_BY_ASSET: [assetId: string, phrase: string][] = [
  ["office-small", "the office you own"],
  ["warehouse", "the warehouse"],
  ["flagship", "the flagship"],
];

/**
 * Ranked by last full year's units, best first.
 *
 * Earning items only — a product still in development has no units, so
 * including it would hand `{worstItem}` the name of something that has not
 * shipped and call it your slowest. When nothing is earning yet the newest
 * live item stands in, because a year-one player is looking at a product they
 * named and should see that name rather than "your flagship".
 */
function rankedByUnits(state: RunState): LineItem[] {
  const p = ensurePortfolio(state);
  const earning = earningItems(p);
  if (earning.length > 0) {
    return earning
      .map((i) => ({ i, u: i.history.at(-1)?.units ?? 0 }))
      .sort((a, b) => b.u - a.u)
      .map((r) => r.i);
  }
  return byLaunchRecency(liveItems(p));
}

const byLaunchRecency = (items: LineItem[]): LineItem[] =>
  [...items].sort(
    (a, b) => b.launchedYear - a.launchedYear || b.launchedQuarter - a.launchedQuarter,
  );

/** Killed by the player or by an event, most recent first; then live flops. */
function deadItem(state: RunState): LineItem | null {
  const p = ensurePortfolio(state);
  const killed = p.items
    .filter((i) => i.state === "retired" || i.state === "recalled")
    .sort((a, b) => (b.retiredYear ?? 0) - (a.retiredYear ?? 0));
  if (killed.length > 0) return killed[0];
  return byLaunchRecency(p.items.filter((i) => i.verdict === "flop"))[0] ?? null;
}

/**
 * Longest-tenured, and on a tie the one hired first — `roster` is append-only,
 * so array order is hire order.
 */
function topHire(state: RunState): string | null {
  let best: { name: string; year: number } | null = null;
  for (const e of state.roster ?? []) {
    if (!best || e.hiredYear < best.year) best = { name: e.name, year: e.hiredYear };
  }
  return best?.name ?? null;
}

function hq(state: RunStateWithLater): string | null {
  const declared = typeof state.hq === "string" ? state.hq : state.hq?.label;
  if (declared) return declared;
  let found: string | null = null;
  for (const [assetId, phrase] of HQ_BY_ASSET) {
    if (state.holdings?.some((h) => h.defId === assetId)) found = phrase;
  }
  return found;
}

/**
 * The subject behind every token, or null where there is none.
 *
 * Null is the signal an event needs to decide whether it may fire at all — see
 * rule 2 in the file header. `resolveBindings()` turns the nulls into
 * fallbacks; this stays honest.
 */
export function tokenSubjects(state: RunState): Record<TokenName, string | null> {
  const later = state as RunStateWithLater;
  const ranked = rankedByUnits(state);
  const dead = deadItem(state);
  const newest = byLaunchRecency(liveItems(ensurePortfolio(state)))[0] ?? null;

  return {
    company: state.companyName || null,
    founderName: state.founderName || null,
    topItem: ranked[0]?.name ?? null,
    // With one product, top and worst are the same row. Naming your only
    // product as the weak one is a lie the fallback does not tell.
    worstItem: ranked.length > 1 ? (ranked.at(-1)?.name ?? null) : null,
    newestItem: newest?.name ?? null,
    deadItem: dead?.name ?? null,
    rival: later.rival?.companyName || null,
    topHire: topHire(state),
    hq: hq(later),
    // A callback to a decision the player has had time to forget. Always a
    // number, never a fallback phrase — these read "in Year {y}", and prose
    // there produces "in Year an earlier year".
    y: String(Math.max(1, state.year - 2)),
  };
}

/** True when the token names something real — the gate for premise-dependent events. */
export function hasTokenSubject(state: RunState, name: TokenName): boolean {
  return tokenSubjects(state)[name] !== null;
}

// ── Bindings ────────────────────────────────────────────────────────────────

/**
 * A resolved snapshot. Everything on one drawn card renders from a single one
 * of these, which is what "frozen" means in practice.
 */
export type TokenBindings = Record<TokenName, string>;

export interface ResolveOptions {
  /**
   * Per-token overrides, applied before fallbacks. The industry lens uses this
   * to say "your dish" instead of "your flagship" where the generic noun reads
   * wrong; an event chain uses it to pin a token to the item the chain is
   * about rather than whatever is top of the portfolio today.
   */
  overrides?: Partial<Record<TokenName, string>>;
}

export function resolveBindings(state: RunState, opts: ResolveOptions = {}): TokenBindings {
  const subjects = tokenSubjects(state);
  const out = {} as TokenBindings;
  for (const name of TOKEN_NAMES) {
    out[name] = opts.overrides?.[name] ?? subjects[name] ?? TOKEN_FALLBACKS[name];
  }
  return out;
}

/**
 * Substitute against an existing snapshot.
 *
 * An unregistered token is left verbatim rather than blanked: a literal
 * `{whatever}` on screen is an obvious bug report, an empty gap is a sentence
 * that quietly lost a noun. `scripts/validate-tokens.mjs` is the real gate and
 * it fails the build, so this path should never run in shipped data.
 */
export function applyBindings(text: string, bindings: TokenBindings): string {
  if (!text.includes("{")) return text;
  return text.replace(TOKEN_RE, (whole, name: string) =>
    isTokenName(name) ? bindings[name] : whole,
  );
}

/**
 * Resolve one string against the run. Convenience for log lines, mail and
 * anything else written outside the drawn-card path.
 *
 * SUPERSEDES `interpolateItems()` in portfolio.ts, which handled three of the
 * nine tokens and took an `IndustrySpec` it only used for a fallback noun —
 * pass `overrides` for that now.
 */
export function resolveTokens(text: string, state: RunState, opts?: ResolveOptions): string {
  if (!text.includes("{")) return text;
  return applyBindings(text, resolveBindings(state, opts));
}

// ── Freezing a drawn card ───────────────────────────────────────────────────

/** A drawn card, resolved, carrying the snapshot it was resolved against. */
export type FrozenEvent = GameEvent & { tokens: TokenBindings };

export const isFrozen = (ev: GameEvent): ev is FrozenEvent =>
  typeof (ev as FrozenEvent).tokens === "object" && (ev as FrozenEvent).tokens !== null;

/**
 * Resolve every authored string on an event and freeze the result.
 *
 * Call once, at draw time, on each surfaced event. Consequence lines are
 * resolved here too and not later: the narration the player reads after
 * choosing must name the same product the question named, even if the choice
 * they made is what retired it.
 *
 * Structural fields — ids, flags, special ops, effect stats — are copied by
 * reference and never touched.
 */
export function freezeEvent(
  ev: GameEvent,
  state: RunState,
  opts?: ResolveOptions,
): FrozenEvent {
  const tokens = resolveBindings(state, opts);
  return { ...freezeEventWith(ev, tokens), tokens };
}

/** Re-freeze against a snapshot already taken (a chain step reusing its parent's). */
export function freezeEventWith(ev: GameEvent, tokens: TokenBindings): GameEvent {
  const r = (s: string) => applyBindings(s, tokens);
  const out: GameEvent = { ...ev, title: r(ev.title), text: r(ev.text) };

  if (ev.reskins) {
    const reskins: Record<string, string> = {};
    for (const [industry, text] of Object.entries(ev.reskins)) reskins[industry] = r(text);
    out.reskins = reskins as GameEvent["reskins"];
  }
  if (ev.auto) out.auto = freezeOutcome(ev.auto, r);
  if (ev.performOnly) out.performOnly = freezePerform(ev.performOnly, r);
  if (ev.choices) out.choices = ev.choices.map((c) => freezeChoice(c, r));
  return out;
}

type Resolver = (s: string) => string;

function freezeChoice(c: Choice, r: Resolver): Choice {
  const out: Choice = { ...c, label: r(c.label) };
  if (c.known !== undefined) out.known = r(c.known);
  if (c.outcome) out.outcome = freezeOutcome(c.outcome, r);
  if (c.branches) out.branches = c.branches.map((b) => ({ ...b, outcome: freezeOutcome(b.outcome, r) }));
  if (c.perform) out.perform = freezePerform(c.perform, r);
  return out;
}

function freezePerform(p: PerformSpec, r: Resolver): PerformSpec {
  return { ...p, pass: freezeOutcome(p.pass, r), fail: freezeOutcome(p.fail, r) };
}

function freezeOutcome(o: Outcome, r: Resolver): Outcome {
  if (o.narration === undefined) return o;
  return { ...o, narration: r(o.narration) };
}
