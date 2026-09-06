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
 * `min-h-dvh` document, same fixed deck on phone, same `desk:` grid seam — so the
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
       *
       * It went stale a second time, and further. The desktop workspace grew
       * its third column — the life log came out of a drawer and became a
       * 21rem rail — and the container widened with it (`max-w-6xl` → 88rem,
       * two columns → three, gap-6/px-6/py-6 → 5). This file kept the old
       * numbers, so on a desktop browser the room came up as two columns in a
       * 72rem box and then snapped to three in an 88rem one, with a whole rail
       * appearing from nothing. Neither the phone audit nor CI can see it: the
       * `desk:` variant is off below 64rem and off inside a shell at any
       * width, which is every viewport those two exercise.
       */
      className="min-h-dvh bg-[var(--bg)] desk:mx-auto desk:grid desk:min-h-dvh desk:max-w-[88rem] desk:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_minmax(0,21rem)] desk:gap-5 desk:px-5 desk:py-5"
    >
      <p className="sr-only" role="status">
        Opening the books…
      </p>

      {/* Masthead on phone, left column on the desk — where HomeStage lands.
          The phone column caps and centres exactly as the real page's does,
          so a wide shell window fills into the same centred column it was
          already showing. */}
      <div
        aria-hidden="true"
        className="mx-auto h-[32svh] min-h-[200px] w-full max-w-2xl bg-[var(--n-1)] desk:sticky desk:top-5 desk:h-[calc(100dvh-2.5rem)] desk:max-w-none desk:self-start desk:overflow-hidden desk:rounded-[var(--radius-card)] desk:bg-[var(--surface)] desk:shadow-[var(--e2)]"
      />

      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-2xl min-h-0 flex-col desk:h-[calc(100dvh-2.5rem)] desk:max-w-none desk:overflow-hidden desk:rounded-[var(--radius-card)] desk:bg-[var(--surface)] desk:shadow-[var(--e2)]"
      >
        {/* The Books — same grid as TheBooks.tsx:65. */}
        <div className="grid grid-cols-2 gap-2 px-3 pt-3 desk:grid-cols-4 desk:gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[4.5rem] rounded-[var(--radius-card)] bg-[var(--n-1)] desk:h-[3.25rem]"
            />
          ))}
        </div>

        {/* The log: one row on phone, the reading column at lg. */}
        <div className="px-3 pt-3 desk:hidden">
          <div className="h-12 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
        </div>
        <div className="hidden flex-1 flex-col gap-2 px-3 pt-3 pb-3 desk:flex">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
          ))}
        </div>

        {/* The deck: ADVANCE MONTH, then the tab bar, both at their real heights
            so nothing jumps when the screen arrives. Fixed on phone exactly as
            the real screen has it, static in the desktop rail. */}
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--hairline)] bg-[var(--bg)] px-3 pt-2 desk:static desk:bg-[var(--surface)]">
          <div className="h-14 rounded-[var(--radius-pill)] bg-[var(--n-1)]" />
          <div className="mx-auto mt-1.5 grid w-full max-w-2xl grid-cols-3 gap-2 pt-1 pb-[max(0.375rem,var(--nv-safe-bottom))] min-[360px]:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-9 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
            ))}
          </div>
        </div>
      </div>

      {/* The life-log rail — the third column, and only ever a column. It is
          `hidden` below the seam exactly as the real <aside> is, so on a phone
          this element occupies nothing and the skeleton is the two-block
          document it has always been. */}
      <div
        aria-hidden="true"
        className="hidden desk:flex desk:h-[calc(100dvh-2.5rem)] desk:flex-col desk:gap-2 desk:overflow-hidden desk:rounded-[var(--radius-card)] desk:bg-[var(--surface)] desk:p-4 desk:shadow-[var(--e2)]"
      >
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-8 shrink-0 rounded-[var(--radius-card)] bg-[var(--n-1)]" />
        ))}
      </div>
    </main>
  );
}
