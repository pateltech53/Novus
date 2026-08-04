import { NextResponse, type NextRequest } from "next/server";

import { AI_LIMITS, NOT_CONFIGURED, OPENROUTER_API_KEY } from "@/lib/ai/server/providers";
import { claimAiCall } from "@/lib/ai/server/limit";
import { askOpenRouter, str } from "@/lib/ai/server/openrouter";

/*
 * The provider is allowed a minute (PROVIDER_TIMEOUT_MS); the platform was
 * allowed to decide otherwise, and did.
 *
 * No route under app/api declared `maxDuration`, so every one of them ran at a
 * serverless host's default — commonly 10 s. A route that waits up to 60 s for
 * a model, on a function that is killed at 10, does not time out gracefully:
 * it is terminated, the client sees a network error rather than a JSON body,
 * and the offline fallback fires for a provider that was working. The stated
 * timeouts in lib/ai/server were unreachable.
 *
 * 60 matches PROVIDER_TIMEOUT_MS so the two agree, and the AbortSignal on the
 * provider call stays the thing that actually ends a slow request.
 */
export const maxDuration = 60;


/**
 * POST /api/brief — "I don't know what to write."
 *
 * The founding screen asks four questions a first-time founder often cannot
 * answer yet: what the company does, what makes it different, why anyone would
 * choose it, and what it is ultimately for. Leaving those blank is allowed, but
 * a blank brief means a blank deck in The Tank, and then the player invents a
 * company under questioning — which is the exact failure the brief exists to
 * prevent.
 *
 * So this writes a first draft they can edit. It is a starting point with the
 * player's own name and industry in it, not a finished answer.
 *
 * ── Why this is the cheapest call in the app, on purpose ───────────────────
 *
 * Four short strings, once per founded company. `max_tokens` is set to what
 * four sentences actually need and the temperature is high — the ONE place in
 * this codebase where variety is the product, because two players founding a
 * burger shop must not be handed the same paragraph. Everything else here is
 * judged against a rubric and runs cold.
 *
 * With no key the client falls to `localBrief()` in
 * lib/engine/company-brief.ts, which writes a real brief offline. Nothing about
 * this screen is worse without a key; it is only less specific.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = `You write the founding brief for a company in Novus, a business simulation played by teenagers. The player has chosen a name, an industry and a kind of business, and has said they do not know how to describe it yet. You write the first draft they will edit.

WHAT YOU WRITE
- what_it_does: two sentences. What the company sells and who buys it. Concrete and physical — a specific product, a specific customer, a specific occasion. Never "innovative solutions" or "leveraging technology".
- usp: one sentence. The single thing that makes it different from the nearest competitor. A real difference a customer could notice, not an adjective.
- why_customers: one sentence. Why someone picks this over the thing they currently use. Answer it from the customer's side, not the founder's.
- mission: one short sentence. What the company is ultimately for. Plain language, no slogans.

RULES
- This is a small, new, real company — a first business, not a unicorn. Do not invent revenue, funding, customers, awards or partnerships. Say what it IS, never how well it is doing; the game holds the actual numbers and a brief that contradicts them would be caught.
- Real trade language only. Never coins, gems, points, XP, "disrupt", "synergy", "revolutionary", "game-changing" or "AI-powered" unless the player's own business type says so.
- Write it as the founder would say it out loud to a person, not as marketing copy. No exclamation marks, no emoji, no headings.
- These are minors and this is their company. Take the idea seriously, however small it is.

OUTPUT
Return only the JSON object described by the schema.`;

const SCHEMA = {
  type: "object",
  properties: {
    what_it_does: { type: "string" },
    usp: { type: "string" },
    why_customers: { type: "string" },
    mission: { type: "string" },
  },
  required: ["what_it_does", "usp", "why_customers", "mission"],
  additionalProperties: false,
} as const;

interface Draft {
  what_it_does?: unknown;
  usp?: unknown;
  why_customers?: unknown;
  mission?: unknown;
}

export async function POST(req: NextRequest) {
  if (!OPENROUTER_API_KEY) return NextResponse.json(NOT_CONFIGURED, { status: 501 });

  let body: {
    companyName?: unknown;
    industry?: unknown;
    industryName?: unknown;
    companyType?: unknown;
    /** Anything the player already typed. Kept, never overwritten. */
    draft?: { whatItDoes?: unknown; usp?: unknown; whyCustomers?: unknown; mission?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  const companyName = str(body.companyName, 48);
  if (!companyName) return NextResponse.json({ error: "No company." }, { status: 400 });

  const limited = await claimAiCall(req, "brief", {
    perIp: AI_LIMITS.briefPerIp,
    perDay: AI_LIMITS.briefPerDay,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: "Brief budget spent." }, { status: 429 });
  }

  const result = await askOpenRouter<Draft>({
    system: SYSTEM,
    user: {
      company_name: companyName,
      industry: str(body.industryName, 48) || str(body.industry, 16),
      kind_of_business: str(body.companyType, 48) || "not stated — infer something plausible",
      // Sent so the model writes AROUND what the player has already committed
      // to rather than talking over them.
      what_the_player_already_wrote: {
        what_it_does: str(body.draft?.whatItDoes, 240) || null,
        usp: str(body.draft?.usp, 200) || null,
        why_customers: str(body.draft?.whyCustomers, 200) || null,
        mission: str(body.draft?.mission, 160) || null,
      },
    },
    schema: SCHEMA,
    schemaName: "company_brief",
    // The one call in the app where two players getting the same answer is the
    // failure. Everything else is judged against a rubric and runs cold.
    temperature: 1,
    maxTokens: 320,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ error: "No draft." }, { status: result.status });
  }

  return NextResponse.json({
    whatItDoes: str(result.data.what_it_does, 240),
    usp: str(result.data.usp, 200),
    whyCustomers: str(result.data.why_customers, 200),
    mission: str(result.data.mission, 160),
    source: "ai" as const,
  });
}
