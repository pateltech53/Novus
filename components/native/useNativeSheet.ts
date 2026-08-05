"use client";

import { useEffect, useRef, useState } from "react";
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

/** True when UIKit is presenting the card, so React must not. */
export function useNativeSheet(options: NativeSheetOptions): boolean {
  const owned = useNativeChromeOwned();
  const theme = useResolvedTheme();

  /**
   * The native sheet turned a card down, so the DOM one takes over.
   *
   * There is no such thing as "the card did not appear" for a player: the play
   * chrome withdraws while a decision is open and the DOM sheet is not
   * rendered behind a native one, so a presentation that silently fails is a
   * month with a decision in it, nothing on screen to answer it with, and no
   * chrome to do anything else either. The game is simply over, on a screen
   * that looks fine.
   *
   * `presentSheet` rejects rather than failing quietly now (see
   * NovusGlassPlugin), and this is what that rejection buys: the same card in
   * the same words, one material down. Sticky for the rest of this screen's
   * life — a renderer that has refused one card is not the one to trust with
   * the next.
   */
  const [refused, setRefused] = useState(false);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  /** The id currently on screen, so a re-render does not re-present it. */
  const presented = useRef<string | null>(null);

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
      await add<{ id: string; index: number }>("sheetChoice", (d) => {
        if (!answering(d.id)) return;
        presented.current = null;
        optionsRef.current.onChoose(d.index);
      });
      await add<{ id: string }>("sheetAction", (d) => {
        if (!answering(d.id)) return;
        presented.current = null;
        optionsRef.current.onDismiss();
      });
      await add<{ id: string }>("sheetDismissed", (d) => {
        if (!answering(d.id)) return;
        presented.current = null;
        optionsRef.current.onDismiss();
      });
    })().catch(() => {
      /* No bridge. The DOM sheet is already what is on screen. */
    });

    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, [owned]);

  const live = owned && !refused;
  const spec = live ? build(options, theme) : null;
  const id = spec?.id ?? null;

  useEffect(() => {
    if (!live) return;

    if (!id) {
      if (presented.current !== null) {
        presented.current = null;
        NovusGlass.dismissSheet().catch(() => {});
      }
      return;
    }

    if (presented.current === id) return;
    presented.current = id;
    const current = build(optionsRef.current, theme);
    if (current)
      NovusGlass.presentSheet(current).catch(() => {
        // UIKit would not put it on screen. Hand the card back to the DOM
        // rather than leave the player looking at a month they cannot answer.
        presented.current = null;
        setRefused(true);
      });
    // Only the identity of the card matters here. Rebuilding the spec on every
    // render would re-present the same sheet and cut its own entrance short.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, id, theme]);

  // Leaving the screen with a card up must not leave the card up.
  useEffect(() => {
    if (!owned) return;
    return () => {
      presented.current = null;
      NovusGlass.dismissSheet().catch(() => {});
    };
  }, [owned]);

  return live;
}
