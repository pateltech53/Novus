/**
 * Faces of one colour — the shading maths for flat artwork.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * A drawn object needs three tones to read as a solid thing: the face the
 * light hits, the face it does not, and the body between them. Getting those
 * by hand means writing three colours everywhere one colour is meant, and it
 * means that changing the colour is a three-place edit that will eventually be
 * a two-place edit with a bug in it.
 *
 * So a caller passes ONE colour and gets the set. `IslandGlyph` is the reason
 * it exists: every island draws the same briefcase, and the briefcase colour is
 * what tells two companies apart — so the colour is a variable and everything
 * derived from it has to follow automatically.
 *
 * ── Why color-mix and not a colour library ─────────────────────────────────
 *
 * `color-mix(in oklch, …)` is CSS, which means the browser does the work in a
 * perceptual space and — the part that matters — the input can be ANYTHING CSS
 * accepts: a hex, a token like `var(--case)`, an oklch triple. A JS colour
 * library would have to parse it, and would therefore not accept the tokens
 * that half this codebase's colours actually are.
 *
 * oklch rather than sRGB because lightening in sRGB washes the hue out: a
 * navy briefcase mixed toward white in sRGB goes chalky grey, in oklch it goes
 * to a lighter navy, which is what light landing on navy looks like.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 *
 * These are STEPS, never gradients. design.md §1.4 keeps a ledger of exactly
 * three gradients in the whole app and says to count them before calling a
 * phase done; three flat fills side by side read as a lit form without joining
 * that list. Nothing here emits a gradient and nothing here should start.
 */

/** Toward white. `amount` is how much light lands, 0–1. */
export const lit = (color: string, amount = 0.22): string =>
  `color-mix(in oklch, white ${Math.round(amount * 100)}%, ${color})`;

/** Toward black. The face turned away from the light. */
export const shade = (color: string, amount = 0.26): string =>
  `color-mix(in oklch, black ${Math.round(amount * 100)}%, ${color})`;

/** Toward another colour — for a tint that borrows from its surroundings. */
export const mix = (color: string, into: string, amount = 0.5): string =>
  `color-mix(in oklch, ${into} ${Math.round(amount * 100)}%, ${color})`;

/** A colour at partial opacity, without touching its hue. */
export const fade = (color: string, alpha: number): string =>
  `color-mix(in oklch, ${color} ${Math.round(alpha * 100)}%, transparent)`;

/**
 * The three faces of one solid form.
 *
 * `body` is the colour as given, so a caller who wants exactly the colour they
 * passed gets exactly it — the derivation only ever adds tones around it,
 * never replaces it with an approximation.
 */
export interface Faces {
  lit: string;
  body: string;
  shade: string;
}

export const facesOf = (color: string): Faces => ({
  lit: lit(color),
  body: color,
  shade: shade(color),
});

/**
 * A stable colour per company, from the palette below.
 *
 * ── Why a palette and not a hue rotation ───────────────────────────────────
 *
 * Rotating hue by the seed is one line and produces the full spectrum,
 * including the parts of it that have no business on this screen: an acid
 * yellow-green briefcase, a hot pink one. The palette is eight colours that
 * all belong to the same object — leathers, canvases and hard cases a real
 * briefcase is actually made in — so two companies are told apart without one
 * of them looking like a mistake.
 *
 * Written as oklch triples rather than tokens because these are ARTWORK, not
 * interface: they must be the same colour in both themes, the way a real
 * object is the same colour in daylight and at dusk. The light around them
 * changes — that is what `lit`/`shade` above are for — and they do not.
 *
 * `>>> 5` before the modulo, not the raw seed: run seeds come out of
 * `hashString`, which mixes well but is often looked at alongside sequential
 * slot numbers, and dropping the low bits keeps two neighbouring values from
 * landing on neighbouring colours.
 *
 * ── Why the UNSIGNED shift, specifically ───────────────────────────────────
 *
 * `hashString` returns `h >>> 0` — a full unsigned 32-bit number, so better
 * than half of all seeds are ≥ 2³¹. `>>` is the SIGNED shift: it reads those
 * as negative, `% 8` in JavaScript keeps the sign, and `CASE_COLOURS[-3]` is
 * `undefined`. That is not a wrong colour, it is no colour at all — the glyph
 * root carries `fill="none"`, `fill` is an inherited presentation attribute,
 * and an omitted fill therefore inherits it. The briefcase vanished on roughly
 * half of all companies while its gold clasp kept drawing, which is exactly as
 * confusing as it sounds. `>>>` keeps it unsigned.
 */
export const CASE_COLOURS: readonly string[] = [
  "oklch(0.360 0.014 260)", // graphite — the default, and the one in the artwork
  "oklch(0.420 0.075 40)", // tan leather
  "oklch(0.380 0.070 25)", // oxblood
  "oklch(0.400 0.058 250)", // navy
  "oklch(0.430 0.062 160)", // racing green
  "oklch(0.500 0.030 90)", // olive canvas
  "oklch(0.340 0.040 300)", // aubergine
  "oklch(0.560 0.045 230)", // steel
];

export const caseColourFor = (seed: number): string =>
  CASE_COLOURS[(Math.abs(Math.trunc(seed)) >>> 5) % CASE_COLOURS.length] ?? CASE_COLOURS[0];
