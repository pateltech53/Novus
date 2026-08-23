import type { StageNum } from "@/lib/engine/types";

/**
 * An island — the picture, not a drawing of it.
 *
 * ── What this replaced, and why twice ──────────────────────────────────────
 *
 * First it was a diagram: two flat rings of sea-crest for water, a green
 * ellipse for land, a stroked palm, grey rectangles for a skyline. Then it was
 * the same idea rebuilt in stepped flat fills, which read as an island but
 * still read as *drawn*. It is now the rendered artwork the product was
 * designed around, keyed out of its source and shipped as one small webp per
 * briefcase colour.
 *
 * ── The briefcase is still the variable ────────────────────────────────────
 *
 * It is what tells two companies apart on the water, and in a raster that
 * cannot be a CSS colour: a filter would take the palm and the sand with it.
 * So `scripts/build-art.mjs` cuts the briefcase out of the source by
 * connectivity and retints it eight times at build time, preserving each
 * pixel's own luminance so the lid stays lighter than the body and the gold
 * clasp — saturated, therefore never in the mask — stays gold. This picks one
 * by seed, or by an explicit `caseColour` index a caller passes.
 *
 * ── What it no longer encodes, said plainly ────────────────────────────────
 *
 * The drawn glyph put a skyline on the sand, one more building per stage. That
 * was the one place a player could read progress across the whole archipelago
 * without opening anything, and it is gone: a flat SVG skyline standing on a
 * rendered clay island reads as a sticker, and there is no honest way to draw
 * one into a photograph at eight sizes. `stage` is still accepted so callers do
 * not have to care, and the stage itself is still on screen in words — the
 * caption under every island carries its YEAR, and the gallery carries the
 * stage by name.
 *
 * ── The contract with the screen ───────────────────────────────────────────
 *
 * `ISLAND_ASPECT` is the source art's, and `SeaEmpty`/`SeaLocked` in the
 * islands page reserve the same box — so founding a company changes the shape
 * on the water without reflowing the scene. `aria-hidden`, because the company
 * name and its status are already text beside this.
 *
 * Drawn at ~24px at the far edge of the map and ~236px in the gallery. One
 * 512px source covers both; `loading="eager"` because these are the content of
 * the screen rather than something below a fold, and a lazy island pops in
 * after the bob has already started.
 */

/** Height ÷ width of the keyed artwork. The palm is what makes it tall. */
export const ISLAND_ASPECT = 512 / 448;

/** How many briefcase variants `scripts/build-art.mjs` writes. */
export const CASE_VARIANTS = 8;

/** Which briefcase this company carries. Exported so a test can assert it. */
export function caseVariantFor(seed: number): number {
  /*
   * `>>> 5`, unsigned, and both halves matter. Run seeds come out of
   * `hashString` as full unsigned 32-bit values, so the SIGNED shift reads over
   * half of them as negative and `% 8` in JavaScript keeps the sign — which
   * used to index the palette out of bounds and draw no briefcase at all.
   * Dropping the low bits keeps two neighbouring seeds off two neighbouring
   * colours.
   */
  return (Math.abs(Math.trunc(seed)) >>> 5) % CASE_VARIANTS;
}

export function IslandGlyph({
  alive,
  seed = 0,
  size = 76,
  caseColour,
  className = "",
}: {
  /** Accepted and no longer drawn — see the note above. */
  stage?: StageNum;
  alive: boolean;
  /** Any stable number for this company. Chooses the briefcase. */
  seed?: number;
  size?: number;
  /** Force a briefcase variant, 0…7. Defaults to one derived from `seed`. */
  caseColour?: number;
  className?: string;
}) {
  const variant = caseColour ?? caseVariantFor(seed);

  return (
    <img
      src={alive ? `/islands/island-${variant}.webp` : "/islands/island-ended.webp"}
      alt=""
      aria-hidden
      loading="eager"
      decoding="async"
      width={Math.round(size)}
      height={Math.round(size * ISLAND_ASPECT)}
      className={`block select-none ${className}`}
      style={{ width: size, height: size * ISLAND_ASPECT }}
      draggable={false}
    />
  );
}
