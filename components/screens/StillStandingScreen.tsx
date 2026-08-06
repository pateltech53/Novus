"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ENTER, EXIT, SCRIM } from "@/components/ui/Motion";

import { Glass, GlassScrim } from "@/components/ui/Glass";
import { useGame } from "@/lib/state/GameProvider";
import { fmtMoney } from "@/lib/engine/format";
import { industryByCode } from "@/lib/engine/constants";
import type { Industry } from "@/lib/engine/types";
import {
  claimHandle,
  fetchBoard,
  fetchHandles,
  reportEntry,
  submitRun,
  type BoardPage,
  type BoardRow,
  type BoardScope,
  type SubmitResult,
} from "@/lib/leaderboard/client";
import { tapeStatus } from "@/lib/leaderboard/recorder";
import { isBoard, type Board } from "@/lib/leaderboard/boards";
import { useNativeOverlay, useNativeOverlayOwned } from "@/components/native/useNativeOverlay";
import { NovusGlass } from "@/lib/native/glass";
import { useResolvedTheme } from "@/lib/native/theme";

/**
 * Still Standing — the two global boards.
 *
 * ── Where the glass is, and why it is only there ────────────────────────────
 *
 * `components/ui/Glass.tsx` is unambiguous: glass is a material for the CONTROL
 * layer and never for content. "Cards, The Books, decision sheets and anything
 * carrying a financial figure sit on solid ground. Money is read on solid
 * ground."
 *
 * A leaderboard is almost entirely financial figures, so almost none of this
 * screen is glass. Exactly one surface is — the sticky header that the rows
 * scroll under, which is one of the sanctioned five ("a sheet's grabber and its
 * header once content scrolls under it"). That is also the surface where glass
 * earns its keep: it is the one thing on this screen with live content moving
 * behind it, and refraction with nothing to refract is just an expensive
 * rectangle.
 *
 * On iOS the same header sits under the real UIKit material — the board opens
 * from a masthead control that `usePlayChrome` registers, so the button that
 * gets you here is a `UIGlassEffect` view like every other piece of chrome in
 * the app. The rows underneath stay solid on every platform.
 *
 * ── What the numbers on this screen are ─────────────────────────────────────
 *
 * Every figure here was computed by the server, by replaying the player's own
 * taps against `lib/engine`. None of it was sent by a client. That is what
 * makes rank unpurchasable: there is no rank column to write, the ordering keys
 * come out of a replay, and no policy lets a player write an entry at all
 * (docs/LEADERBOARD.md §8.1).
 */

const BOARDS: { id: Board; label: string; blurb: string }[] = [
  {
    id: "survival",
    label: "Still Standing",
    blurb: "Fiscal years survived. The only number that cannot be bought.",
  },
  {
    id: "valuation",
    label: "Peak Valuation",
    blurb: "The highest the books ever read — not what it was worth when it died.",
  },
];

const INDUSTRY_LABEL = (code: string) => {
  try {
    return industryByCode(code as Industry).name;
  } catch {
    return code;
  }
};

const ENDED_LABEL: Record<string, string> = {
  chapter7: "Chapter 7",
  acquired: "Acquired",
  ipo: "IPO",
};

export function StillStandingScreen({ onClose }: { onClose: () => void }) {
  // UIKit draws this screen's whole chrome when it can — see the
  // useNativeOverlay declaration below. `native` gates every DOM control
  // that would otherwise be drawn twice.
  const native = useNativeOverlayOwned();
  const { run } = useGame();
  const [board, setBoard] = useState<Board>("survival");
  const [scope, setScope] = useState<BoardScope>("global");
  const [page, setPage] = useState<BoardPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [handles, setHandles] = useState<string[] | null>(null);
  const [handleBusy, setHandleBusy] = useState(false);
  const [reported, setReported] = useState<Set<string>>(new Set());
  /* Sticky across reloads: the toggle appearing and disappearing while pages
     swap reads as the screen changing its mind. Once the server has said this
     account belongs to a chapter, the toggle stays for the sheet's lifetime. */
  const [hasChapter, setHasChapter] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const load = useCallback(async (which: Board, where: BoardScope) => {
    setLoading(true);
    const next = await fetchBoard(which, undefined, where);
    setPage(next);
    if (next.chapterAvailable) setHasChapter(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(board, scope);
  }, [board, scope, load]);

  // The header only becomes glass once there is something behind it to refract.
  // A blurred pane over a blank sheet is the cost of the material with none of
  // the reason for it.
  const onScroll = useCallback(() => {
    setScrolled((bodyRef.current?.scrollTop ?? 0) > 4);
  }, []);

  const tape = tapeStatus(run);
  const canSubmit = !!run && tape.present && tape.matchesRun;

  const onSubmit = useCallback(async () => {
    if (!run || submitting) return;
    setSubmitting(true);
    const out = await submitRun(run);
    setResult(out);
    setSubmitting(false);
    if (out.status === "verified" || out.status === "flagged") void load(board, scope);

    /*
     * On iOS the verdict also arrives as a glass note from the top — chrome
     * explaining the board, which is the clause design.md admits toasts
     * under. The panel below still carries the full result on every
     * platform; the toast is the acknowledgment at the moment of the tap,
     * where the dock button that caused it lives.
     */
    if (native && out.status !== "no-tape" && out.status !== "error") {
      const toast =
        out.status === "verified"
          ? {
              title: out.listed ? "On the board" : "Verified",
              text:
                out.peakValuation !== null && out.yearsSurvived !== null
                  ? `${fmtMoney(out.peakValuation)} peak · ${out.yearsSurvived} ${
                      out.yearsSurvived === 1 ? "year" : "years"
                    }${out.listed ? "" : " — a person reads the name before it lists"}`
                  : "The server replayed your run and the numbers stand.",
              tone: "good" as const,
            }
          : out.status === "duplicate"
            ? { text: "That run is already on the board.", tone: "neutral" as const }
            : out.status === "flagged"
              ? { text: "Submitted — a person will look at it before it lists.", tone: "neutral" as const }
              : {
                  title: "Not verified",
                  text: out.message ?? "That run could not be verified against the engine.",
                  tone: "bad" as const,
                };
      NovusGlass.toast(toast).catch(() => {
        /* no bridge — the panel already says all of this */
      });
    }

    // The one refusal the player can act on: they have no board handle yet.
    if (out.reason === "needs-handle") {
      const offer = await fetchHandles();
      if (offer.ok) setHandles(offer.options);
    }
  }, [run, submitting, board, scope, load, native]);

  const onPickHandle = useCallback(
    async (handle: string) => {
      setHandleBusy(true);
      const out = await claimHandle(handle);
      setHandleBusy(false);
      if (!out.ok) {
        // Taken is a race over ~14 million combinations, not a failure worth an
        // apology. Reshuffle and let them pick again.
        const offer = await fetchHandles();
        setHandles(offer.options);
        return;
      }
      setHandles(null);
      setResult(null);
      void onSubmit();
    },
    [onSubmit],
  );

  const onReport = useCallback(
    async (entry: BoardRow) => {
      setReported((prev) => new Set(prev).add(entry.id));
      if (native) {
        NovusGlass.toast({
          text: "Reported. The row is down while a person looks at it.",
          tone: "neutral",
        }).catch(() => {});
      }
      await reportEntry(entry.id);
    },
    [native],
  );

  const active = BOARDS.find((b) => b.id === board)!;

  /*
   * The board's chrome, drawn by UIKit in the real material.
   *
   * Everything that is chrome here goes native when native can have it — the
   * design law's whole list, deliberately: the way out is a glass circle, the
   * two boards are a real glass segmented control, the chapter cut is a
   * second circle beside the close (a segmented control is one row, and the
   * boards are the row), and the one thing this screen asks — submit the run
   * — is a prominent button in the floating dock. The rows underneath stay
   * solid on every platform: they are financial figures, and money is read
   * on solid ground.
   */
  const resolvedTheme = useResolvedTheme();
  const submitted = tape.submitted;
  useNativeOverlay(
    useMemo(
      () => ({
        mode: "shown" as const,
        theme: resolvedTheme,
        // No title plate: the sheet's own glass header already carries the
        // name, and a second copy floating over the scrim is the same words
        // twice.
        title: null,
        trailing: [
          ...(hasChapter
            ? [
                {
                  id: "scope",
                  symbol: scope === "global" ? "person.3" : "globe",
                  label:
                    scope === "global"
                      ? "Show only your chapter"
                      : "Show everyone",
                  style: "plain" as const,
                },
              ]
            : []),
          { id: "close", symbol: "xmark", label: "Close the leaderboard", style: "plain" as const },
        ],
        segments: BOARDS.map((b) => ({ id: b.id, title: b.label })),
        activeSegment: board,
        // The dock carries the screen's one ask, and only while it is
        // genuinely askable. While the handle picker is up the ask has moved
        // into the content — a dock that re-submits under it would answer a
        // question the player is no longer being asked.
        actions:
          canSubmit && !handles
            ? [
                {
                  id: "submit",
                  title: submitting
                    ? "VERIFYING…"
                    : submitted
                      ? "SUBMIT AGAIN"
                      : "SUBMIT THIS RUN",
                  label: "Submit this run to the board",
                  style: "prominent" as const,
                  enabled: !submitting,
                },
              ]
            : [],
      }),
      [resolvedTheme, hasChapter, scope, board, canSubmit, handles, submitting, submitted],
    ),
    {
      onAction: (id) => {
        if (id === "close") onClose();
        else if (id === "scope") setScope((s) => (s === "global" ? "chapter" : "global"));
        else if (id === "submit") void onSubmit();
      },
      onSegment: (id) => {
        if (isBoard(id)) setBoard(id);
      },
    },
  );

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: EXIT }}
      transition={SCRIM}
    >
      {/* The board landed a day after every other sheet's scrim became glass,
          so it kept the flat fill they all used to have. */}
      <GlassScrim label="Close the leaderboard" onClose={onClose} />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="Still Standing"
        className="relative flex max-h-[min(88dvh,calc(100dvh-var(--nv-overlay-top)-0.75rem))] w-full max-w-2xl flex-col overflow-hidden rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] shadow-[var(--e3)]"
        initial={{ y: "8%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "8%", opacity: 0, transition: EXIT }}
        transition={ENTER}
      >
        {/* ── The one glass surface on this screen ──────────────────────── */}
        <Glass
          as="header"
          solid={!scrolled}
          className="z-10 shrink-0 rounded-t-[var(--radius-sheet)] px-5 pt-5 pb-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-xl font-extrabold tracking-[-0.01em]">Still Standing</h2>
              <p className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
                {active.blurb}
              </p>
            </div>
            {native ? null : (
              <button
                type="button"
                onClick={onClose}
                className="nv-gc nv-flat shrink-0 rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
              >
                CLOSE
              </button>
            )}
          </div>

          {/* A segmented control is chrome, so it belongs on the glass — and
              when UIKit is drawing the chrome, it belongs to UIKit: the same
              two boards ride the toolbar as a real glass segmented control
              and this DOM copy is not rendered at all. The active segment is
              weight and a neutral fill — never the accent, which belongs to
              the one control that moves time. */}
          {!native && (
            <div
              role="tablist"
              aria-label="Board"
              className="mt-3 grid grid-cols-2 gap-2 rounded-[var(--radius-pill)] bg-[var(--chip)] p-1.5"
            >
              {BOARDS.map((b) => (
                <button
                  key={b.id}
                  role="tab"
                  type="button"
                  aria-selected={board === b.id}
                  onClick={() => setBoard(b.id)}
                  className={`nv-gc nv-flat rounded-[var(--radius-pill)] px-3 py-2 text-2xs font-bold tracking-[0.1em] ${
                    board === b.id
                      ? "nv-on text-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {b.label.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          {/* The chapter cut. Offered only to accounts a chapter has claimed —
              for everyone else the board is global and there is nothing to
              choose. Same rows, same rules; the ranks are recomputed within
              the classroom, so #1 here can be #300 out there. On iOS it is a
              glass circle in the toolbar instead of this second pill row. */}
          {!native && hasChapter && (
            <div
              role="tablist"
              aria-label="Who is on the board"
              className="mt-2 grid grid-cols-2 gap-2 rounded-[var(--radius-pill)] bg-[var(--chip)] p-1.5"
            >
              {(
                [
                  { id: "global" as BoardScope, label: "EVERYONE" },
                  { id: "chapter" as BoardScope, label: "MY CHAPTER" },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  role="tab"
                  type="button"
                  aria-selected={scope === s.id}
                  onClick={() => setScope(s.id)}
                  className={`nv-gc nv-flat rounded-[var(--radius-pill)] px-3 py-1.5 text-2xs font-bold tracking-[0.1em] ${
                    scope === s.id
                      ? "nv-on text-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* UIKit's segmented control names the boards but not the scope it
              is cutting them by — that lives in a toolbar circle. One quiet
              line keeps the two readable together when the chapter cut is
              active. */}
          {native && hasChapter && scope === "chapter" && (
            <p className="mt-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              MY CHAPTER ONLY
            </p>
          )}
        </Glass>

        {/* ── Rows. Solid ground, every one. And behind the native dock the
            padding grows by what UIKit measured, so the last row scrolls
            clear of the glass instead of dying under it. ───────────────── */}
        <div
          ref={bodyRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-[max(1rem,var(--nv-safe-bottom),var(--nv-overlay-bottom))]"
        >
          {loading && <Note>Reading the board…</Note>}

          {!loading && page && !page.configured && (
            <Note>
              This build has no board behind it. The company on this device is
              unaffected — everything you play is yours whether or not a server
              is listening.
            </Note>
          )}

          {!loading && page?.configured && page.rows.length === 0 && (
            <Note>
              {scope === "chapter"
                ? "Nobody from your chapter is on this board yet. A run has to be submitted — and read by a person — before it lists."
                : "Nobody is on this board yet. Every name here waits on a person reading it first, which is slow on purpose."}
            </Note>
          )}

          {!loading && page?.configured && page.rows.length > 0 && (
            <ul className="space-y-2">
              {page.rows.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  board={board}
                  mine={!!page.myHandle && row.founder_display_name === page.myHandle}
                  reported={reported.has(row.id)}
                  onReport={() => onReport(row)}
                />
              ))}
            </ul>
          )}

          {/* ── Where you stand ─────────────────────────────────────────────
              The rank is the server's answer over the WHOLE board, so a player
              whose row sits below the visible slice still gets a number — and
              their own row, pinned, when the list above does not contain it. */}
          {!loading && page?.configured && page.myRank && (
            <div className="mt-3">
              {page.myRow && !page.rows.some((r) => r.id === page.myRow?.id) && (
                <>
                  <p className="px-2 pb-1.5 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                    YOUR PLACE
                  </p>
                  <ul>
                    <Row
                      row={page.myRow}
                      board={board}
                      mine
                      reported={reported.has(page.myRow.id)}
                      onReport={() => page.myRow && onReport(page.myRow)}
                    />
                  </ul>
                </>
              )}
              <p className="tnum px-2 pt-2 text-xs font-bold text-[var(--text-secondary)]">
                You are #{page.myRank.rank} of {page.myRank.total}
                {scope === "chapter" ? " in your chapter" : " on this board"}.
              </p>
            </div>
          )}

          {/* Signed in, handle claimed, and still nowhere on this board — say
              so, because a blank where your name should be reads as a bug. */}
          {!loading && page?.configured && !page.myRank && page.myHandle && (
            <p className="px-2 pt-3 text-2xs leading-relaxed text-[var(--text-tertiary)]">
              {scope === "chapter"
                ? "You are not on this board yet — submit a run below and it appears here once a person has read the name."
                : "You are not on this board yet. Submit a run below."}
            </p>
          )}

          {/* ── Submitting ─────────────────────────────────────────────── */}
          <div className="mt-4">
            {handles ? (
              <HandlePicker busy={handleBusy} options={handles} onPick={onPickHandle} />
            ) : (
              <SubmitPanel
                canSubmit={canSubmit}
                submitted={tape.submitted}
                submitting={submitting}
                result={result}
                onSubmit={onSubmit}
                // When UIKit's dock carries SUBMIT THIS RUN, the panel keeps
                // its explanation and its verdict and drops its button — one
                // call to action, in the material that owns it.
                dockOwned={native && canSubmit}
              />
            )}
          </div>

          <p className="px-2 pt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
            Every number on this board was computed by replaying the run on the
            server. Nothing you can buy moves a place on it — not Pro, not a run
            slot, not the closet. Your founder name never appears here; the name
            beside your company comes from a word list.
          </p>
        </div>
      </motion.section>
    </motion.div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="nv-card px-5 py-6">
      <p className="text-sm leading-snug text-[var(--text-secondary)]">{children}</p>
    </div>
  );
}

function Row({
  row,
  board,
  mine,
  reported,
  onReport,
}: {
  row: BoardRow;
  board: Board;
  mine: boolean;
  reported: boolean;
  onReport: () => void;
}) {
  const [asking, setAsking] = useState(false);

  // The headline number is whichever one this board ORDERS BY, so the column a
  // player is reading down is the column that decided the order. The other one
  // is still shown, because a survival board with no valuation on it is a list
  // of numbers with no company attached.
  const headline =
    board === "survival"
      ? `${row.years_survived} ${row.years_survived === 1 ? "year" : "years"}`
      : fmtMoney(row.peak_valuation);
  const secondary =
    board === "survival"
      ? `Peak ${fmtMoney(row.peak_valuation)}`
      : `${row.years_survived} ${row.years_survived === 1 ? "year" : "years"}`;

  return (
    <li
      className={`nv-card px-4 py-3 ${
        mine ? "ring-2 ring-[var(--color-prestige)]" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="tnum w-8 shrink-0 pt-0.5 text-right text-sm font-extrabold text-[var(--text-tertiary)]">
          {row.rank}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-extrabold leading-snug">
            {row.company_name}
            {mine && (
              <span className="ml-2 rounded-full bg-[var(--color-prestige)] px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] text-[var(--on-prestige)]">
                YOU
              </span>
            )}
          </p>
          <p className="truncate text-xs leading-snug text-[var(--text-secondary)]">
            {row.founder_display_name} · {INDUSTRY_LABEL(row.industry)}
            {row.ended_by ? ` · ${ENDED_LABEL[row.ended_by] ?? row.ended_by}` : ""}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <span className="tnum block text-[0.9375rem] font-extrabold leading-tight">
            {headline}
          </span>
          <span className="tnum block text-2xs font-semibold text-[var(--text-tertiary)]">
            {secondary}
          </span>
        </div>
      </div>

      {/* §9.3 — a report control on every row, and a path that unlists in one
          click and asks questions after. Two taps, because the first one on a
          list of strangers' companies is too easy to hit by accident, and the
          second is still one click in the sense that matters: no form, no
          reason, no wait. */}
      <div className="mt-2 flex items-center justify-end gap-2 border-t border-[var(--hairline)] pt-2">
        {reported ? (
          <span className="text-2xs font-semibold text-[var(--text-tertiary)]">
            Reported. A person will look at it.
          </span>
        ) : asking ? (
          <>
            <span className="mr-auto text-2xs leading-snug text-[var(--text-secondary)]">
              Take this off the board while someone checks it?
            </span>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="nv-gc rounded-[var(--radius-pill)] px-3 py-1.5 text-2xs font-bold text-[var(--text-secondary)]"
            >
              No
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                onReport();
              }}
              className="rounded-[var(--radius-pill)] border border-[var(--hairline)] px-3 py-1.5 text-2xs font-bold text-[var(--alert)]"
            >
              Report it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAsking(true)}
            aria-label={`Report ${row.company_name}`}
            className="nv-gc nv-t-quiet rounded-[var(--radius-pill)] px-2.5 py-1 text-2xs font-semibold"
          >
            Report
          </button>
        )}
      </div>
    </li>
  );
}

function SubmitPanel({
  canSubmit,
  submitted,
  submitting,
  result,
  onSubmit,
  dockOwned = false,
}: {
  canSubmit: boolean;
  submitted: boolean;
  submitting: boolean;
  result: SubmitResult | null;
  onSubmit: () => void;
  /** True when the native dock carries the submit button, so this panel
   *  must not render a second one. Removed, not hidden — a hidden button
   *  still takes a tap on iOS. */
  dockOwned?: boolean;
}) {
  return (
    <div className="nv-card px-4 py-4">
      <p className="text-[0.9375rem] font-extrabold leading-snug">
        Put this company on the board
      </p>
      <p className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
        Your taps are sent, not your score. The server replays the run and works
        out what it was worth — so the number beside your name is one nobody,
        including you, could type.
      </p>

      {result && (
        <div
          className={`mt-3 rounded-[var(--radius-card)] px-3 py-2.5 ${
            result.status === "rejected" || result.status === "error"
              ? "bg-[var(--alert)]/10"
              : "bg-[var(--chip)]"
          }`}
        >
          {result.peakValuation !== null && (
            <p className="tnum text-xs font-bold">
              Verified: {fmtMoney(result.peakValuation)} peak ·{" "}
              {result.yearsSurvived}{" "}
              {result.yearsSurvived === 1 ? "year" : "years"}
            </p>
          )}
          {result.message && (
            <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">
              {result.message}
            </p>
          )}
          {result.status === "rejected" && !result.message && (
            <p className="text-xs leading-snug text-[var(--text-secondary)]">
              That run could not be verified against the engine.
            </p>
          )}
        </div>
      )}

      {!dockOwned && (
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={onSubmit}
          className="nv-gc mt-3 flex h-14 w-full items-center justify-center rounded-[var(--radius-card)] nv-t-action px-4 text-center text-sm font-extrabold leading-tight disabled:opacity-40"
        >
          {submitting ? "Verifying…" : submitted ? "Submit again" : "Submit this run"}
        </button>
      )}

      {!canSubmit && (
        <p className="mt-2 text-2xs leading-snug text-[var(--text-tertiary)]">
          This company was founded before the board existed, so there is nothing
          to verify. The next one counts.
        </p>
      )}
    </div>
  );
}

function HandlePicker({
  options,
  busy,
  onPick,
}: {
  options: string[];
  busy: boolean;
  onPick: (handle: string) => void;
}) {
  return (
    <div className="nv-card px-4 py-4">
      <p className="text-[0.9375rem] font-extrabold leading-snug">
        Pick the name that goes on the board
      </p>
      <p className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
        Not your founder name — that one stays on this device, in your own
        company, where it belongs. This is what the rest of the world sees.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((handle) => (
          <li key={handle}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(handle)}
              className="nv-gc w-full rounded-[var(--radius-card)] px-3 py-3 text-sm font-bold disabled:opacity-40"
            >
              {handle}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
