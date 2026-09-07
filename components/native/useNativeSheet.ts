"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NovusGlass, type NativeSheetSpec } from "@/lib/native/glass";
import { useNativeChromeOwned } from "@/lib/native/chrome";
import { useResolvedTheme } from "@/lib/native/theme";
import { HOW_TO_READ, categoryLabel, marketDatelineDetail } from "@/components/DecisionSheet";
import { GLOSSARY } from "@/lib/engine/constants";
import type { Choice, GameEvent, Industry } from "@/lib/engine/types";

/**
 * The month's decision, presented by UIKit.
 *
 * Same content as components/DecisionSheet.tsx — the same category table, the
 * same reskin, the same Rookie Mode glossary lines — handed to a different
 * renderer. It is native for one reason the DOM cannot supply: the scrim.
 * design.md allows modal scrims to be glass, and a `backdrop-filter` inside
 * the webview can only blur other web content, never the game the sheet is
 * covering. Presented natively, the board actually frosts over behind it.
 *
 * Everything else is what comes with being there: real sheet physics, real
 * scroll deceleration, pull-to-dismiss, and the grabber and scroll-edge header
 * that the same design law already sanctions as glass.
 */

export interface NativeSheetOptions {
  event: GameEvent | null;
  choices: Choice[];
  industry: Industry;
  rookieMode: boolean;
  isMarket?: boolean;
  explain?: boolean;
  onChoose: (index: number) => void;
  onDismiss: () => void;
}

function build(options: NativeSheetOptions, theme: "light" | "dark"): NativeSheetSpec | null {
  const { event, choices, industry, rookieMode, isMarket, explain } = options;
  if (!event) return null;

  const notes =
    rookieMode && event.rookieTerms?.length
      ? event.rookieTerms
          .map((term) => {
            const gloss = GLOSSARY[term.toLowerCase()];
            return gloss ? { term, text: gloss.rookie } : null;
          })
          .filter((n): n is { term: string; text: string } => n !== null)
      : [];

  return {
    id: event.id,
    eyebrow: isMarket ? "TODAY'S MARKET" : categoryLabel(event.category),
    eyebrowStyle: isMarket ? "market" : "plain",
    eyebrowDetail: isMarket ? marketDatelineDetail() : undefined,
    title: event.title,
    body: event.reskins?.[industry] ?? event.text,
    notes,
    hintTitle: explain ? HOW_TO_READ.title : undefined,
    hintText: explain ? HOW_TO_READ.text : undefined,
    choices: choices.map((choice) => ({
      label: choice.label,
      cost: choice.known || undefined,
      camera: !!choice.perform,
    })),
    /*
     * An event with no choices is the camera gate. The web sheet's button
     * calls onDismiss, which upstream opens the camera rather than closing
     * anything — so the native action maps to the same handler and the
     * asymmetry stays in one place instead of two.
     */
    actionLabel: choices.length === 0 && event.performOnly ? "OPEN THE CAMERA" : undefined,
    actionCamera: true,
    dismissible: choices.length > 0 || !event.performOnly,
    theme,
  };
}

/**
 * How long the web waits for UIKit to say the card is on screen.
 *
 * Not a latency target: a sheet that is coming confirms itself in a frame or
 * two. This is the line past which "still arriving" and "never arriving" stop
 * being worth telling apart, set well clear of a cold first present on a slow
 * device — the cost of being wrong is a card drawn in the DOM instead of in
 * glass, and the cost of not having it is a month nobody can answer.
 */
const PRESENT_TIMEOUT_MS = 1200;

/**
 * The shortest panel that could be a card, in points.
 *
 * A sheet reports its own height when it appears, and anything under this is
 * not a card the player can read — it is the backdrop with nothing in it,
 * which is a screen that looks blank and answers only the dismiss tap. Set far
 * below the smallest real card (eyebrow, title, a line of body and two
 * choices) so it only ever catches a collapse, never a short question.
 *
 * A binary that predates the measurement sends no height at all. That is
 * treated as unknown and accepted — the watchdog above is what covers those.
 *
 * ── It has to clear the NATIVE floor, or it is unreachable ──────────────────
 *
 * `GlassSheetController.buildPanel` activates a required
 * `heightAnchor >= Metric.minHeight`, and `minHeight` is 160. So a panel that
 * collapses does not settle at 0 any more, it settles at 160 — and 160 is not
 * below 80, so this check could never fire on the failure it was written for.
 * What the player would get is a frosted backdrop with an empty 160pt card on
 * it, accepted as presented, with the watchdog already disarmed and only the
 * backdrop's dismiss tap answering a finger.
 *
 * 200 is above that floor and still far under the shortest real card (an
 * eyebrow, a title, a line of body and two choices is well past 300), so it
 * catches a collapse and never a short question. Coupled to
 * `Metric.minHeight` by hand: raise that and raise this.
 */
const MIN_PANEL_PX = 200;

/** True when UIKit is presenting the card, so React must not. */
export function useNativeSheet(options: NativeSheetOptions): boolean {
  const owned = useNativeChromeOwned();
  const theme = useResolvedTheme();

  /**
   * The native renderer did not put a card on screen, so the DOM one takes
   * over — for good, on this screen.
   *
   * ── Why this is not paranoia ────────────────────────────────────────────
   *
   * "The card did not appear" has no visible form for a player. The play
   * chrome withdraws whenever a decision is open, and the DOM sheet is not
   * rendered behind a native one — so a presentation that does not happen is a
   * month with a decision in it, nothing on screen to answer it with, and no
   * chrome to do anything else with either. The screen is the background
   * colour and one disabled button. The game is over and nothing looks broken.
   *
   * And it can happen quietly. `presentSheet` resolving means the bridge took
   * the call, nothing more; UIKit refuses to present onto a controller that is
   * already presenting and it refuses without a throw, a completion or an
   * error. So resolution is not evidence. Only `sheetPresented` is, because
   * the controller sends it from its own `viewDidAppear`.
   *
   * Sticky, because a renderer that has dropped one card is not the one to
   * hand the next one to — and because flipping back and forth mid-run would
   * change what a decision looks like between one month and the next.
   */
  const [refused, setRefused] = useState(false);

  /*
   * ── An ANSWER re-arms the presentation, not only a change of id ───────────
   *
   * The presentation effect keyed on the card's id alone. Two consecutive
   * cards carrying the SAME id therefore looked like no change at all: the
   * answer handler cleared `presented.current`, `id` never moved, the effect
   * did not re-run, and nothing was ever presented for the second card.
   *
   * The board then went silent. `overlay` is true while `current` is non-null
   * so the native chrome is in `hidden` mode; `nativeSheetOwned` is true so
   * the DOM sheet is not rendered either; and the native sheet has already
   * dismissed itself. The player is left with the background colour and one
   * disabled button, on a month that has a decision in it.
   *
   * It is reachable: `advanceMonth` surfaces up to two cards per tap, Today's
   * Market is picked from a pool that overlaps the month's draw
   * (lib/engine/events.ts — `todaysMarket` and `drawMonthEvents` do not know
   * about each other), so a turn can legitimately deal the same event twice.
   * The engine is protected and the cards it deals are the leaderboard's
   * business, so the fix belongs here: a counter the answer handlers bump,
   * which makes "the player resolved something" a dependency in its own
   * right.
   */
  const [answered, setAnswered] = useState(0);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** The id currently on screen, so a re-render does not re-present it. */
  const presented = useRef<string | null>(null);
  /** The id UIKit has confirmed is actually visible. */
  const confirmed = useRef<string | null>(null);
  const watchdog = useRef<number | null>(null);

  const clearWatchdog = () => {
    if (watchdog.current !== null) {
      window.clearTimeout(watchdog.current);
      watchdog.current = null;
    }
  };

  /**
   * Hand the card back to React, whatever went wrong over there.
   *
   * Takes down anything half-presented first. A native backdrop left frosting
   * the webview composites ABOVE it, so leaving one up would put the same
   * blank screen on top of the sheet React is about to draw.
   */
  const fallBackToDom = useCallback(() => {
    if (watchdog.current !== null) {
      window.clearTimeout(watchdog.current);
      watchdog.current = null;
    }
    presented.current = null;
    confirmed.current = null;
    NovusGlass.dismissSheet().catch(() => {});
    setRefused(true);
  }, []);

  useEffect(() => {
    if (!owned) return;
    let cancelled = false;
    const subs: Array<{ remove: () => void }> = [];

    const add = async <T,>(event: string, fn: (data: T) => void) => {
      const handle = await (
        NovusGlass.addListener as unknown as (
          e: string,
          f: (data: T) => void,
        ) => Promise<{ remove: () => void }>
      )(event, fn);
      if (cancelled) handle.remove();
      else subs.push(handle);
    };

    /*
     * Every answer carries the id it was answering. A tap that lands while the
     * engine has already moved on — a year closing underneath the sheet, a
     * second card queued — resolves the card that is open now instead of the
     * one the player was looking at, unless it is checked here.
     */
    const answering = (id: string) => presented.current === id;

    void (async () => {
      await add<{ id: string; height?: number }>("sheetPresented", (d) => {
        if (presented.current !== d.id) return;
        // A panel too short to be a card is the backdrop and nothing else: a
        // screen that looks blank and answers only the dismiss tap. Treat it
        // as a card that never arrived, because to the player it is one.
        if (typeof d.height === "number" && d.height < MIN_PANEL_PX) {
          fallBackToDom();
          return;
        }
        confirmed.current = d.id;
        clearWatchdog();
      });
      await add<{ id: string; index: number }>("sheetChoice", (d) => {
        if (!answering(d.id)) return;
        presented.current = null;
        setAnswered((n) => n + 1);
        optionsRef.current.onChoose(d.index);
      });
      await add<{ id: string }>("sheetAction", (d) => {
        if (!answering(d.id)) return;
        presented.current = null;
        setAnswered((n) => n + 1);
        optionsRef.current.onDismiss();
      });
      await add<{ id: string }>("sheetDismissed", (d) => {
        if (!answering(d.id)) return;
        presented.current = null;
        setAnswered((n) => n + 1);
        optionsRef.current.onDismiss();
      });
    })().catch(() => {
      /* No bridge. The DOM sheet is already what is on screen. */
    });

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, [owned, fallBackToDom]);

  const live = owned && !refused;
  const spec = live ? build(options, theme) : null;
  const id = spec?.id ?? null;

  useEffect(() => {
    if (!live) return;

    if (!id) {
      clearWatchdog();
      if (presented.current !== null) {
        presented.current = null;
        confirmed.current = null;
        NovusGlass.dismissSheet().catch(() => {});
      }
      return;
    }

    if (presented.current === id) return;
    presented.current = id;
    confirmed.current = null;
    const current = build(optionsRef.current, theme);
    if (!current) return;

    NovusGlass.presentSheet(current).catch(fallBackToDom);

    /*
     * Armed on every card, disarmed by `sheetPresented`.
     *
     * The budget is deliberately loose. A sheet that is genuinely coming
     * announces itself in a frame or two — this is not a latency target, it is
     * the line past which "still arriving" and "never arriving" stop being
     * worth telling apart, and the cost of guessing wrong is one card drawn in
     * the DOM instead of UIKit.
     *
     * It is also what makes an older native binary safe. Nothing before this
     * change sends `sheetPresented`, so an app whose web layer updated ahead of
     * its shell simply falls through to the DOM sheet after the timeout rather
     * than showing a month nobody can answer.
     */
    clearWatchdog();
    watchdog.current = window.setTimeout(fallBackToDom, PRESENT_TIMEOUT_MS);
    // The identity of the card, plus the fact that one was answered — see the
    // note on `answered` above for the month this otherwise loses. Rebuilding
    // the spec on every render would re-present the same sheet and cut its own
    // entrance short, which is why the whole spec is still not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, id, theme, answered]);

  // Leaving the screen with a card up must not leave the card up.
  useEffect(() => {
    if (!owned) return;
    return () => {
      clearWatchdog();
      presented.current = null;
      confirmed.current = null;
      NovusGlass.dismissSheet().catch(() => {});
    };
  }, [owned]);

  return live;
}
