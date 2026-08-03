"use client";

import type { RunState } from "@/lib/engine/types";
import { LifeLog } from "@/components/LifeLog";
import { ScreenSheet } from "@/components/screens/ScreenSheet";

/**
 * The life log, compressed off the play screen — every width.
 *
 * The log used to be the rest of whichever column held it: the whole lower
 * half of one scrolling document on a phone, the reading length of the
 * desktop rail. Either way the screen read as a wall of prose before the
 * numbers that actually run the company. Both compositions now get the same
 * glass row, and the full feed lives in this sheet. The phone shipped it
 * first; the desk followed once the phone read was approved.
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
 * `nv-flat` for the same reason the log's own raised rows are: it sits over
 * the page's one flat fill, where a backdrop pass would resolve to the colour
 * it started as. The material's tint, crest and press without the blur.
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
      className="nv-gc nv-flat flex h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-row)] px-4 text-left"
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
