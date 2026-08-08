"use client";

import { useMemo } from "react";
import { useNativeChrome, useNativeChromeOwned } from "@/lib/native/chrome";
import { useResolvedTheme } from "@/lib/native/theme";
import type {
  NativeChromeState,
  NativeControl,
  NativeNudge,
  NativeTab,
} from "@/lib/native/glass";
import type { ActivityTab } from "@/components/ActivityBar";
import { monthBadge, monthBadgeLabel } from "@/lib/engine/format";

/**
 * The play screen's chrome, described for UIKit.
 *
 * Same six tabs, same button, same three masthead controls as the DOM version
 * — this is the identical information handed to a different renderer, not a
 * second design. The SF Symbols were chosen to mean what the hand-drawn
 * glyphs in ActivityBar.tsx mean; where a symbol name is missing on an older
 * OS, the native side falls back rather than drawing an empty circle.
 */

export const NATIVE_TABS: NativeTab[] = [
  { id: "company", title: "Company", symbol: "building.2" },
  { id: "team", title: "Team", symbol: "person.2" },
  { id: "product", title: "Product", symbol: "square.stack" },
  { id: "assets", title: "Assets", symbol: "briefcase" },
  { id: "market", title: "Market", symbol: "chart.line.uptrend.xyaxis" },
  { id: "closet", title: "Closet", symbol: "tshirt" },
];

/** Ids the masthead cluster can send back. Kept next to the tabs so the two
 *  vocabularies the native side knows about live in one file. */
export type NativeControlId = "pro" | "dossier" | "settings" | "board" | "phone" | "keyterms";

export interface PlayChromeOptions {
  /**
   * False whenever anything at all is drawn over the play screen.
   *
   * Native views composite above the webview, always — so a tab bar left
   * visible under a web sheet is a tab bar sitting on top of that sheet. There
   * is no z-index on the web side that can win that argument, which is why
   * this is a single flag rather than a set of per-surface exceptions.
   */
  visible: boolean;
  /**
   * The surface the guided first play is teaching, or null when it is not
   * running. `"advance"`, `"tabs"`, a control id — or `""` for a step that
   * teaches something in the web layer, which still dims the chrome but lights
   * nothing.
   *
   * Distinct from `visible` on purpose: the chrome stays on screen throughout
   * the tutorial. It used to withdraw entirely, which meant a new player's
   * whole first session — the app's first impression — had no Liquid Glass in
   * it anywhere.
   */
  coach: string | null;
  month: number;
  /** Fiscal year, for the badge's "→ FY2" at the gate. */
  year: number;
  atGate: boolean;
  /** The advance button is dead while a card is open or the company is gone. */
  canAdvance: boolean;
  pro: boolean;
  activeTab: ActivityTab | null;
  /**
   * The one thing worth doing, or null.
   *
   * The page computes it and holds the dismissal, because both renderers of
   * this card have to agree about which one is up: the DOM card would
   * otherwise keep its own `dismissed` list and a player who closed the native
   * one would find the web one still open the next time the chrome handed
   * back — which is every time the plugin is missing or the OS is too old.
   */
  nudge: NativeNudge | null;
  onTab: (tab: ActivityTab) => void;
  onAdvance: () => void;
  onOpenGate: () => void;
  onControl: (id: NativeControlId) => void;
  /** The card was tapped. The page knows which tab its id opens. */
  onNudgeAction: (id: string) => void;
  onNudgeDismiss: (id: string) => void;
}

/** True when UIKit is drawing the chrome, so the DOM must not. */
export function usePlayChrome(options: PlayChromeOptions): boolean {
  const owned = useNativeChromeOwned();
  const theme = useResolvedTheme();

  const { visible, coach, month, year, atGate, canAdvance, pro, activeTab, nudge } = options;

  const state = useMemo<NativeChromeState | null>(() => {
    if (!owned) return null;

    const controls: NativeControl[] = [
      {
        id: "pro",
        text: pro ? "PRO" : "FREE",
        label: pro ? "Pro account" : "Free account — see Pro",
        style: pro ? "prestige" : "plain",
        leading: true,
      },
      // The key terms page — every word the game uses, and the Rookie switch.
      // First of the consultables, same position as the DOM row's book. A
      // book rather than info.circle: the dossier already reads as an ⓘ, and
      // two of those in one cluster is a coin flip.
      { id: "keyterms", symbol: "book", label: "Key terms — every word explained" },
      { id: "dossier", symbol: "doc.text.magnifyingglass", label: "Company dossier" },
      /*
       * Still Standing gets a real Liquid Glass control, the same as everything
       * else in this cluster.
       *
       * `trophy` rather than `list.number` or `chart.bar`: the board is two
       * rankings, and a list glyph reads as a menu. It is `plain`, not
       * `prestige` — gold in this app means the year gate and earned status,
       * and a button that merely OPENS a board has earned nothing. Making it
       * gold would also be the first place a player looks for the suggestion
       * that rank is something you can be given.
       */
      { id: "board", symbol: "trophy", label: "Still Standing — the global boards" },
      { id: "settings", symbol: "gearshape", label: "Settings" },
      { id: "phone", symbol: "iphone", label: "Open your phone" },
    ];

    return {
      // Hidden wins over coach: a sheet open over the tutorial is still a
      // sheet, and native chrome left visible under it sits on top of it.
      mode: !visible ? "hidden" : coach !== null ? "coach" : "full",
      coach: coach || null,
      theme,
      tabs: NATIVE_TABS,
      activeTab,
      cta: {
        title: atGate ? "CLOSE THE YEAR" : "ADVANCE MONTH",
        badge: monthBadge(month, year, atGate),
        badgeLabel: monthBadgeLabel(month, year, atGate),
        style: atGate ? "prestige" : "action",
        enabled: canAdvance,
        locked: atGate,
      },
      controls,
      /*
       * Not gated on `visible`, and it does not need to be. The mode already
       * carries that: "hidden" takes every surface this controller draws off
       * screen together, and the nudge is one of them. Dropping the card from
       * the state instead would make it a NEW nudge on the way back — same id,
       * but the controller would have forgotten it — and it would play its
       * entrance again every time a sheet closed.
       */
      nudge,
    };
  }, [owned, visible, coach, theme, month, year, atGate, canAdvance, pro, activeTab, nudge]);

  useNativeChrome(state, {
    onTab: (id) => options.onTab(id as ActivityTab),
    onPrimary: () => (atGate ? options.onOpenGate() : options.onAdvance()),
    onControl: (id) => options.onControl(id as NativeControlId),
    onNudgeAction: (id) => options.onNudgeAction(id),
    onNudgeDismiss: (id) => options.onNudgeDismiss(id),
  });

  return owned;
}
