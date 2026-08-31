/**
 * The room, before the lights come up.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * `/play` used to render one centred line — "Opening the books…" — while it
 * waited for the run to load. That sentence was on screen for the whole of a
 * 421 kB gz bundle plus a localStorage read, and then the entire page swapped
 * out from under it. Two full layouts in a row, the first of which was a
 * sentence in the middle of nothing.
 *
 * It matters more than it looks, because this is also on the NATIVE app's
 * cold-start path: `public/boot.html` (the shell's entry document) reads
 * localStorage and `location.replace()`s into the game, so what a player sees
 * right after the splash lifts is whatever the landing route paints first. No
 * amount of route-level polish reaches that path — only what this component
 * paints does.
 *
 * ── Why it is not a shimmer ─────────────────────────────────────────────────
 *
 * A skeleton is the fastest way to put slop into a product: sweep a gradient
 * across some grey capsules and every app looks like every other app. This one
 * draws the surfaces `/play` actually has, at the sizes it actually has them —
 * the masthead block, the four Books cards in their 2×2 (4-up at `lg`), the log
 * row, the advance deck and the tab bar — in the neutral one step off the
 * ground. Nothing animates. Nothing pulses. It reads as a room with the lights
 * still down, which is true, rather than as a loading widget, which is a
 * different and more annoying kind of lie.
 *
 * The structure below deliberately mirrors `app/play/page.tsx` — same
 * `min-h-dvh` document, same fixed deck on phone, same `lg:` grid seam — so the
 * arrival is content filling into a layout that is already correct, not a
 * layout being replaced. That mirroring is load-bearing: see the note on the
 * <main> element about what happens when it drifts.
 */
export function PlaySkeleton() {
  return (
    <main
      // aria-hidden + aria-busy: this is scaffolding, not content. A screen
      // reader should hear the label below and then the real screen, never a
      // description of five empty rectangles.
      aria-busy="true"
      /*
       * These classes track app/play/page.tsx's <main> exactly, and they have to
       * be re-checked whenever that layout changes. They were written against
       * the fixed-height `h-dvh` + `overflow-hidden` composition and went stale
       * within a day, when "Give /play its scroll back" reverted it to a
       * scrolling `min-h-dvh` document — leaving the skeleton mirroring a layout
       * the screen no longer had, which is precisely the layout jump this
       * component exists to prevent.
       */
      className="min-h-dvh bg-[var(--bg)] lg:mx-auto lg:grid lg:min-h-dvh lg:max-w-6xl lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-6 lg:px-6 lg:py-6"
    >
      <p className="sr-only" role="status">
        Opening the books…
      </p>

      {/* Masthead on phone, left column at lg — where HomeStage lands. */}
      <div
        aria-hidden="true"
        className="h-[32svh] min-h-[200px] bg-[var(--n-1)] lg:sticky lg:top-6 lg:h-[26rem] lg:self-start lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:shadow-[var(--e2)]"
      />

      <div
        aria-hidden="true"
        className="flex min-h-0 flex-col lg:h-[calc(100dvh-3rem)] lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]"
      >
        {/* The Books — same grid as TheBooks.tsx:65. */}
        <div className="grid grid-cols-2 gap-2 px-3 pt-3 lg:grid-cols-4 lg:gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[4.5rem] rounded-[var(--radius-card)] bg-[var(--n-1)] lg:h-[3.25rem]"
            />
          ))}
        </div>

        {/* The log: one row on phone, the reading column at lg. */}
        <div className="px-3 pt-3 lg:hidden">
          <div className="h-12 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
        </div>
        <div className="hidden flex-1 flex-col gap-2 px-3 pt-3 pb-3 lg:flex">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
          ))}
        </div>

        {/* The deck: ADVANCE MONTH, then the tab bar, both at their real heights
            so nothing jumps when the screen arrives. Fixed on phone exactly as
            the real screen has it, static in the desktop rail. */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--hairline)] bg-[var(--bg)] px-3 pt-2 lg:static lg:bg-[var(--surface)]">
          <div className="h-14 rounded-[var(--radius-pill)] bg-[var(--n-1)]" />
          <div className="mx-auto mt-1.5 grid w-full max-w-2xl grid-cols-3 gap-2 pt-1 pb-[max(0.375rem,var(--nv-safe-bottom))] min-[360px]:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
