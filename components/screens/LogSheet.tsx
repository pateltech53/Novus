"use client";

import type { RunState } from "@/lib/engine/types";
import { LifeLog } from "@/components/LifeLog";
import { ScreenSheet } from "@/components/screens/ScreenSheet";

/**
 * The life log, compressed off the phone's play screen.
 *
 * On a phone the log used to be the whole lower half of one scrolling
 * document, which made the screen read as a wall of prose before the numbers
 * that actually run the company. The phone now gets one glass row, and the
 * full feed lives in a sheet.
 *
 * Desktop is untouched: the right rail keeps the inline log, because at that
 * width the log was never crowding anything out.
 */

/**
 * The one row that stands in for the whole feed.
 *
 * Everything on it is bounded — the label, "M12 · FY99" at its widest, a
 * chevron — because a button's text is never allowed to clip (§7, and the
 * phone audit enforces it). A live preview of the latest line was here first,
 * truncated, and a truncated line on a control is exactly the clipped text
 * the rule exists to keep out.
 *
 * Solid, deliberately — `nv-card`, not the glass control material. On iOS
 * this row sits directly above the native deck, which is the system's own
 * Liquid Glass; a CSS impression of that material one row away is exactly
 * the comparison design.md §0 says an approximation cannot win. The owner
 * said the same thing in fewer words. Real glass is the chrome's; this row
 * is content, and content sits on solid ground.
 */
export function LogButton({
  month,
  year,
  onOpen,
}: {
  month: number;
  year: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open the story so far — every month on record, up to month ${month} of fiscal year ${year}`}
      className="nv-card flex h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-row)] px-4 text-left nv-press-row"
    >
      <span className="text-2xs font-bold tracking-[0.12em] text-[var(--text)]">
        THE STORY SO FAR
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
          M{month} · FY{year}
        </span>
        <span aria-hidden="true" className="text-[var(--text-tertiary)]">
          ›
        </span>
      </span>
    </button>
  );
}

/**
 * The full feed, in the shell every other screen opens into — glass scrim,
 * pinned glass header, and on iOS the way out is UIKit's own Liquid Glass
 * circle rather than the DOM chip.
 */
export function LogSheet({
  run,
  onClose,
}: {
  run: RunState;
  onClose: () => void;
}) {
  return (
    <ScreenSheet
      label="The story so far — the company log"
      closeLabel="Close the story"
      onClose={onClose}
      eyebrow={`MONTH ${run.month} · FISCAL YEAR ${run.year}`}
      title="The Story So Far"
    >
      {/* Opens at the end: the sheet answers "what just happened", and the
          beginning is one scroll up rather than twelve scrolls down. */}
      <LifeLog lines={run.log} startAtEnd />
    </ScreenSheet>
  );
}
