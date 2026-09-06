"use client";

import { useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useMotionValue } from "framer-motion";
import { EASE_IN, ENTER, EXIT, SCRIM, SETTLE_SPRING } from "@/components/ui/Motion";

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

  /*
   * ── The grabber does what it says ───────────────────────────────────────
   *
   * It has been drawn since this shell existed and it has never done anything:
   * a 5×36 pill that means "drag me down to dismiss" on every sheet on the
   * platform, over a sheet that could only be closed by finding the chip in the
   * opposite corner. A control that states an affordance it does not have is
   * worse than no control, because the player tries it first.
   *
   * ── Why this is hand-written and not `drag="y"` ─────────────────────────
   *
   * The sheet IS the scroll container — `overflow-y-auto` is on the same
   * element — and Framer's `drag` sets `touch-action` on whatever it is applied
   * to, which would take the vertical scroll gesture away from the content on
   * every one of these screens. `dragListener={false}` moves where a drag can
   * START; it does not give the touch-action back.
   *
   * So the pointer handling lives on the grabber, which is the only element
   * that should own a downward gesture, and it drives the same motion value the
   * entrance animates. `touch-action: none` is scoped to that 36px pill.
   *
   * ── Why it animates itself out rather than leaving through `exit` ───────
   *
   * `exit` is authored at 8% and is read when the element unmounts. A sheet
   * flung 300px down would animate UP to 8% and then fade, which is the one
   * shape a dismissal must not have. Instead it drives itself off the bottom
   * first and calls `onClose` after — by which point `exit` is fading something
   * already off screen.
   */
  const y = useMotionValue(0);
  const sheetRef = useRef<HTMLElement | null>(null);
  const drag = useRef<{ id: number; from: number; at: number } | null>(null);

  const onGrab = (e: React.PointerEvent<HTMLElement>) => {
    if (docked) return;
    /*
     * The header is a handle too, not just the pill.
     *
     * Reported: dragging it on a desktop "does not work". The pill is 22px
     * tall and a mouse is not a thumb — you aim at the sheet's top edge, miss
     * the strip, and nothing happens. iOS lets you drag a sheet by its whole
     * header, which is a target of about 90px, and so does this now.
     *
     * Anything interactive inside it is exempt: a press that starts on CLOSE
     * is a press of CLOSE, and capturing the pointer for a drag would eat the
     * click.
     */
    if ((e.target as HTMLElement | null)?.closest("button,a,input,select,textarea")) {
      // Only the header can be here: the hint strip below contains nothing
      // interactive, so a press that started on a control is always a press
      // of that control. (This used to exempt the strip by its aria-label —
      // a branch no event could reach.)
      return;
    }
    drag.current = { id: e.pointerId, from: e.clientY, at: e.timeStamp };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onGrabMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    // Down only. Dragging a sheet upward past its own top edge is a gesture
    // that promises more sheet, and there is no more sheet.
    y.set(Math.max(0, e.clientY - d.from));
  };

  const onGrabEnd = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const travelled = e.clientY - d.from;
    /*
     * Far enough, or fast enough. 56px, or 0.35px per millisecond.
     *
     * It was 96 and 0.55, which is a comfortable flick on a phone and a long
     * way to drag a mouse — reported as "drag it a little and it just goes
     * back". 56px is about a third of a sheet header and still well past
     * anything a tap or a scroll-attempt produces.
     */
    if (travelled > 56 || travelled / Math.max(1, e.timeStamp - d.at) > 0.35) {
      void animate(y, sheetRef.current?.offsetHeight ?? 600, {
        duration: 0.2,
        ease: EASE_IN,
      }).then(onClose);
      return;
    }
    // Back where it was, on the spring the rest of the app settles with.
    animate(y, 0, SETTLE_SPRING);
  };

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
          docked ? "pt-3.5" : "cursor-grab touch-none rounded-t-[var(--radius-sheet)] pt-2.5 active:cursor-grabbing"
        }`}
        {...(docked
          ? {}
          : {
              onPointerDown: onGrab,
              onPointerMove: onGrabMove,
              onPointerUp: onGrabEnd,
              onPointerCancel: onGrabEnd,
            })}
      >
        {/* A grabber says "drag me down to dismiss", and now it does. A panel
            in a column does not go anywhere, so it does not claim to.

            The pill is 5px; the thing you can grab is 22px tall and the full
            width of the header, because a 5px target is a target nobody hits.
            `touch-action: none` is scoped here and nowhere else — it is what
            stops the browser reading the drag as a scroll of the sheet, and
            putting it on the sheet would stop the sheet scrolling at all. */}
        {docked ? null : (
          /*
           * No `role="button"`, deliberately. It carried one (with
           * tabIndex={-1}, so keyboard users could never reach it) and that
           * was wrong twice over: a button that cannot be clicked or
           * keyed is a lie to assistive tech — the sheet's real dismissals
           * are CLOSE and the back gesture — and everything claiming to be
           * a button owes a 44pt target, which a 22px strip is not
           * (audit-phone's touch-target rule flagged it on every sheet at
           * every size). It is a pointer-drag affordance, nothing more,
           * and now it says so.
           */
          <div
            aria-hidden="true"
            onPointerDown={onGrab}
            onPointerMove={onGrabMove}
            onPointerUp={onGrabEnd}
            onPointerCancel={onGrabEnd}
            className="-mt-1 mb-1 flex h-[22px] cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span
              aria-hidden="true"
              className="h-[5px] w-9 rounded-full bg-[var(--n-6)]"
            />
          </div>
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
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        /* One motion value, two writers: the entrance animates it from 8% to
           0, the grabber sets it directly afterwards. Sharing it is what keeps
           a dragged sheet from snapping back to wherever `animate` last left
           its own copy. */
        style={{ y }}
        /*
         * The height is capped by the chrome above it as well as by the screen.
         *
         * `--nv-overlay-top` is what UIKit measured its floating toolbar to be,
         * and it is 0 on the web and on Android where there is no toolbar — so
         * this is `88dvh` everywhere except the one platform where 88dvh would
         * put the sheet's grabber underneath a glass close button. Measured,
         * not guessed: the same rule the play screen's chrome is built on.
         */
        className="relative flex max-h-[min(88dvh,calc(100dvh-var(--nv-overlay-top)-0.75rem))] w-full max-w-2xl flex-col overflow-y-auto overscroll-contain rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] pb-[max(1rem,var(--nv-safe-bottom),var(--nv-overlay-bottom))] shadow-[var(--e3)]"
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
