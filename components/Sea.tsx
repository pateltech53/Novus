import { ISLAND_CAP } from "@/lib/monetization";

/**
 * The ocean the islands sit on — the picture, edge to edge.
 *
 * ── What it is trying to be ────────────────────────────────────────────────
 *
 * A place, not a background. The first version of the picker was a grid of
 * cards with a wave graphic behind it, and a grid with waves behind it is a
 * grid — the islands read as list items that happened to be drawn as islands.
 * The second was the sea in a rounded panel, which is a picture of the sea
 * hanging on a wall. The water is the screen now, and everything else floats on
 * it: the islands, and the one piece of small print, which is in a boat.
 *
 * No corners, therefore. A radius here would put the wall back.
 *
 * ── Why this is four lines instead of a hundred ────────────────────────────
 *
 * It used to draw the sea: a rect of `--sea`, three hand-placed bands of
 * animated swell strokes, then a sky, a horizon haze and four clouds, split
 * across two SVGs because one of them had to keep its aspect ratio and the
 * other had to stretch. All of it was an attempt to arrive at a picture of an
 * ocean. There is a picture of an ocean now, so the drawing is gone.
 *
 * What went with it is worth naming, because it was deliberate and is now
 * simply absent: the swells MOVED, on three durations and three amplitudes, so
 * that the water read as water rather than as a diagram of it. The artwork's
 * waves are still. The motion that remains is `.nv-bob` on the islands
 * themselves — which is the half that mattered, because it is the islands a
 * player is looking at, and it is still stopped by `prefers-reduced-motion`
 * along with everything else. `@keyframes nvSwell` and `.nv-swell` stay in
 * globals.css; nothing uses them today.
 *
 * ── One image, both themes ─────────────────────────────────────────────────
 *
 * Deliberately not two. A night version of the same sea would be a second
 * asset to keep in step with the first, and the islands screen is the one
 * surface in the app that is a PLACE rather than a document — a place does not
 * repaint itself when you change your reading preference. Everything drawn on
 * top of it still themes, and the caption colours were already chosen against
 * water rather than against a page.
 */
export function Sea({ className = "" }: { className?: string }) {
  return (
    <div
      className={className}
      aria-hidden
      style={{
        backgroundImage: "url(/islands/ocean.webp)",
        backgroundSize: "cover",
        backgroundPosition: "center top",
        backgroundRepeat: "no-repeat",
        /* Under the image and never seen, except for the moment before it
           decodes and on the one axis `cover` cannot fill. `--sea` is still the
           water's token everywhere else on this screen, so the fallback is the
           same colour rather than a second opinion about it. */
        backgroundColor: "var(--sea)",
      }}
    />
  );
}

/**
 * Where the water starts, as a fraction of the picture's height.
 *
 * `scripts/build-art.mjs` finds the horizon in the source, crops the sky back
 * until it sits here, and prints the number it achieved. It is duplicated in
 * this one constant because the ISLANDS have to stay under it — `bandY` in the
 * islands page reads it — and a layout that guessed would put half an
 * archipelago in the sky.
 *
 * It holds on screen as long as `cover` is scaling by HEIGHT, which is true for
 * every viewport narrower than the picture's 1.77 aspect: every phone, and any
 * window that is not a letterbox. Wider than that and the horizon rises, which
 * costs nothing — the islands only ever move further below it.
 */
export const HORIZON_PCT = 0.24;

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
