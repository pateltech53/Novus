/**
 * The ocean the islands sit on.
 *
 * ── What it is trying to be ────────────────────────────────────────────────
 *
 * A place, not a background. The first version of the picker was a grid of
 * cards with a wave graphic behind it, and a grid with waves behind it is a
 * grid — the islands read as list items that happened to be drawn as islands.
 * This is the other thing: a body of water with a horizon, a far shore and a
 * near edge, that islands are positioned IN.
 *
 * ── Flat, and deliberately so ──────────────────────────────────────────────
 *
 * No gradient, no blur, no animation. design.md gives real lighting to the
 * stage layer and nothing else, and this is a screen a returning player passes
 * through on every single launch — ambient motion you see four times a day is
 * a tax rather than a delight. Depth comes from what depth came from before
 * photography: things further away are smaller, higher, paler and flatter.
 *
 * The strokes are hand-placed rather than generated. Eight lines that read as
 * water at 320px are worth more than an algorithm producing forty that read as
 * corduroy.
 */
export function Sea({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 400 300"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden
    >
      {/* The water itself. A cool tint mixed off the brand anchor rather than a
          literal blue, so it belongs to this app's palette in both themes. */}
      <rect
        x="0"
        y="0"
        width="400"
        height="300"
        rx="10"
        fill="color-mix(in oklch, var(--color-navy) 14%, var(--surface))"
      />

      {/* Far water: fine, level, close together. Distance flattens waves, and
          packing them tighter toward the top is most of what makes this read
          as a surface receding rather than as a rectangle with squiggles. */}
      <g
        stroke="var(--hairline)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.5"
        vectorEffect="non-scaling-stroke"
      >
        <path d="M18 20 q12 -4 24 0 t24 0" />
        <path d="M126 16 q12 -4 24 0 t24 0" />
        <path d="M262 22 q12 -4 24 0 t24 0" />
        <path d="M340 34 q12 -4 24 0 t24 0" />
        <path d="M56 40 q13 -4 26 0 t26 0" />
        <path d="M196 44 q13 -4 26 0 t26 0" />
        <path d="M300 56 q13 -4 26 0 t26 0" />
        <path d="M14 62 q14 -5 28 0 t28 0" />
        <path d="M150 68 q14 -5 28 0 t28 0" />
      </g>

      {/* Middle water: longer swells, further apart. */}
      <g
        stroke="var(--hairline)"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.7"
        vectorEffect="non-scaling-stroke"
      >
        <path d="M244 92 q18 -7 36 0 t36 0" />
        <path d="M46 104 q19 -7 38 0 t38 0" />
        <path d="M320 122 q19 -7 38 0 t38 0" />
        <path d="M132 134 q20 -7 40 0 t40 0" />
        <path d="M0 148 q20 -7 40 0 t40 0" />
        <path d="M250 160 q21 -8 42 0 t42 0" />
      </g>

      {/* Near water: the biggest swells, the ones with weight. */}
      <g
        stroke="var(--hairline)"
        strokeWidth="2.8"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      >
        <path d="M28 186 q26 -10 52 0 t52 0" />
        <path d="M244 200 q27 -10 54 0 t54 0" />
        <path d="M0 224 q28 -10 56 0 t56 0" />
        <path d="M190 244 q29 -11 58 0 t58 0" />
        <path d="M52 268 q31 -11 62 0 t62 0" />
        <path d="M286 284 q30 -11 60 0 t60 0" />
      </g>

    </svg>
  );
}

/**
 * Where each island sits on the water, as percentages of the sea.
 *
 * Hand-placed for two reasons. Randomness would move an island between visits,
 * and the whole value of a map is that a player builds a memory of it — "mine
 * is the big one at the front" has to stay true. And ten generated points on a
 * small canvas collide; ten chosen ones do not.
 *
 * `depth` scales the island AND is why the ones near the horizon are smaller.
 *
 * The first three are placed to span the whole frame — front-left, mid-right,
 * far-left — rather than clustered at the front. Almost every player has one,
 * two or three companies, and three islands bunched in the near water leave
 * the top half of the sea empty, which reads as a layout that failed to load
 * rather than as open water.
 */
export const SEA_POSITIONS: readonly { x: number; y: number; depth: number }[] = [
  { x: 26, y: 76, depth: 1.0 },
  { x: 68, y: 42, depth: 0.78 },
  { x: 26, y: 17, depth: 0.56 },
  { x: 66, y: 76, depth: 0.88 },
  { x: 44, y: 58, depth: 0.66 },
  { x: 11, y: 44, depth: 0.58 },
  { x: 64, y: 15, depth: 0.48 },
  { x: 90, y: 30, depth: 0.5 },
  { x: 88, y: 62, depth: 0.6 },
  { x: 89, y: 85, depth: 0.54 },
];
