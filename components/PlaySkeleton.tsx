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
 * It matters more than it looks, because this is also the NATIVE app's normal
 * cold start: `native/boot.html` does `location.replace("/play/index.html")`,
 * so the first thing a player sees after the splash screen lifts is this. No
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
 * The structure below deliberately mirrors `app/play/page.tsx` — same flex
 * column, same `h-dvh` + `overflow-hidden`, same `lg:` grid seam — so the
 * arrival is content filling into a layout that is already correct, not a
 * layout being replaced.
 */
export function PlaySkeleton() {
  return (
    <main
      // aria-hidden + aria-busy: this is scaffolding, not content. A screen
      // reader should hear the label below and then the real screen, never a
      // description of five empty rectangles.
      aria-busy="true"
      className="flex h-dvh flex-col overflow-hidden bg-[var(--bg)] lg:mx-auto lg:grid lg:h-auto lg:min-h-dvh lg:max-w-6xl lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-6 lg:overflow-visible lg:px-6 lg:py-6"
    >
      <p className="sr-only" role="status">
        Opening the books…
      </p>

      {/* Masthead on phone, left column at lg — where HomeStage lands. */}
      <div
        aria-hidden="true"
        className="h-[32svh] min-h-[200px] shrink-0 bg-[var(--n-1)] lg:sticky lg:top-6 lg:h-[26rem] lg:self-start lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:shadow-[var(--e2)]"
      />

      <div
        aria-hidden="true"
        className="flex min-h-0 flex-1 flex-col lg:h-[calc(100dvh-3rem)] lg:flex-none lg:overflow-hidden lg:rounded-[var(--radius-card)] lg:bg-[var(--surface)] lg:shadow-[var(--e2)]"
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

        <div className="flex-1 lg:hidden" />

        {/* The deck: ADVANCE MONTH, then the tab bar. Both keep their real
            heights so the bar does not jump when the screen arrives. */}
        <div className="shrink-0 border-t border-[var(--hairline)] bg-[var(--bg)] px-3 pt-2 lg:static lg:bg-[var(--surface)]">
          <div className="h-14 rounded-[var(--radius-pill)] bg-[var(--n-1)]" />
          <div className="mx-auto mt-1.5 grid w-full max-w-2xl grid-cols-3 gap-2 pt-1 pb-[max(0.375rem,env(safe-area-inset-bottom))] min-[360px]:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
