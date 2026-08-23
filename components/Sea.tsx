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
 * ── The horizon, which it did not have ─────────────────────────────────────
 *
 * It was a single `<rect fill="--sea">` with swells on it, and a rectangle of
 * water with no edge to it is not an ocean — it is a blue floor. Every island
 * on it was a shape on a colour. So there is sky now, and a horizon where the
 * two meet, and clouds in the sky: three cues that cost nothing and turn the
 * same flat colour into distance.
 *
 * The sky is a NARROW band — the top twelfth, not the top third a photograph
 * would give it — and that is a constraint rather than a taste. The picker
 * places islands from 10% of the field downward (`bandY` in the islands page),
 * so anything above roughly a tenth is the only space that can be sky without
 * an island floating in it. A thin strip is also what you get looking at the
 * sea from close to it, which is where the player is standing.
 *
 * The haze band under the horizon is what sells it. Water meeting sky at a
 * hard line reads as two rectangles stacked; a pale strip between them reads
 * as air over distance.
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
    <div className={className} aria-hidden>
      {/*
        ── Two layers, because they cannot share a viewBox ────────────────────

        The water is drawn with `preserveAspectRatio="none"`, which is right for
        it: a swell is a horizontal line and stretching one vertically on a tall
        phone just makes a slightly taller swell. It is catastrophic for
        anything ROUND. The first version of this put the clouds in the same
        SVG, and at 393×852 the vertical scale is nearly three times the
        horizontal one — so every cloud came out as a tall grey lozenge that
        read as a rock formation hanging over the sea.

        A nested `<svg>` does not fix it: its viewport is still transformed by
        the outer non-uniform matrix. The only thing that does is a second
        element with its own CSS box, which is what the sky band below is.

        `SKY_PCT` is shared between them so the horizon in one lands exactly on
        the bottom edge of the other. Change it in one place or the sea grows a
        seam.
      */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
        fill="none"
      >
        {/* The water itself.
          `--sea` and `--sea-crest` are a pair, per theme, in globals.css. This
          used to be `--color-navy` mixed 14% into `--surface`, with the swells
          drawn in `--hairline` — which in light mode is a grey at L 0.85 with
          crests three points of lightness away from it. The sea was the whole
          screen and the whole screen was unlit. Water is a colour; a crest is
          the light on it; the crest is always the brighter of the two. */}
      <rect x="0" y={SKY} width="400" height={300 - SKY} fill="var(--sea)" />

      {/* The haze at the horizon — the pale strip that turns a seam into
          distance. Flat, not a gradient: design.md §1.4 keeps a ledger of
          exactly three gradients in the app and this is not one of them. Two
          bands of falling opacity do the same job at this size.

          Kept faint on purpose. At full strength it stopped reading as air and
          started reading as a toolbar behind the screen's title, which is the
          one thing a horizon must not look like. */}
      {[
        [0, 3, 0.3],
        [3, 4, 0.16],
        [7, 6, 0.08],
        [13, 8, 0.04],
        [21, 11, 0.02],
      ].map(([dy, h, o]) => (
        <rect
          key={dy}
          x="0"
          y={SKY + dy}
          width="400"
          height={h}
          fill="var(--sky-haze)"
          opacity={o}
        />
      ))}

      {/* Far water: fine, level, close together. Distance flattens waves, and
          packing them tighter toward the top is most of what makes this read
          as a surface receding rather than as a rectangle with squiggles.

          The whole band moved DOWN when the horizon arrived: its first strokes
          used to sit at y=16, which is now sky. */}
      <g
        stroke="var(--sea-crest)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.5"
        vectorEffect="non-scaling-stroke"
        className="nv-swell"
        style={{ "--nv-swell-dur": "14s", "--nv-swell-x": "3px" } as CSSProperties}
      >
        <path d="M18 44 q12 -4 24 0 t24 0" />
        <path d="M126 42 q12 -4 24 0 t24 0" />
        <path d="M262 45 q12 -4 24 0 t24 0" />
        <path d="M340 50 q12 -4 24 0 t24 0" />
        <path d="M56 54 q13 -4 26 0 t26 0" />
        <path d="M196 57 q13 -4 26 0 t26 0" />
        <path d="M300 63 q13 -4 26 0 t26 0" />
        <path d="M14 68 q14 -5 28 0 t28 0" />
        <path d="M150 74 q14 -5 28 0 t28 0" />
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

      {/*
        ── The sky ────────────────────────────────────────────────────────────

        Its own box, its own aspect ratio, so a cloud stays a cloud. `slice`
        rather than `meet`: the band is far wider than it is tall on a phone, so
        the drawing is scaled to cover and the ends of it are cropped, which is
        what you want from a sky — cropping loses some cloud, letterboxing would
        leave a stripe of nothing above it.

        A NARROW band, and that is a constraint rather than a taste. The picker
        places islands from 10% of the field downward (`bandY` in the islands
        page), so anything much past a tenth is space an island can end up
        floating in. It is also what you actually see looking at the sea from
        close to it, which is where the player is standing.
      */}
      <svg
        className="absolute inset-x-0 top-0 w-full"
        style={{ height: `${SKY_PCT}%` }}
        /* The viewBox is roughly the aspect the band actually gets on a phone
           (393 × ~77), NOT a convenient round number. `slice` scales to cover,
           so a 10:1 viewBox in a 5:1 box would be scaled 2× and two of the
           three clouds would be cropped off the sides — which is exactly what
           the first attempt did. */
        viewBox="0 0 400 76"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <rect x="0" y="0" width="400" height="76" fill="var(--sky)" />

        {/* Clouds, flat and few.
            A bar with three circles sitting on it is the entire shape, and it
            is all that survives at the size this band gets on a phone. Placed
            off-centre, at three sizes and three heights: two clouds the same
            size at the same height is wallpaper, not weather. */}
        <g fill="var(--cloud)">
          <g opacity="0.9">
            <rect x="22" y="26" width="44" height="10" rx="5" />
            <circle cx="35" cy="25" r="8.5" />
            <circle cx="49" cy="21.5" r="10.5" />
            <circle cx="61" cy="25.5" r="7" />
          </g>
          <g opacity="0.6">
            <rect x="176" y="41" width="30" height="7" rx="3.5" />
            <circle cx="186" cy="40" r="6" />
            <circle cx="197" cy="38.5" r="7" />
          </g>
          <g opacity="0.8">
            <rect x="298" y="20" width="52" height="11" rx="5.5" />
            <circle cx="312" cy="19" r="9.5" />
            <circle cx="328" cy="15.5" r="11.5" />
            <circle cx="343" cy="19.5" r="7" />
          </g>
          <g opacity="0.45">
            <rect x="112" y="53" width="26" height="6" rx="3" />
            <circle cx="121" cy="52" r="5" />
            <circle cx="130" cy="51" r="6" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/**
 * How much of the screen is sky, as a percentage — the ONE number the two
 * layers above have to agree on.
 *
 * The water SVG puts its horizon at `SKY` in its own 300-unit viewBox and the
 * sky band is `SKY_PCT` of the container's height. They are the same line
 * expressed twice, so they are derived from each other rather than typed
 * twice: get this wrong and the sea grows a visible seam at the join.
 */
const SKY = 27;
const SKY_PCT = (SKY / 300) * 100;

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
