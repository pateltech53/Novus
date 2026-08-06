import { NextResponse, type NextRequest } from "next/server";

import { AI_LIMITS, NOT_CONFIGURED, OPENROUTER_API_KEY } from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { askOpenRouter, str } from "@/lib/ai/server/openrouter";

/*
 * Sixty seconds, matching PROVIDER_TIMEOUT_MS, for the reason every other route
 * under app/api carries this line: a serverless default of 10s terminates the
 * function mid-request and the client falls back for a provider that was
 * working fine.
 */
export const maxDuration = 60;

/**
 * POST /api/products — three things this company could sell.
 *
 * ── The empty shelf ────────────────────────────────────────────────────────
 *
 * A founded company owns nothing, and the launch flow opens on a blank field
 * headed "Name your menu item." The player has invented a company name ninety
 * seconds ago and is now being asked to invent a product name, a price and a
 * build quality with nothing in front of them. The tutorial points them here
 * first, which means the emptiest screen in the game is also the one it sends
 * every new player to.
 *
 * This writes three starting points. They are suggestions and nothing else:
 * the client fills the launch fields with whichever one is tapped, and the
 * player still walks the same three taps and still pays the same money. This
 * route never launches anything — it cannot, it is handed no run to write to.
 *
 * ── Why three, and why they differ ─────────────────────────────────────────
 *
 * The launch flow teaches one thing: price and build quality are a decision
 * with a consequence, not a default. Three ideas at the same price would teach
 * the opposite. So the model is required to spread them across the cheap /
 * proper / all-out axis the industry's own invest tiers already define, which
 * makes the shelf a worked example of the choice rather than a menu.
 *
 * With no key the client falls to `localSuggestions()` in lib/ai/products.ts,
 * which builds three from the industry's own tag vocabulary, seeded on the run.
 * Nothing here is worse without a key; it is only less specific to the company.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You suggest products for a company in Novus, a business simulation played by teenagers. The player has just founded the company and has nothing to sell yet. You write three starting points they will edit.

WHAT YOU WRITE
Exactly three ideas. Each has a name, a price, a build tier and at most two tags.

- name: what the thing is called. Short — under 28 characters — concrete, and something a real small business would actually put on a menu, a shelf or a page. It is the player's company, so match the name and the brief they wrote if there is one.
- price: a number inside the band you are given. Not a string, no currency symbol.
- invest_tier: 0 cheap and fast, 1 do it properly, 2 go all out.
- tags: zero, one or two, chosen ONLY from the tag list you are given. Never invent a tag.
- why: one short line, under 90 characters, saying what the trade-off is — what this choice costs and what it buys. Plain, not a sales pitch.

THE SPREAD — this is the point of the three
Return one cheap idea (invest_tier 0, priced well under the baseline), one middle idea (invest_tier 1, priced near the baseline) and one premium idea (invest_tier 2, priced well above). The player is learning that price and build quality are a decision with a consequence; three ideas at one price would teach them the opposite.

RULES
- Real trade language. Never coins, gems, points, XP, "disrupt", "synergy", "revolutionary" or "AI-powered" unless the company's own description says so.
- This is a small, new, real business. Do not invent revenue, customers, awards or partnerships, and do not claim anything is popular — the game holds the actual numbers.
- Do not repeat anything in the list of what they already sell.
- No emoji, no exclamation marks, no headings.
- These are minors and this is their company. Take the idea seriously, however small it is.

OUTPUT
Return only the JSON object described by the schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number" },
          invest_tier: { type: "number" },
          tags: { type: "array", items: { type: "string" } },
          why: { type: "string" },
        },
        required: ["name", "price", "invest_tier", "tags", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
} as const;

interface RawIdea {
  name?: unknown;
  price?: unknown;
  invest_tier?: unknown;
  tags?: unknown;
  why?: unknown;
}

export async function POST(req: NextRequest) {
  if (!OPENROUTER_API_KEY) return NextResponse.json(NOT_CONFIGURED, { status: 501 });

  let body: {
    companyName?: unknown;
    industry?: unknown;
    industryName?: unknown;
    noun?: unknown;
    tags?: unknown;
    priceMin?: unknown;
    priceMax?: unknown;
    baselinePrice?: unknown;
    investTiers?: unknown;
    brief?: Record<string, unknown> | null;
    existing?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const companyName = str(body.companyName, 48);
  if (!companyName) return NextResponse.json({ error: "No company." }, { status: 400 });

  const limited = await claimAiCall(req, "products", {
    perIp: AI_LIMITS.briefPerIp,
    perDay: AI_LIMITS.briefPerDay,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Suggestion budget spent." }, { status: 429 });
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string").slice(0, 24)
    : [];

  const result = await askOpenRouter<{ ideas?: RawIdea[] }>({
    system: SYSTEM,
    user: {
      company_name: companyName,
      industry: str(body.industryName, 48) || str(body.industry, 16),
      what_one_is_called: str(body.noun, 32) || "product",
      /*
       * The brief the founder wrote at founding, so the shelf is THIS company's
       * shelf. Without it the model is guessing from an industry code, which is
       * the fixture problem in a new place.
       */
      what_the_company_is: body.brief ?? "not stated — infer something plausible",
      price_band: {
        min: Number(body.priceMin) || 1,
        max: Number(body.priceMax) || 100,
        what_the_market_expects: Number(body.baselinePrice) || 10,
      },
      build_tiers: Array.isArray(body.investTiers) ? body.investTiers.slice(0, 3) : [],
      tags_you_may_use: tags,
      what_they_already_sell: Array.isArray(body.existing)
        ? body.existing.filter((n): n is string => typeof n === "string").slice(0, 8)
        : [],
    },
    schema: SCHEMA,
    schemaName: "product_ideas",
    // Variety is the product here, as with /api/brief: two players founding a
    // burger shop must not be handed the same three dishes.
    temperature: 1,
    maxTokens: 420,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ error: "No ideas." }, { status: result.status });
  }

  const ideas = (Array.isArray(result.data.ideas) ? result.data.ideas : [])
    .slice(0, 3)
    .map((idea) => ({
      name: str(idea.name, 28),
      price: Number(idea.price),
      // Named `invest_tier` on the wire and `investTier` in the client, which is
      // the same casing split every other route in this directory carries.
      investTier: [0, 1, 2].includes(Number(idea.invest_tier)) ? Number(idea.invest_tier) : 1,
      tags: (Array.isArray(idea.tags) ? idea.tags : [])
        .filter((t): t is string => typeof t === "string" && tags.includes(t))
        .slice(0, 2),
      why: str(idea.why, 90),
    }))
    .filter((idea) => idea.name.length > 0);

  return NextResponse.json({ ideas, source: "ai" as const });
}
