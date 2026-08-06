import type { CSSProperties } from "react";

import { ISLAND_CAP } from "@/lib/monetization";

/**
 * The ocean the islands sit on.
 *
 * ── What it is trying to be ────────────────────────────────────────────────
 *
 * A place, not a background. The first version of the picker was a grid of
 * cards with a wave graphic behind it, and a grid with waves behind it is a
 * grid — the islands read as list items that happened to be drawn as islands.
 * The second was the sea in a rounded panel, which is a picture of the sea
 * hanging on a wall. This is the third and the right one: the water is the
 * screen, edge to edge, and everything else floats on it — the islands, and
 * the one piece of small print, which is in a boat.
 *
 * No corners, therefore. A radius here would put the wall back.
 *
 * ── Flat, but not still ────────────────────────────────────────────────────
 *
 * No gradient and no blur: design.md gives real lighting to the stage layer
 * and nothing else, so depth here comes from what depth came from before
 * photography — things further away are smaller, higher, paler and flatter.
 *
 * It does move, and the movement is the whole reason it reads as water rather
 * than as a diagram of water. Three bands, three durations, three amplitudes,
 * because the one thing that would ruin it is agreement: waves that swell in
 * unison are a comb. The near band travels furthest and fastest, which is the
 * same parallax rule as the sizes.
 *
 * The amplitudes are single digits over ten-odd seconds on purpose. A player
 * is on this screen for a few seconds several times a day, and ambient motion
 * that draws the eye a SECOND time is a fidget. `prefers-reduced-motion` stops
 * all of it — see the blanket rule in globals.css — and nothing is lost when
 * it does, because the sea carries no information.
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
      {/* The water itself.
          `--sea` and `--sea-crest` are a pair, per theme, in globals.css. This
          used to be `--color-navy` mixed 14% into `--surface`, with the swells
          drawn in `--hairline` — which in light mode is a grey at L 0.85 with
          crests three points of lightness away from it. The sea was the whole
          screen and the whole screen was unlit. Water is a colour; a crest is
          the light on it; the crest is always the brighter of the two. */}
      <rect x="0" y="0" width="400" height="300" fill="var(--sea)" />

      {/* Far water: fine, level, close together. Distance flattens waves, and
          packing them tighter toward the top is most of what makes this read
          as a surface receding rather than as a rectangle with squiggles. */}
      <g
        stroke="var(--sea-crest)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.5"
        vectorEffect="non-scaling-stroke"
        className="nv-swell"
        style={{ "--nv-swell-dur": "14s", "--nv-swell-x": "3px" } as CSSProperties}
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
        stroke="var(--sea-crest)"
        strokeWidth="2.1"
        strokeLinecap="round"
        opacity="0.7"
        vectorEffect="non-scaling-stroke"
        className="nv-swell"
        style={
          { "--nv-swell-dur": "10.5s", "--nv-swell-x": "6px", "--nv-swell-y": "1.5px" } as CSSProperties
        }
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
        stroke="var(--sea-crest)"
        strokeWidth="2.8"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="nv-swell"
        style={
          { "--nv-swell-dur": "7.5s", "--nv-swell-x": "10px", "--nv-swell-y": "2.5px" } as CSSProperties
        }
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
 *
 * Two lanes are kept clear, because two things share this water with the
 * islands: the title along the top edge, and the boat carrying the small
 * print at the bottom. Nothing sits above y=13 or below y=72.
 *
 * Nothing sits past x=87 either. The name under an island is a fixed 13ch
 * column centred on it, so an island close enough to the edge to fit is still
 * one whose CAPTION gets clipped — and the caption is the part that says which
 * company it is. That margin is in label widths, not island widths, so it does
 * not move when BASE_SIZE does.
 */
export const SEA_POSITIONS: readonly { x: number; y: number; depth: number }[] = [
  { x: 27, y: 57, depth: 1.0 },
  { x: 71, y: 34, depth: 0.78 },
  { x: 23, y: 19, depth: 0.56 },
  { x: 66, y: 62, depth: 0.86 },
  { x: 45, y: 44, depth: 0.64 },
  { x: 9, y: 38, depth: 0.56 },
  { x: 56, y: 13, depth: 0.46 },
  { x: 87, y: 22, depth: 0.48 },
  { x: 87, y: 52, depth: 0.58 },
  { x: 40, y: 71, depth: 0.52 },
];

/**
 * Where island N sits — the authored ten, then the water behind them.
 *
 * ── Why this function exists ───────────────────────────────────────────────
 *
 * The table above has exactly ten entries because ten was the whole cap, and
 * the picker read it as `SEA_POSITIONS[slot]`. 0015 moved the cap to 50, which
 * turned that read into `undefined` for slot 10 and the next line —
 * `style={{ left: `${spot.x}%` }}` — into a TypeError. Not a layout that
 * degrades: the islands screen throws, for exactly the player who bought the
 * most islands.
 *
 * ── What is generated, and what is not ─────────────────────────────────────
 *
 * The first ten are untouched, so every player who has ever seen this screen
 * finds their archipelago where they left it. That is the point of hand-
 * placing them and the reason the header above gives for not generating: a map
 * is worth having because you build a memory of it.
 *
 * Past ten the same argument runs the other way. Forty more hand-placed points
 * on this canvas is not art direction, it is a lookup table nobody can verify,
 * and a player at 30 islands has stopped memorising anything anyway. So they
 * are generated — deterministically, which is the property that actually
 * mattered in "randomness would move an island between visits". Island 23 is
 * at the same place on every device, every visit, forever.
 *
 * A golden-angle spiral, because it is the arrangement that does not clump:
 * successive points land at 137.5°, so no two neighbours share a direction and
 * the density stays even as the radius grows. `sqrt` on the radius spreads
 * them by AREA rather than by radius, which is what keeps the middle from
 * filling up first.
 *
 * ── The box it stays inside ────────────────────────────────────────────────
 *
 * Exactly the one the header above describes, and for its reasons: nothing
 * above y=13 or below y=72 (the title's lane and the boat's), nothing outside
 * x=9..87 (the 13ch caption under an island is what clips first, not the
 * island). Depth runs 0.50 → 0.34, below the authored minimum of 0.46, so
 * generated islands read as the far water behind the placed ones.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function seaPosition(slot: number): { x: number; y: number; depth: number } {
  const authored = SEA_POSITIONS[slot];
  if (authored) return authored;

  const i = Math.max(0, slot - SEA_POSITIONS.length);
  // Normalised against the number of generated places there can be, so the
  // spread fills the water whatever ISLAND_CAP becomes rather than bunching
  // into a disc sized for the old one.
  const spread = Math.max(1, ISLAND_CAP - SEA_POSITIONS.length);
  /*
   * Starts at 0.55 rather than at 0, so island 11 goes to open water.
   *
   * A spiral from the middle put the first generated islands exactly where the
   * authored ones already are — the ten are placed across the whole frame, and
   * the centre is the fullest part of it. Beginning in the outer band means the
   * eleventh company, which is the one a player who has just bought an island
   * is looking for, lands somewhere it can be seen.
   */
  const r = 0.55 + 0.45 * Math.min(1, Math.sqrt((i + 1) / spread));
  const angle = i * GOLDEN_ANGLE;

  // One decimal: enough to separate two points a percent apart, short enough
  // that the inline style stays readable in devtools.
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    x: round(48 + Math.cos(angle) * r * 39),
    y: round(42.5 + Math.sin(angle) * r * 29.5),
    depth: round(0.5 - r * 0.16),
  };
}
