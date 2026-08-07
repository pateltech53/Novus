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
  // screen 0 — the archipelago you know, one phone wide.
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
 * Where island N sits — the authored ten, then the water past them.
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
 * ── What `screen` is, and why the answer is not one number ─────────────────
 *
 * The first fix generated the extra forty as a golden-angle spiral inside the
 * SAME box as the authored ten, on the theory that a spiral does not clump.
 * A spiral does not clump against itself. It knows nothing about the ten points
 * already on the water, and it landed on them: island 11 came out at (29.3,
 * 55.5) against island 0's (27, 57) — measured 21px apart on a phone, under
 * captions that are 13 characters wide. Two companies drawn on top of each
 * other, with their names overlapping.
 *
 * And it could not be fixed by spacing alone. That box is 78 by 59 percent;
 * fifty points inside it with enough room for their captions is not a packing
 * problem, it is an impossible one. Something had to give and it was never
 * going to be the caption.
 *
 * So the water gets longer instead. `screen` is which phone-width of sea the
 * island is on: the authored ten keep screen 0 and their exact coordinates —
 * every player who has seen this screen finds their archipelago where they left
 * it — and everything past them is drawn on new water, four to a screen, which
 * the picker scrolls sideways through.
 *
 * ── How the new water is laid out ──────────────────────────────────────────
 *
 * Four lanes across, alternating near and far so that two islands sharing a
 * screen are never at the same height: the lane sets the band, the golden angle
 * jitters within it. That is what makes the spacing provable rather than hoped
 * for — adjacent lanes are 19% of a screen apart horizontally AND at least 16%
 * of the band apart vertically, so the closest generated pair is looser than
 * the closest AUTHORED pair, which has been on screen since this shipped.
 *
 * Deterministic, which is the property that actually mattered in "randomness
 * would move an island between visits". Island 23 is at the same place on every
 * device, every visit, forever — and founding island 24 does not move it.
 *
 * ── The box each screen stays inside ───────────────────────────────────────
 *
 * y=13..72 as before (the title's lane and the boat's — the picker measures
 * both and stretches this band across what is left), and x=20..81 within a
 * screen, tighter than the authored 9..87 because a generated island has water
 * on both sides of it rather than a screen edge.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Islands per screen of new water. Four lanes, 19% of a screen apart. */
const PER_NEW_SCREEN = 4;

export interface SeaSpot {
  /** Which phone-width of water this is on. The authored ten are all 0. */
  screen: number;
  /** Percent across THAT screen. */
  x: number;
  /** Percent down the band, before the picker stretches it. */
  y: number;
  depth: number;
}

/**
 * How wide the water has to be for `places` islands, as a percentage of one
 * screen. 100 means it fits, and it fits for every player with ten or fewer.
 *
 * Measured from the islands actually drawn rather than rounded up to whole
 * screens. Rounding up gave fifteen places three full screens, and the third
 * held one locked place in an otherwise empty ocean — a page of nothing, which
 * reads as a screen that failed to load rather than as open water. The margin
 * is for the 13ch caption hanging off the last island, not for the island.
 */
export function seaFieldWidth(places: number): number {
  let far = 0;
  for (let slot = 0; slot < places; slot++) {
    const spot = seaPosition(slot);
    far = Math.max(far, spot.screen * 100 + spot.x);
  }
  return Math.max(100, Math.round(far + 18));
}

export function seaPosition(slot: number): SeaSpot {
  const authored = SEA_POSITIONS[slot];
  if (authored) return { screen: 0, ...authored };

  const i = Math.min(ISLAND_CAP, Math.max(0, slot - SEA_POSITIONS.length));
  const screen = 1 + Math.floor(i / PER_NEW_SCREEN);
  const lane = i % PER_NEW_SCREEN;
  const angle = i * GOLDEN_ANGLE;
  /* Lanes 0 and 2 ride the near band, 1 and 3 the far one — so neighbours in a
     row are never at the same height and never the same size. */
  const near = lane % 2 === 0;

  // One decimal: enough to separate two points a percent apart, short enough
  // that the inline style stays readable in devtools.
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    screen,
    x: round(22 + lane * 19 + Math.cos(angle) * 2),
    y: round((near ? 30 : 58) + Math.sin(angle) * 6),
    /* Paler and flatter the further out, so the new water reads as distance
       rather than as a second copy of the first screen. */
    depth: round(Math.max(0.32, (near ? 0.54 : 0.44) - (screen - 1) * 0.015)),
  };
}
