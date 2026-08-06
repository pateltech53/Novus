import type { RunState } from "./types";
import { ensurePortfolio, liveItems, portfolioCap } from "./portfolio";
import { specForRun } from "./industries/index";

/**
 * THE NEXT THING TO DO — one nudge, or none.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The two tabs players report never finding are PRODUCT and TEAM, and the
 * tutorial already names both individually because "everything lives here"
 * taught the bar and still left the first product unlaunched. A tutorial can
 * only say it once, at minute zero, to a player who has not yet met the
 * problem. Months later they are advancing time with nothing on the shelf and
 * nobody employed, watching a company that cannot grow because the two things
 * that make it grow were never opened.
 *
 * So the game says so, once, quietly, at the moment it becomes true.
 *
 * ── The rules this obeys ───────────────────────────────────────────────────
 *
 * · ONE at a time. A screen with three things to fix is a screen a player
 *   ignores. They are ordered by what actually blocks the company.
 * · Every one is TRUE OF THIS RUN, computed from the same figures the Books
 *   show — never a generic tip. A nudge that fires when it does not apply is
 *   how a player learns to stop reading them.
 * · Every one is actionable in one tap, and names the tab that fixes it.
 * · None of them nag: the caller dismisses per month, and a nudge that has
 *   stopped being true simply stops appearing.
 * · Never about how anyone is playing — only about what the company does not
 *   have yet.
 *
 * Pure, and in lib/engine so `scripts/simulate.mjs` could assert on it without
 * a browser. It reads state and answers a question; it changes nothing.
 */

export interface Nudge {
  id: "no-product" | "no-team" | "room-for-product" | "team-caps-products";
  /** The tab this opens. Matches ActivityTab ids in components/ActivityBar. */
  tab: "product" | "team";
  title: string;
  body: string;
  /** The label on the button that opens the tab. */
  action: string;
}

/**
 * The one thing most worth doing right now, or null when nothing is missing.
 *
 * Order is deliberate and it is the order the company actually breaks in: you
 * cannot earn without something to sell, you cannot scale what you sell
 * without people, and only then is "you have room for another" worth saying.
 */
export function nextStep(state: RunState): Nudge | null {
  if (!state.alive) return null;

  const spec = specForRun(state);
  const noun = spec.noun.toLowerCase();
  const nounPlural = spec.nounPlural.toLowerCase();
  const live = liveItems(ensurePortfolio(state));
  const cap = portfolioCap(state);
  const staff = state.stats.employees;

  /*
   * Nothing on the shelf. The most expensive gap in the game: revenue, margin
   * and the pitch itself all start from having something to sell, so this
   * outranks everything and says why rather than just pointing.
   */
  if (live.length === 0) {
    return {
      id: "no-product",
      tab: "product",
      title: `You have no ${nounPlural} yet.`,
      body: `Nothing is being sold, so nothing is coming in. Open PRODUCT and add one — name it, price it, choose how well to make it.`,
      action: "ADD YOUR FIRST",
    };
  }

  /*
   * Something to sell and nobody to sell it. Deliberately second: a founder
   * alone with one product is a real company, a founder alone with a company
   * that already has customers is a bottleneck.
   */
  if (staff === 0) {
    return {
      id: "no-team",
      tab: "team",
      title: "You are still doing all of it yourself.",
      body: "One person is a ceiling on how much you can make and sell. Open TEAM and hire someone — it costs monthly payroll and it buys you the room to grow.",
      action: "SEE WHO'S AVAILABLE",
    };
  }

  /*
   * The team has raised the ceiling and nobody has used it. Only worth saying
   * once there is more than one slot free, so a player who is deliberately
   * running one careful product is not pestered about a spare slot.
   */
  if (live.length < cap - 1) {
    return {
      id: "room-for-product",
      tab: "product",
      title: `Your team can carry ${cap} ${nounPlural}.`,
      body: `You have ${live.length}. Another ${noun} is the most direct way to grow revenue — and the fastest way to find out which one of yours is actually carrying the company.`,
      action: "ADD ANOTHER",
    };
  }

  /*
   * The mirror of the one above, and the reason both exist: the cap is a
   * function of the team, so "full" is not a wall, it is a hiring decision.
   * A player who does not know that reads a disabled button as the end.
   */
  if (live.length >= cap && staff > 0) {
    return {
      id: "team-caps-products",
      tab: "team",
      title: `${cap} is all your team can carry well.`,
      body: `You are at the limit, and the limit moves when the team does. Hiring is what raises it — the cap is a people problem, not a product one.`,
      action: "OPEN TEAM",
    };
  }

  return null;
}
