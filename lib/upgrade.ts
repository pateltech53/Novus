import type { ProFeature } from "@/lib/monetization";

/**
 * Where free stops, named once.
 *
 * Six places in the app refuse a free player, and each one used to write its
 * own sentence about why — a locked industry said "This industry requires
 * Pro.", a locked asset said something longer, The Room said something longer
 * still, and the wardrobe said nothing at all. That is how a product ends up
 * telling a fourteen-year-old three different stories about the same limit, and
 * how a paywall ends up promising something the gate never withheld.
 *
 * A gate is the refusal, stated once. The notification prints `title` and
 * `body`; the upgrade screen reads `feature` to lead with the row the player
 * actually hit rather than the top of a generic list. Both surfaces therefore
 * quote the same limit, and the copy is edited here or nowhere.
 *
 * ── The voice, because it is the easy thing to lose at a paywall ────────────
 *
 * Every line below states a fact about the product. None states a fact about
 * the player. "The Room is Pro" — never "unlock your potential", never a
 * countdown, never a price that expires in ten minutes. The app is used by
 * minors and sold to schools; a gate that manipulates is a gate a teacher has
 * to apologise for.
 *
 * Brand Law 4 survives the gate too. Every line that could be misread as an
 * advantage says out loud that it is not one — Pro opens rooms and adds things
 * to own, and it never moves a score, a survival or a rank. That sentence costs
 * six words at the exact moment someone is deciding to pay, which is the only
 * moment it is worth anything.
 */

export type GateId =
  | "the_room"
  | "industries"
  | "run_slots"
  | "islands"
  | "talent_pool"
  | "assets"
  | "wardrobe"
  | "year_pace";

export interface Gate {
  id: GateId;
  /** What just got refused. Present tense, no exclamation, no second person. */
  title: string;
  /** One line: what Pro opens, and where it stops. */
  body: string;
  /**
   * The PRO_FEATURES row the upgrade screen leads with. Null where the gate has
   * no matching row — the screen then opens on its general argument rather than
   * spotlighting something that only nearly matches.
   */
  feature: ProFeature["id"] | null;
}

export const GATES: Record<GateId, Gate> = {
  the_room: {
    id: "the_room",
    title: "The Room is Pro",
    body: "Cold call angels, operators and buyers — three a day. Pro opens the door. It never makes anyone say yes.",
    feature: "the_room",
  },
  industries: {
    id: "industries",
    title: "Eight of the twelve industries are Pro",
    body: "Four are free and always will be. The other eight each have their own way to fail.",
    feature: "industries",
  },
  run_slots: {
    id: "run_slots",
    title: "One company a day on free",
    body: "Pro founds three, and a company that went under can be replaced the same day.",
    feature: "run_slots",
  },
  /*
   * The other half of the split 0013 made. `run_slots` is the RATE — how often
   * a new company may be founded. This is the STOCK — how many may exist at
   * once. A player hits them at different moments and for different reasons,
   * so they are two gates and not one: telling someone with two full islands
   * to "come back tomorrow" would be false, and telling someone out of
   * foundings to "bury a company" would be worse.
   */
  islands: {
    id: "islands",
    title: "Two islands on free",
    body: "Pro runs ten companies at once. Bury one to found another, or keep both and come back to whichever you like.",
    feature: "islands",
  },
  talent_pool: {
    id: "talent_pool",
    title: "This candidate is in the Pro pool",
    body: "Pro widens the list on LinkedOut. The same people can still turn you down.",
    feature: null,
  },
  assets: {
    id: "assets",
    title: "This asset is Pro",
    body: "Art and islands on top of property and equipment. More to own — never a better number.",
    feature: null,
  },
  wardrobe: {
    id: "wardrobe",
    title: "The wardrobe track is Pro",
    body: "Six fits, earned by finishing runs. Changes nothing but you.",
    feature: "cosmetics",
  },
  year_pace: {
    id: "year_pace",
    title: "One fiscal year a day on free",
    body: "The books reopen tomorrow. Pro closes as many years as you can pitch — it never moves a score.",
    feature: null,
  },
};

export const gateFor = (id: GateId): Gate => GATES[id];
