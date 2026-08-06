import { apiUrl } from "@/lib/native/origin";
import type { RunState } from "@/lib/engine/types";
import type { IndustrySpec } from "@/lib/engine/portfolio";
import { hashString, mulberry32 } from "@/lib/engine/rng";

/**
 * THREE THINGS YOU COULD SELL — the client half of /api/products.
 *
 * ── The empty shelf ────────────────────────────────────────────────────────
 *
 * A founded company owns nothing. The tutorial says so out loud — "PRODUCT is
 * where you launch what you sell… make this the first place you go" — and then
 * the launch flow opens on a blank field headed "Name your menu item." A
 * fifteen-year-old who has just invented a company name is being asked to
 * invent a product name, a price and a build quality with nothing in front of
 * them, and the reported behaviour is that they close the sheet.
 *
 * So the shelf arrives with three ideas on it. They are SUGGESTIONS and
 * nothing else: tapping one fills in the name, the price and the build tier,
 * and the player still walks the same three taps and still pays the same
 * money. Nothing is launched on their behalf, nothing is spent on their
 * behalf, and every field stays editable — a draft they can overwrite, exactly
 * like the "write it for me" button on the founding brief.
 *
 * ── Always three ───────────────────────────────────────────────────────────
 *
 * With a key behind the route a model writes them for this specific company,
 * reading the brief the founder wrote. Without one, `localSuggestions()` writes
 * three real ones from the industry's own vocabulary, seeded on the run so the
 * same company always gets the same shelf. A player must never tap this and
 * get nothing, which is the same rule `lib/ai/brief.ts` states and for the
 * same reason: the button exists for the player who does not know what to
 * type, and an empty answer strands exactly them.
 */

export interface ProductIdea {
  /** Max 28 chars, matching the launch field. */
  name: string;
  /** Already clamped to the industry's band and step. */
  price: number;
  investTier: 0 | 1 | 2;
  /** At most two, from the industry's own tag list. */
  tags: string[];
  /** One short line the player reads before choosing. Never a sales pitch. */
  why: string;
}

const ENDPOINT = process.env.NEXT_PUBLIC_PRODUCTS_ENDPOINT || "/api/products";

/** Latches on 501/401/404 so a keyless deploy spends one request, not one per tap. */
let productsDown = false;

export async function suggestProducts(opts: {
  run: RunState;
  spec: IndustrySpec;
  industryName: string;
}): Promise<{ ideas: ProductIdea[]; source: "api" | "local" }> {
  const fallback = () => ({
    ideas: localSuggestions(opts.run, opts.spec),
    source: "local" as const,
  });

  if (productsDown) return fallback();

  try {
    const res = await fetch(ENDPOINT.startsWith("/") ? apiUrl(ENDPOINT) : ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: opts.run.companyName,
        industry: opts.run.industry,
        industryName: opts.industryName,
        noun: opts.spec.noun,
        tags: opts.spec.tags,
        priceMin: opts.spec.priceMin,
        priceMax: opts.spec.priceMax,
        baselinePrice: opts.spec.baselinePrice,
        investTiers: opts.spec.investTiers.map((t) => t.label),
        brief: opts.run.brief ?? null,
        /*
         * What they already sell, so the model does not suggest it again. The
         * second visit to this sheet is the one where a repeat is obvious.
         */
        existing: (opts.run.portfolio?.items ?? [])
          .filter((i) => !i.retiredYear)
          .map((i) => i.name)
          .slice(0, 8),
      }),
    });
    if (!res.ok) {
      if ([501, 401, 404].includes(res.status)) productsDown = true;
      return fallback();
    }
    const raw = (await res.json()) as { ideas?: unknown };
    const ideas = shape(raw.ideas, opts.spec);
    // A model that answered with nothing usable is the same as no model at all.
    if (ideas.length < 3) return fallback();
    return { ideas, source: "api" };
  } catch {
    return fallback();
  }
}

/** Whatever came back over the wire, made safe and made legal for this industry. */
function shape(raw: unknown, spec: IndustrySpec): ProductIdea[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductIdea[] = [];
  for (const entry of raw.slice(0, 3)) {
    const e = entry as Partial<ProductIdea>;
    const name = typeof e.name === "string" ? e.name.trim().slice(0, 28) : "";
    if (!name) continue;
    out.push({
      name,
      price: clamp(Number(e.price), spec),
      investTier: ([0, 1, 2] as const).includes(e.investTier as 0 | 1 | 2)
        ? (e.investTier as 0 | 1 | 2)
        : 1,
      // Only the industry's own tags. A model inventing "artisanal" would put a
      // tag in the portfolio that nothing downstream knows how to price.
      tags: (Array.isArray(e.tags) ? e.tags : [])
        .filter((t): t is string => typeof t === "string" && (spec.tags as readonly string[]).includes(t))
        .slice(0, 2),
      why: typeof e.why === "string" ? e.why.trim().slice(0, 90) : "",
    });
  }
  return out;
}

/** The industry's price band, honoured exactly as the launch flow honours it. */
function clamp(n: number, spec: IndustrySpec): number {
  if (!Number.isFinite(n)) return spec.baselinePrice;
  const stepped = Math.round(n / spec.priceStep) * spec.priceStep;
  const bounded = Math.max(spec.priceMin, Math.min(spec.priceMax, stepped));
  // Two decimals at most — priceStep can be 0.5, and floats being floats.
  return Math.round(bounded * 100) / 100;
}

/**
 * Three ideas with no model behind them.
 *
 * Built from the industry's own tag vocabulary rather than from a list of
 * product names, because a hardcoded name list is the fixture problem this
 * codebase has already paid for twice: it would be the same three dishes for
 * every FOOD company on every device, and players would spot it on the second
 * run. A tag plus a shape word is generic enough to be honest about being a
 * starting point and specific enough to be worth tapping.
 *
 * Seeded on the run and the portfolio size, so the same company gets the same
 * shelf on every render — and a DIFFERENT one after it launches something,
 * which is when the player comes back for more ideas.
 *
 * The three deliberately differ on the axis the launch flow is teaching: one
 * cheap and cheerful, one down the middle, one expensive and well made. That
 * spread is the lesson — price and build quality are a choice, not a default.
 */
export function localSuggestions(run: RunState, spec: IndustrySpec): ProductIdea[] {
  const live = (run.portfolio?.items ?? []).filter((i) => !i.retiredYear);
  const rng = mulberry32(
    hashString(`products:${run.seed}:${run.industry}:${live.length}:${run.year}`),
  );
  const pick = <T,>(list: T[]): T => list[Math.floor(rng() * list.length)];

  /** Words that read as a product without pretending to know the industry. */
  const SHAPES = ["Everyday", "House", "Weekend", "Classic", "Little", "Daily", "Corner", "First"];
  const PREMIUM = ["Signature", "Reserve", "Flagship", "Limited", "Master"];
  const VALUE = ["Basic", "Starter", "Simple", "Plain", "Standard"];

  /*
   * Tags that argue with the price.
   *
   * The tags are drawn from the industry's own list, which is right — they are
   * the only ones the sim knows how to price. Drawn at RANDOM, though, the
   * cheap idea came out as "Plain Premium" at tier 0 and the expensive one as
   * "Signature Enterprise" tagged `free`. A suggestion that contradicts itself
   * is worse than no suggestion: the player is being taught that the tag and
   * the price are the same decision seen twice.
   *
   * Matched on the tag TEXT rather than a per-industry table, because twelve
   * hand-maintained lists would drift the first time an industry gains a tag.
   * It is a coarse filter and it only ever removes candidates — an industry
   * whose tags say nothing about price is unaffected.
   */
  const DEAR = /premium|luxury|enterprise|pro\b|prosumer|limited|reserve|couture|deluxe/i;
  const CHEAP = /basic|budget|starter|clearance|value|lite/i;
  /* Every idea below carries a price, and a priced thing tagged `free` is a
     contradiction at any tier — TECH produced "Standard Free" at $27. */
  const NEVER = /free|f2p/i;

  const tagsFor = (tier: 0 | 1 | 2): string[] => {
    const all = (spec.tags as readonly string[]).filter(
      (t) =>
        !NEVER.test(t) && (tier === 0 ? !DEAR.test(t) : tier === 2 ? !CHEAP.test(t) : true),
    );
    // Every tag was filtered out — rare, and a bare noun is better than a lie.
    if (all.length === 0) return [];
    const a = pick([...all]);
    const b = pick([...all]);
    return a === b ? [a] : [a, b];
  };

  const title = (word: string, tag: string | undefined): string => {
    const noun = spec.noun.split(/\s+/)[0];
    const base = tag ? `${word} ${cap(tag)}` : `${word} ${noun}`;
    return base.slice(0, 28);
  };

  const cheapTags = tagsFor(0);
  const midTags = tagsFor(1);
  const richTags = tagsFor(2);

  return [
    {
      name: title(pick(VALUE), cheapTags[0]),
      price: clamp(spec.baselinePrice * 0.7, spec),
      investTier: 0,
      tags: cheapTags.slice(0, 1),
      why: "Cheap to make and cheap to buy. Thin margin, but it gets you selling.",
    },
    {
      name: title(pick(SHAPES), midTags[0]),
      price: clamp(spec.baselinePrice, spec),
      investTier: 1,
      tags: midTags,
      why: "Priced where the market expects it, made properly. The safe first move.",
    },
    {
      name: title(pick(PREMIUM), richTags[0]),
      price: clamp(spec.baselinePrice * 1.6, spec),
      investTier: 2,
      tags: richTags,
      why: "Costs more to build and asks more of the customer. Bigger margin if they bite.",
    },
  ];
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
