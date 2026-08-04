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

/**
 * An open book, not an ⓘ. The dossier button beside this one is already drawn
 * as an info circle (components/CompanyDossier.tsx), and two ⓘs in one row is
 * a coin flip every time someone wants their numbers or the glossary. A book
 * is what this actually opens: the vocabulary, looked up.
 */
function BookGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 4.4C7.6 3.1 5.6 2.7 2.8 2.7v10.8c2.8 0 4.8.4 6.2 1.7 1.4-1.3 3.4-1.7 6.2-1.7V2.7c-2.8 0-4.8.4-6.2 1.7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 4.4v10.8" stroke="currentColor" strokeWidth="1.5" />
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
  onOpenStageGuide,
  onOpenKeyTerms,
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
  /** Opens the per-stage rookie guide from the stage line in the identity row. */
  onOpenStageGuide: () => void;
  /** The book button: every key term, searchable, with the Rookie switch on it. */
  onOpenKeyTerms: () => void;
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
      /*
        The lower corners are the phone's: there the masthead is the top of the
        page and rounds into the ledger below it. On the desktop rail it is the
        TOP OF A PANEL that continues into the activities list, so a 22px curve
        inside the panel's own 14px one is a child rounder than its parent —
        the one arrangement the radius budget rules out. Squared at `lg`.
      */
      className="nv-masthead nv-stage relative overflow-hidden rounded-b-[var(--radius-sheet)] px-5 pb-5 lg:rounded-b-none"
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
        {/* The book — the key terms page, and the Rookie switch on it. First
            in the row because it is the door a confused player is looking
            for, and the tutorial points at it by name. */}
        <button
          type="button"
          data-coach="info"
          onClick={onOpenKeyTerms}
          aria-label="Key terms — every word the game uses, explained"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[var(--radius-row)] text-[var(--n-10)]"
        >
          <BookGlyph />
        </button>
        {/* The whole company, on one scroll. Sits with the gear and the phone
            because it is a thing you consult, not a move you make. */}
        <button
          type="button"
          data-opens
          onClick={() => onDossier(true)}
          aria-label="Company dossier"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[var(--radius-row)] text-[var(--n-10)]"
        >
          <DossierGlyph />
        </button>
        <button
          type="button"
          onClick={onOpenBoard}
          aria-label="Still Standing — the global boards"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[var(--radius-row)] text-[var(--n-10)]"
        >
          <BoardGlyph />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[var(--radius-row)] text-[var(--n-10)]"
        >
          <GearGlyph />
        </button>
        <button
          type="button"
          data-coach="phone"
          onClick={onOpenPhone}
          aria-label="Open your phone"
          className="nv-gc flex h-9 w-9 items-center justify-center rounded-[var(--radius-row)] text-[var(--n-10)]"
        >
          <PhoneGlyph />
        </button>
        </div>
      </div>
      )}

      {/*
        ── The identity ────────────────────────────────────────────────────
        On a phone this is a ROW: the founder at portrait scale on the left,
        the company's name and line beside it. It used to be a centred hero —
        a 168px character above a 28px title, ~45% of the screen, on the one
        screen a player looks at three hundred times a session. The character
        is the brand and it stays; what it stops being is the page.

        The height that buys goes to The Books, which is where a game about
        cash, burn, runway and valuation should be spending it.

        `lg:` puts the centred column back, because the desktop rail was never
        the problem: it is a 100dvh column with room for the full portrait.
      */}
      <div className="relative flex items-center gap-3.5 lg:flex-col lg:items-center lg:gap-0">
        {/* The player's own founder, not a generic mascot. This is the same
            character that sits in the panel, the Closet and the year-end
            statement — previously the avatar existed only on the screen that
            sold it. Its rendered size comes from `--nv-portrait-size`
            (globals.css), so the breakpoint is one declaration rather than a
            prop threaded through two components. */}
        <FounderAvatar avatar={run.avatar} size={168} priority className="shrink-0" />

        <div className="min-w-0 flex-1 lg:w-full lg:flex-none">
        {/* Beside the portrait the title has ~245px rather than the full
            width, so it steps down one notch and wraps to at most two lines
            instead of truncating — a company name the player chose is not a
            thing to put an ellipsis through. */}
        <h1 className="line-clamp-2 text-[1.375rem] font-extrabold leading-tight text-[var(--n-11)] lg:mt-1 lg:text-center lg:text-[1.4375rem]">
          {run.companyName}
        </h1>
        <p className="mt-1 text-sm font-semibold text-[var(--n-7)] lg:mt-0.5 lg:text-center lg:text-xs">
          {founderName || "Founder"} &nbsp;|&nbsp; {fmtMoney(run.stats.valuation)}{" "}
          &nbsp;|&nbsp; FY {run.year} ·{" "}
          {/* The stage is a way in, not just a label: it opens a plain-English
              guide to what this stage is, what your Books are saying, and how to
              level up. Rookie Mode (default on) underlines it so a new player
              finds it; everyone can tap it. */}
          <button
            type="button"
            onClick={onOpenStageGuide}
            aria-label={`What ${STAGE_NAME[run.stage]} means`}
            // Drawn INLINE in a 14px line, so its own box was 20px tall — under the
            // 30 a thumb needs, and `nv-tap` could not save it: that pseudo-element
            // reaches 8px past the box and the audit probes 22px out, which is
            // tuned for the 28px switches it was written for. An inline-flex with a
            // real height is the honest fix; it costs the line 10px and nothing
            // else. Caught by `npm run audit:phone` at 393 and 430px.
            className={`nv-gc inline-flex h-[30px] items-center rounded-[var(--radius-chip)] px-1.5 align-middle font-semibold text-[var(--n-7)] ${
              run.rookieMode
                ? "underline decoration-dotted underline-offset-4 decoration-[var(--n-6)]"
                : ""
            }`}
          >
            {STAGE_NAME[run.stage]}
            <span aria-hidden="true" className="ml-0.5 text-[var(--n-6)]">?</span>
          </button>
        </p>
        </div>
      </div>

      {/* The three abilities sit under the identity row on a phone and under
          the centred column on desktop — one place in both, so the coachmark
          that points at the masthead points at the same shape either way. */}
      <div className="mt-4 flex justify-center lg:mt-4">
        <StatRings run={run} />
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
