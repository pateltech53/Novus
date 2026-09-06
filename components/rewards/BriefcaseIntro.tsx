"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";

import { SCRIM, SHEET_SPRING } from "@/components/ui/Motion";
import { identity, type Identity } from "@/lib/cloud/auth";
import { haptic } from "@/lib/haptics";
import { useBackHandler } from "@/lib/native/back";
import { appPath } from "@/lib/native/href";
import { markIntroSeen } from "@/lib/rewards/intro";
import { play } from "@/lib/sound";

/**
 * "Introducing Briefcases" — the one-time sheet for players who were already
 * here when the reward loop reached everyone.
 *
 * ── Who sees it, and who does not ───────────────────────────────────────────
 *
 * The briefcase loop (docs/BRIEFCASES.md) spent its beta behind a per-account
 * flag, so a feature that is now on for every signed-in account is a feature
 * most of the existing players have never been told about. This card tells
 * them, once: the next time an onboarded player lands on the board (/play) or
 * the archipelago (/islands) with no tutorial running and nothing else on
 * screen, it comes up over the page, says its three sentences, and offers the
 * missions.
 *
 * A NEW player never sees it. The guided first play carries a "briefcases"
 * step (components/Coachmarks.tsx) that says the same thing beside the tab
 * bar the cases live behind, and app/welcome/page.tsx marks the introduction
 * seen the moment onboarding finishes — a player taught by the tutorial and
 * then handed this sheet would be told twice in ten minutes.
 *
 * ── The three states behind one card ────────────────────────────────────────
 *
 * Whether the player can actually earn a case depends on who is signed in, so
 * the card waits for `identity()` before it draws anything and picks its
 * ending from the answer:
 *
 *   · signed in       — SEE TODAY'S MISSIONS, a document navigation to
 *                       /rewards, and a quiet NOT NOW.
 *   · signed out      — the same three beats, then one line saying where the
 *                       account door is and a single GOT IT. Briefcases attach
 *                       to an account (every /api/rewards route answers 404 to
 *                       a visitor), and a button that opened an empty screen
 *                       would be the wrong first impression of the thing.
 *   · not configured  — a deploy with no Supabase behind it, which is a
 *                       supported state (CLAUDE.md, Persistence). Nothing is
 *                       drawn and the introduction is recorded as seen, since
 *                       there is nothing here to introduce. The one exception
 *                       is a device that is simply OFFLINE — `identity()`
 *                       answers "not configured" to a failed fetch too — and
 *                       that device keeps its introduction for the next visit
 *                       that has a network.
 *
 * ── Why it is device-local ──────────────────────────────────────────────────
 *
 * The seen-flag lives in lib/rewards/intro.ts and its header says why; the
 * short version is that an announcement is not progress, and a fact whose
 * only job is "this sheet was shown" does not belong on the profile every
 * sync carries. A player who dismisses it on one phone may meet it once more
 * on another. That is the cheaper of the two mistakes.
 *
 * ── Shape ───────────────────────────────────────────────────────────────────
 *
 * The same object as components/TierUnlock.tsx — a fixed DOM overlay over the
 * board with a card sprung into it — because it is the same kind of moment: a
 * door has opened, here is what is behind it. It works unchanged inside the
 * iOS and Android shells, which render DOM overlays; both pages that mount
 * it withdraw their native chrome while it is up, exactly as they do for the
 * tier unlock. Motion comes from the motion system only, and `MotionConfig
 * reducedMotion="user"` (components/ui/Motion.tsx) turns the spring into a
 * plain fade for anyone who asked for less movement — the haptic reads the
 * same preference and stays silent for them.
 */

const BEATS = [
  "Five missions a day. The same five for everyone, reset at 09:00 UTC.",
  "Finish one and a sealed briefcase is yours. Open it for a founder skin, Shark Tokens, or a trial of Pro.",
  "Earned, never bought. The odds are printed on every case, and nothing inside touches your score. Your career so far may already have earned you one.",
] as const;

/**
 * A sealed case, closed, mid-tier — the shape the whole feature is named
 * after, and deliberately not the gold one: the tier of any real case is
 * unknown until the ceremony, and the picture should not promise. Rendered
 * out of `public/briefcase/manifest.json`'s `cases` set; a missing file (the
 * art set is regenerated, see docs/BRIEFCASE-ART.md) collapses the band rather
 * than showing a broken image.
 */
const CASE_STILL = "/briefcase/cases/t3-titanium-closed.webp";

export function BriefcaseIntro({
  onClose,
}: {
  /**
   * Called once the card is done — dismissed, or found nothing to show. The
   * seen-flag is already written by then on every path except an offline
   * device; the parent only has to take the card down.
   */
  onClose: () => void;
}) {
  const [who, setWho] = useState<Identity | null>(null);
  const [artFailed, setArtFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void identity().then((id) => {
      if (live) setWho(id);
    });
    return () => {
      live = false;
    };
  }, []);

  /*
   * Nothing to introduce on this deploy. Recorded as seen so a build with no
   * accounts never asks again — unless the browser says it is offline, which
   * is the one signal that separates "no server" from "no network" and the
   * one case where the next visit should still get the card.
   */
  useEffect(() => {
    if (!who || who.configured) return;
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      markIntroSeen();
    }
    onClose();
  }, [who, onClose]);

  const shown = !!who?.configured;

  // The same cue and the same buzz as the tier unlock: a door opening.
  useEffect(() => {
    if (!shown) return;
    haptic("yearClosed");
    play("unlock");
  }, [shown]);

  const dismiss = useCallback(() => {
    markIntroSeen();
    onClose();
  }, [onClose]);

  // Android's back button peels this like any other overlay, and Escape does
  // the same for anyone not using a pointer.
  useBackHandler(shown, dismiss);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, dismiss]);

  if (!shown) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--scrim)] px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SCRIM}
      role="dialog"
      aria-modal="true"
      aria-label="Introducing Briefcases"
    >
      <motion.div
        className="w-full max-w-sm overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface)] shadow-[var(--e4)]"
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={SHEET_SPRING}
      >
        {!artFailed && (
          <div className="flex h-40 w-full items-center justify-center bg-[var(--n-0)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={CASE_STILL}
              alt=""
              onError={() => setArtFailed(true)}
              className="h-32 w-32 object-contain"
            />
          </div>
        )}

        <div className="p-5">
          <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
            NEW
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.01em]">
            Introducing Briefcases
          </h2>

          {/* Three beats, in the order a player asks the questions: what is
              it, what do I get, what is the catch. The numerals are the
              ledger face — the same treatment the Books give a figure. */}
          <ol className="mt-3 space-y-2.5">
            {BEATS.map((beat, i) => (
              <li key={i} className="flex gap-3">
                <span className="tnum mt-0.5 shrink-0 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                  0{i + 1}
                </span>
                <p className="text-sm leading-snug text-[var(--text-secondary)]">
                  {beat}
                </p>
              </li>
            ))}
          </ol>

          {who?.signedIn ? (
            <>
              {/*
                A document navigation, not a router push, for the same reason
                ClosetRewards links the same way: /rewards reads the account
                on mount and the board being left has to have flushed first.
                `appPath` names the file for an old bundled shell and is the
                plain route everywhere else (lib/native/href.ts). The flag is
                written on the tap, before the page goes.

                The one accent on this screen. NOT NOW is a quiet line under
                it, which is the shape every secondary answer takes here.
              */}
              <a
                href={appPath("/rewards")}
                onClick={markIntroSeen}
                className="nv-gc mt-5 flex h-14 w-full items-center justify-center rounded-[var(--radius-card)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
              >
                SEE TODAY&rsquo;S MISSIONS ▸
              </a>
              <button
                type="button"
                onClick={dismiss}
                className="mt-2.5 h-11 w-full text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]"
              >
                NOT NOW
              </button>
            </>
          ) : (
            <>
              <p className="mt-4 border-t border-[var(--hairline)] pt-3.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                Sign in from Settings to start earning them.
              </p>
              <button
                type="button"
                onClick={dismiss}
                className="nv-gc mt-3.5 h-14 w-full rounded-[var(--radius-card)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
              >
                GOT IT
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
