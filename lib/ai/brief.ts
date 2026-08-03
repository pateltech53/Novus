import { apiUrl } from "@/lib/native/origin";
import type { Industry } from "@/lib/engine/types";
import { type CompanyBrief, localBrief, sanitizeBrief } from "@/lib/engine/company-brief";

/**
 * "Write it for me" — the client half of /api/brief.
 *
 * Always returns a brief. With a key behind the route the model writes one for
 * this specific company; without one, `localBrief()` writes a real, editable
 * draft offline. A player must never tap this button and get nothing, because
 * the button exists precisely for the player who does not know what to type and
 * an empty answer would strand them.
 */

const ENDPOINT = process.env.NEXT_PUBLIC_BRIEF_ENDPOINT || "/api/brief";

/** Latches on 501/401/404 so a keyless deploy spends one request, not one per tap. */
let briefDown = false;

export async function writeBrief(opts: {
  companyName: string;
  industry: Industry;
  industryName: string;
  companyType: string;
  /** Whatever the player has already typed. Never overwritten. */
  draft?: Partial<CompanyBrief>;
}): Promise<{ brief: CompanyBrief; source: "api" | "local" }> {
  const fallback = () => ({
    brief: mergeDraft(
      localBrief({
        companyName: opts.companyName,
        industry: opts.industry,
        companyType: opts.companyType,
      }),
      opts.draft,
    ),
    source: "local" as const,
  });

  if (briefDown) return fallback();

  try {
    const res = await fetch(ENDPOINT.startsWith("/") ? apiUrl(ENDPOINT) : ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyName: opts.companyName,
        industry: opts.industry,
        industryName: opts.industryName,
        companyType: opts.companyType,
        draft: opts.draft ?? {},
      }),
    });
    if (!res.ok) {
      if ([501, 401, 404].includes(res.status)) briefDown = true;
      return fallback();
    }
    const raw = (await res.json()) as Partial<CompanyBrief>;
    const brief = sanitizeBrief({ ...raw, companyType: opts.companyType, source: "ai" });
    // A model that answered with nothing usable is the same as no model at all.
    if (!brief.whatItDoes && !brief.usp) return fallback();
    return { brief: mergeDraft(brief, opts.draft), source: "api" };
  } catch {
    return fallback();
  }
}

/**
 * The player's own words win, always.
 *
 * A founder who wrote one good sentence and pressed the button for the rest
 * must not have that sentence replaced. Generating over the top of it would be
 * the app writing the player's words back at them, which is the line this
 * codebase does not cross anywhere else either.
 */
function mergeDraft(generated: CompanyBrief, draft?: Partial<CompanyBrief>): CompanyBrief {
  if (!draft) return generated;
  const keep = (mine: unknown, theirs: string) =>
    typeof mine === "string" && mine.trim() ? mine.trim() : theirs;
  return sanitizeBrief({
    companyType: keep(draft.companyType, generated.companyType),
    whatItDoes: keep(draft.whatItDoes, generated.whatItDoes),
    usp: keep(draft.usp, generated.usp),
    whyCustomers: keep(draft.whyCustomers, generated.whyCustomers),
    mission: keep(draft.mission, generated.mission),
    // "ai" only when the model actually contributed something the player did
    // not write. The debrief reads this to know whose words it is critiquing.
    source: draft.whatItDoes && draft.usp ? "player" : "ai",
  });
}
