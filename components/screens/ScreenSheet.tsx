"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { ENTER, EXIT, SCRIM } from "@/components/ui/Motion";

import { Glass, GlassButton, GlassScrim } from "@/components/ui/Glass";
import { useNativeOverlay, useNativeOverlayOwned } from "@/components/native/useNativeOverlay";
import { useIsWide, useWorkspaceSlot } from "@/components/screens/Workspace";
import { useResolvedTheme } from "@/lib/native/theme";
import type { NativeOverlayButton, NativeOverlaySegment } from "@/lib/native/glass";

/**
 * The shell every activity tab opens into.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Company, Team, Product and Assets were four copies of the same forty lines —
 * the same `fixed inset-0`, the same `max-h-[88dvh]` sheet, the same spring,
 * the same header row, the same CLOSE chip. Four copies is how three of them
 * end up with a glass header and the fourth does not, and nobody notices until
 * a player opens them back to back.
 *
 * ── What it gives them that they did not have ───────────────────────────────
 *
 * **A scrim that is actually glass.** design.md has listed the modal scrim as
 * a glass surface from the beginning; these sheets rendered it as a flat fill,
 * so the board behind them went dark rather than out of focus.
 *
 * **A header that stays.** The header used to be the first thing in a
 * scrolling column, so the title and the way out both left the screen the
 * moment a player read anything. It is pinned now, and it is glass — which is
 * the exact clause design.md allows glass under, "a sheet header once content
 * scrolls under it". The content genuinely scrolls under it: the section is
 * the scroll container and the header is `sticky top-0` inside it, so the
 * roster or the ledger passes beneath a pane rather than being clipped by a
 * bar.
 *
 * **A grabber**, solid, on the glass. Deliberately not glass itself: a glass
 * pill on a glass header is glass behind glass, which is the smudge this app
 * just finished deleting from the top of the play screen.
 *
 * `subnav` rides inside the pinned header rather than under it. Assets is the
 * only caller with one, and a segmented control that scrolls away is a control
 * you have to go and find.
 *
 * ── On iOS, the way out is UIKit's ──────────────────────────────────────────
 *
 * The header stays where it is; what moves is the CLOSE chip. When the native
 * chrome is live it is drawn as a real `UIGlassEffect` circle floating over the
 * scrim above the sheet — the system's own material, its own press deformation,
 * its own specular edge — and the DOM chip is not rendered at all. Not hidden:
 * a `visibility: hidden` button still takes a tap on iOS if the native view
 * above it passes the touch through, and the player gets a dead zone nobody can
 * see.
 *
 * `nativeSegments` is the same handoff for the subnav. A caller that passes it
 * gets a real glass segmented control on iOS and its own `subnav` node
 * everywhere else, which is why both props exist rather than one: a React node
 * cannot cross a bridge, and a list of ids cannot be styled by Tailwind.
 */
export function ScreenSheet({
  label,
  closeLabel,
  onClose,
  eyebrow,
  title,
  blurb,
  subnav,
  nativeSegments,
  activeSegment,
  onSegment,
  nativeActions,
  onNativeAction,
  workspace,
  children,
}: {
  /** The dialog's accessible name. */
  label: string;
  /** What the scrim's tap does — "Close the team screen". */
  closeLabel: string;
  onClose: () => void;
  /** A small line above the title. Company is the only caller with one. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /**
   * The line under the title. Every screen has one; it is what the screen is
   * for.
   *
   * Prose, and only prose. This header is glass, and "money is read on solid
   * ground" is not relaxed by a surface being chrome — a figure that belongs
   * here belongs in the body instead, which is where Company's equity line
   * went when this header stopped being opaque.
   */
  blurb?: React.ReactNode;
  /** Pinned with the header. A segmented control, where a screen has one. */
  subnav?: React.ReactNode;
  /**
   * The same control, described so UIKit can draw it in the real material.
   *
   * A caller that passes this AND `subnav` gets the native one on iOS and the
   * DOM one everywhere else, and never both — `subnav` is not rendered when
   * the native chrome owns the screen.
   */
  nativeSegments?: NativeOverlaySegment[];
  activeSegment?: string;
  onSegment?: (id: string) => void;
  /**
   * The screen's one call to action, in a floating glass dock.
   *
   * iOS only, and for the same reason as everything else native here: a dock
   * pinned above the safe area does not scroll, and a UIKit view can only
   * exist where web content does not move under it. A screen that passes this
   * must still render its own button for the web and Android — and must not
   * render it when `native` says UIKit has one.
   *
   * At most one `prominent`. A dock with three prominent buttons in it is a
   * screen with no call to action at all.
   */
  nativeActions?: NativeOverlayButton[];
  onNativeAction?: (id: string) => void;
  /**
   * This screen is a page of the desktop workspace, not only a sheet.
   *
   * Set by the four activity screens the left rail navigates between. Where a
   * workspace slot is mounted and the viewport is wide enough to show it, they
   * render into the centre column instead of over the whole layout — see
   * components/screens/Workspace.tsx. Everywhere else this changes nothing.
   */
  workspace?: boolean;
  children: React.ReactNode;
}) {
  const native = useNativeOverlayOwned();
  const theme = useResolvedTheme();
  const slot = useWorkspaceSlot();
  const wide = useIsWide();

  // A panel in the centre column, rather than a sheet over everything. All
  // three conditions, for the reasons set out in Workspace.tsx.
  const docked = !!workspace && !!slot && wide && !native;

  useNativeOverlay(
    useMemo(
      () =>
        // Docked, there is nothing for UIKit to draw: no scrim to float a
        // close button over, and the panel's own header carries the way out.
        // `null` withdraws this screen's chrome rather than declaring empty
        // chrome, so whatever is underneath comes back.
        docked
          ? null
          : {
              mode: "shown" as const,
              theme,
              // No title plate. The sheet's own pinned header already carries
              // the title, 60pt below this and inside the surface it names; a
              // second copy floating over the scrim would be the same words
              // twice.
              title: null,
              // The way out, and only the way out.
              trailing: [
                { id: "close", symbol: "xmark", label: closeLabel, style: "plain" as const },
              ],
              segments: nativeSegments ?? [],
              activeSegment: activeSegment ?? null,
              actions: nativeActions ?? [],
            },
      [docked, theme, closeLabel, nativeSegments, activeSegment, nativeActions],
    ),
    {
      // `close` is the toolbar's; everything else is the dock's, and the dock
      // belongs to the screen that declared it.
      onAction: (id) => (id === "close" ? onClose() : onNativeAction?.(id)),
      onSegment: (id) => onSegment?.(id),
    },
  );

  /*
   * The screen itself: pinned header, blurb, body. Identical in both shells —
   * what changes around it is where it sits and what it sits on.
   */
  const inner = (
    <>
      <Glass
        as="header"
        /*
         * The radius is repeated here on purpose. The section clips its own
         * corners, but a `backdrop-filter` element establishes a stacking
         * context of its own and Safari has been known to paint one past a
         * rounded ancestor's clip — a square glass corner over a rounded
         * sheet is the kind of thing that only shows up on a device.
         *
         * Docked there is no rounded top to paint past: the panel's top edge
         * is the books' bottom border, squared off against it.
         */
        className={`sticky top-0 z-10 shrink-0 px-5 pb-3.5 ${
          docked ? "pt-3.5" : "rounded-t-[var(--radius-sheet)] pt-2.5"
        }`}
      >
        {/* A grabber says "drag me down to dismiss". A panel in a column
            does not go anywhere, so it does not claim to. */}
        {docked ? null : (
          <div
            aria-hidden="true"
            className="mx-auto mb-2.5 h-[5px] w-9 rounded-full bg-[var(--n-6)]"
          />
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {eyebrow ? (
              /*
               * Wraps, never truncates. "FOOD & BEVERAGE · GARAGE" is 8px
               * wider than a 320px header can offer, and "TOYS &
               * COLLECTIBLES" is wider still — an ellipsis here was clipping
               * a company's own industry on exactly the screens §7 audits.
               * A second line costs the header 14px once, on the narrowest
               * phones, and only for the longest names.
               */
              <p className="text-2xs font-bold leading-snug tracking-[0.12em] text-[var(--text-tertiary)]">
                {eyebrow}
              </p>
            ) : null}
            <h2 className="truncate text-xl font-extrabold tracking-[-0.01em]">{title}</h2>
          </div>
          {/*
            Not rendered at all when UIKit has drawn it — see the note at the
            top of this file. `visibility: hidden` is not good enough on iOS.
          */}
          {native && !docked ? null : (
            <GlassButton
              /*
               * `bare`, and the chip's own geometry kept to the pixel.
               *
               * A shape preset here made the pill 8px wider, and 8px is the
               * whole margin Company's eyebrow has at 320px — "FOOD &
               * BEVERAGE · GARAGE" went from fitting to clipped. The material
               * changed; the box it occupies did not.
               */
              shape="bare"
              /* On the glass header, so it takes the material's tint and
                 press without blurring what the header already blurred. */
              flat
              onClick={onClose}
              className="shrink-0 rounded-full px-3 py-1.5 text-2xs tracking-[0.12em] text-[var(--text-secondary)]"
            >
              CLOSE
            </GlassButton>
          )}
        </div>
        {subnav && !(native && nativeSegments && !docked) ? (
          <div className="mt-3">{subnav}</div>
        ) : null}
      </Glass>

      {/*
        Below the pinned header, not inside it.

        Assets' line runs to five lines at 320px, and pinned that was half the
        sheet permanently given over to a sentence you read once. What has to
        stay reachable is the title, the way out and the control that changes
        what you are looking at; the description of it can scroll away like
        everything else it describes.
      */}
      {blurb ? (
        <div className="px-5 pt-3.5 text-sm leading-snug text-[var(--text-secondary)]">
          {blurb}
        </div>
      ) : null}

      {children}
    </>
  );

  /*
   * Docked: a panel filling the centre column's working area.
   *
   * No scrim and no `aria-modal`, because nothing is behind it that has been
   * made unavailable — the books are still above it, the rail still to its
   * left, and all of it still clickable. It is a region of the page, and it
   * says so. The motion drops the sheet's rise-from-the-bottom for a short
   * settle, which is the difference between "something arrived over you" and
   * "this column is showing something else now".
   */
  if (docked && slot) {
    return createPortal(
      <motion.section
        role="region"
        aria-label={label}
        className="flex h-full w-full min-h-0 flex-col overflow-y-auto border-t border-[var(--hairline)] bg-[var(--sheet)] pb-4"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6, transition: EXIT }}
        transition={ENTER}
      >
        {inner}
      </motion.section>,
      slot,
    );
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: EXIT }}
      transition={SCRIM}
    >
      <GlassScrim label={closeLabel} onClose={onClose} />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        /*
         * The height is capped by the chrome above it as well as by the screen.
         *
         * `--nv-overlay-top` is what UIKit measured its floating toolbar to be,
         * and it is 0 on the web and on Android where there is no toolbar — so
         * this is `88dvh` everywhere except the one platform where 88dvh would
         * put the sheet's grabber underneath a glass close button. Measured,
         * not guessed: the same rule the play screen's chrome is built on.
         */
        className="relative flex max-h-[min(88dvh,calc(100dvh-var(--nv-overlay-top)-0.75rem))] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] pb-[max(1rem,var(--nv-safe-bottom),var(--nv-overlay-bottom))] shadow-[var(--e3)]"
        initial={{ y: "8%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "8%", opacity: 0, transition: EXIT }}
        transition={ENTER}
      >
        {inner}
      </motion.section>
    </motion.div>
  );
}
