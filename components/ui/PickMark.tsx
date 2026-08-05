/**
 * The dot that says "this is the one you chose".
 *
 * ── Why a shape and not just a tint ─────────────────────────────────────────
 *
 * Four screens ask the player to pick one of two things — who is founding the
 * company, which industry, monthly or yearly, on the plans step and again in
 * both upgrade surfaces — and every one of them used to answer with a tint and
 * nothing else. A tint is a comparison: it only exists if you can see both
 * options at once and know which of the two is lighter. That is a lot to ask of
 * a 16% wash on a phone in daylight, and it is impossible to ask of anyone
 * reading one card at a time.
 *
 * So the state gets a shape as well. Empty ring, then a filled disc with a
 * tick — the oldest "chosen" glyph there is, and one that survives being
 * photocopied, dimmed, or looked at by someone who cannot separate the two
 * greys. `.nv-pick` in globals.css carries the material half of the same state.
 *
 * ── The colours ────────────────────────────────────────────────────────────
 *
 * Label ink for the disc and the app ground for the tick, so it inverts with
 * the theme without a second token: near-white on graphite in dark, near-black
 * on warm white in light. Deliberately not the accent — §1.5 spends that on the
 * one control per screen that asks you to act, and answering a question is not
 * acting.
 */
export function PickMark({
  on,
  size = 20,
  className = "",
}: {
  on: boolean;
  /** 20px on cards, 18px where it sits beside a single line of text. */
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-[var(--radius-pill)] transition-colors ${
        on
          ? "bg-[var(--text-primary)]"
          : "ring-1 ring-inset ring-[var(--hairline)]"
      } ${className}`}
    >
      {on && (
        <svg
          width={size * 0.55}
          height={size * 0.55}
          viewBox="0 0 11 11"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 5.7 4.4 8.2 9 2.6"
            stroke="var(--bg)"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
