"use client";

import { createPortal } from "react-dom";
import type { RunState } from "@/lib/engine/types";
import { FounderAvatar } from "@/components/FounderAvatar";
import { StatRings } from "@/components/StatRings";
import { CompanyDossier, DossierGlyph } from "@/components/CompanyDossier";
import { fmtMoney } from "@/lib/engine/format";
import { STAGE_NAME } from "@/lib/engine/constants";

/**
 * The masthead: mascot up top, identity under it, three rings.
 * This is the prototype's home layout — with the live GLB standing in for the
 * chroma-keyed video, so the edges are genuinely clean at any size.
 */
function PhoneGlyph() {
  return (
    <svg width="15" height="19" viewBox="0 0 16 20" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="14" height="18" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 3.6h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

/**
 * A trophy, not a list.
 *
 * The board is two rankings, and a list glyph reads as a menu. Line art at the
 * same weight as the gear and the phone beside it, because these three are one
 * cluster of things you consult rather than three separate decisions.
 */
function BoardGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M5 2.6h8v3.9a4 4 0 0 1-8 0V2.6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M5 4.2H3.2v1.1A2.6 2.6 0 0 0 5 7.8M13 4.2h1.8v1.1a2.6 2.6 0 0 1-1.8 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M9 10.4v2.4M6.4 15.4h5.2M7.4 15.4c0-1.4.7-2.6 1.6-2.6s1.6 1.2 1.6 2.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9 1.8v1.6M9 14.6v1.6M16.2 9h-1.6M3.4 9H1.8M14.1 3.9l-1.1 1.1M5 13l-1.1 1.1M14.1 14.1 13 13M5 5 3.9 3.9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HomeStage({
  run,
  founderName,
  onOpenPhone,
  onOpenPro,
  onOpenSettings,
  onOpenBoard,
  dossierOpen,
  onDossier,
  nativeControls = false,
}: {
  run: RunState;
  founderName: string;
  onOpenPhone: () => void;
  onOpenPro: () => void;
  onOpenSettings: () => void;
  /** Still Standing. A UIKit glass button on iOS; this one everywhere else. */
  onOpenBoard: () => void;
  /*
   * The dossier used to own its own open state. It is lifted now because the
   * app's masthead controls are UIKit views on iOS, and a native button
   * cannot reach into this component's `useState` — the page has to hold the
   * one piece of state both renderers drive.
   */
  dossierOpen: boolean;
  onDossier: (open: boolean) => void;
  /**
   * True when the four controls in this row are real Liquid Glass views
   * floating over this section instead of DOM buttons.
   *
   * The row is not rendered at all in that case rather than hidden: a
   * `display:none` button takes no taps, but an `opacity:0` one does, and the
   * difference between those two mistakes is a masthead that silently eats
   * every touch aimed at the mascot behind it. What replaces it is the exact
   * height UIKit measured for its own cluster, so nothing under it moves.
   */
  nativeControls?: boolean;
}) {
  return (
    <section
      className="nv-masthead nv-stage relative overflow-hidden rounded-b-[1.75rem] px-5 pb-5"
      style={{
        paddingTop: nativeControls
          ? "max(var(--nv-chrome-top, 0px), env(safe-area-inset-top), 0.5rem)"
          : "max(0.5rem, env(safe-area-inset-top))",
      }}
    >
      {/* The orange bloom that used to sit here is gone. It spent the screen's
          one accent on decoration — leaving the ADVANCE MONTH button, the thing
          that actually asks you to act, competing with a glow for attention.
          The mascot's separation now comes from the stage vignette in
          .nv-stage and from its real rim light in the 3D scene, which is where
          depth is supposed to come from. */}

      {/* Phone lives in the masthead: it is a device you own, not a menu item. */}
      {!nativeControls && (
      <div className="relative flex items-start justify-between">
        <button
          type="button"
          onClick={onOpenPro}
          // The same 36px as the three controls opposite it. It was 26px,
          // which both missed a thumb and sat visibly short of the row it
          // shares a line with.
          className={`nv-gc flex h-9 items-center rounded-full px-3.5 text-2xs font-bold tracking-[0.12em] transition-colors ${
            run.pro
              ? "nv-t-prestige"
              : "text-[var(--n-8)]"
          }`}
        >
          {run.pro ? "PRO" : "FREE"}
        </button>
        <div className="flex items-center gap-2">
        {/* The whole company, on one scroll. Sits with the gear and the phone
            because it is a thing you consult, not a move you make. */}
        <button
          type="button"
          data-opens
          onClick={() => onDossier(true)}
          aria-label="Company dossier"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[0.7rem] text-[var(--n-10)]"
        >
          <DossierGlyph />
        </button>
        <button
          type="button"
          onClick={onOpenBoard}
          aria-label="Still Standing — the global boards"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[0.7rem] text-[var(--n-10)]"
        >
          <BoardGlyph />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[0.7rem] text-[var(--n-10)]"
        >
          <GearGlyph />
        </button>
        <button
          type="button"
          data-coach="phone"
          onClick={onOpenPhone}
          aria-label="Open your phone"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[0.7rem] text-[var(--n-10)]"
        >
          <PhoneGlyph />
        </button>
        </div>
      </div>
      )}

      <div className="relative flex flex-col items-center">
        {/* The player's own founder, not a generic mascot. This is the same
            character that sits in the panel, the Closet and the year-end
            statement — previously the avatar existed only on the screen that
            sold it. */}
        <FounderAvatar avatar={run.avatar} size={168} priority />

        {/* Display-size on the phone, where the identity is the page's title;
            the desktop column keeps the size it was composed at (`lg:`). */}
        <h1 className="mt-1 text-center text-[1.75rem] font-extrabold leading-tight text-[var(--n-11)] lg:text-[1.4375rem]">
          {run.companyName}
        </h1>
        <p className="mt-1 text-center text-sm font-semibold text-[var(--n-7)] lg:mt-0.5 lg:text-xs">
          {founderName || "Founder"} &nbsp;|&nbsp; {fmtMoney(run.stats.valuation)}{" "}
          &nbsp;|&nbsp; FY {run.year} · {STAGE_NAME[run.stage]}
        </p>

        <div className="mt-5 lg:mt-4">
          <StatRings run={run} />
        </div>
      </div>

      {/* Rendered through a portal because on desktop this component sits
          inside a sticky, overflow-hidden column — a fixed sheet nested in
          there is one `transform` away from being clipped, and that failure is
          invisible until someone adds one. */}
      {dossierOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <CompanyDossier run={run} onClose={() => onDossier(false)} />,
          document.body,
        )}
    </section>
  );
}
