/**
 * Score → band. Two pure functions and nothing else.
 *
 * ── Why they are not in lib/ai/stub.ts any more ─────────────────────────────
 *
 * They were, and `components/PerformScreen.tsx` imported `tierForScore` from
 * there — one line of arithmetic, which pulled in the whole offline fallback
 * module and, with it, `fixtures/briefs.json` (9 KB) and
 * `fixtures/panel-scripts.json` (57 KB) as statically-imported JSON. 66 KB of
 * canned shark dialogue, in the bundle, on the strength of a comparison
 * against 8 and 5.
 *
 * `stub.ts` re-exports both from here, so the offline path and every existing
 * caller are unchanged; nothing had to move except the definition.
 *
 * The two live together because they are the same cut expressed twice, and
 * that is exactly the kind of thing that drifts when it is written down in two
 * places: 8 and above is a good pitch, 5 and above is a middling one. `Tier`
 * names the canned response set, `Band` names the copy variant.
 */
export type Tier = "good" | "mid" | "rough";
export type Band = "high" | "mid" | "low";

export const tierForScore = (score: number): Tier =>
  score >= 8 ? "good" : score >= 5 ? "mid" : "rough";

export const bandForScore = (score: number): Band =>
  score >= 8 ? "high" : score >= 5 ? "mid" : "low";
