import type { Industry } from "@/lib/engine/types";
import { sellsToBusinesses } from "@/lib/engine/constants";

/**
 * WHO GETS WHICH APP — the phone's access rules, as data.
 *
 * ── Why this is not just an `if` inside Phone.tsx ───────────────────────────
 *
 * It was, in three places: the home-screen grid filtered the tile list, the
 * screen router refused to render two screens, and the deep-link effect
 * swallowed two app names. Three copies of one rule, in one file, all of them
 * correct — and none of them checkable, because `Phone.tsx` is a client
 * component with framer-motion and a live game context in it, and a headless
 * test cannot import it to ask a question.
 *
 * That matters here more than it usually would. The rule was reported as a
 * requirement twice, in opposite directions:
 *
 *   · A fast-food founder must NOT have The Room or The Index. There is nobody
 *     in a trade index for a restaurant to ring; a padlock over it would
 *     advertise — and price — a mechanic they should never want.
 *
 *   · A fast-food founder must STILL HAVE A PHONE. BeeMail, RobinGhood and
 *     LinkedOut are not about selling to businesses and never were, and taking
 *     the whole device away to remove two apps from it would be a much bigger
 *     answer than the question.
 *
 * Both halves fail silently in opposite ways — the first shows a mechanic that
 * makes no sense, the second removes three that do — and neither would produce
 * an error. So the rule lives here as a pure function with no React in it, and
 * `scripts/room-test.mjs` asserts both halves against the real industry table.
 */

/**
 * The two apps that only exist because a business sells to other businesses.
 *
 * `index` is the trade directory — who buys what you sell, and their direct
 * line. `coldcall` is The Room, which is where the number gets dialled. They
 * stand or fall together: a book with no phone is a list, and a phone with no
 * book is the contacts app the whole mechanic was rebuilt to stop being.
 */
export const ROOM_APPS = ["coldcall", "index"] as const;

export type RoomApp = (typeof ROOM_APPS)[number];

const isRoomApp = (id: string): id is RoomApp =>
  (ROOM_APPS as readonly string[]).includes(id);

/**
 * Does this company have a phone at all? Always.
 *
 * A constant rather than an omission, so the answer is written down somewhere
 * a test can read it. The requirement — "food companies should still have a
 * phone in general" — is a real product decision and not an accident of nobody
 * having got round to gating the button, and the difference between those two
 * only shows up the day somebody decides to tidy up.
 */
export const hasPhone = (_industry: Industry): boolean => true;

/**
 * Does this company have The Room and The Index?
 *
 * One question, asked of the industry table, which records the reasoning
 * per-row beside the flag. FOOD, ECOM and FITNESS sell to people who walk in;
 * the other nine sell to somebody with a purchase order.
 */
export const hasRoom = (industry: Industry): boolean => sellsToBusinesses(industry);

/**
 * The apps this company's phone actually carries, given the full list.
 *
 * Generic over the caller's own app shape so `Phone.tsx` can pass its tile
 * objects straight through and keep the glyphs, and a test can pass bare ids.
 */
export function phoneAppsFor<T extends { id: string }>(
  industry: Industry,
  all: readonly T[],
): T[] {
  return all.filter((app) => !isRoomApp(app.id) || hasRoom(industry));
}

/** May this company open this app? The router's question, and the deep link's. */
export const canOpenApp = (industry: Industry, app: string): boolean =>
  !isRoomApp(app) || hasRoom(industry);
