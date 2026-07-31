/**
 * Brand constants for consumers that cannot read a CSS custom property.
 *
 * three.js materials and lights, and Next's viewport metadata, are evaluated
 * outside the cascade — `var(--action)` is meaningless to them. Everything that
 * CAN read CSS uses the tokens in app/globals.css; this file exists so the
 * handful that cannot still reference a name instead of retyping a hex.
 *
 * Values are locked by Brand Identity v2. Do not add to this file to dodge the
 * no-inline-colour rule — if a component can read CSS, it must use a token.
 */

/** The action orange. Used as the mascot's rim light. */
export const BRAND_ACTION = "#FF6B00";

/** The brand anchor navy. */
export const BRAND_NAVY = "#0B1E36";

/** Neutral white, for a three.js material with no Closet tint applied. */
export const NEUTRAL_WHITE = "#FFFFFF";

/**
 * Browser chrome colour, matching --n-1 in each theme so there is no flash of
 * a different ground behind the status bar on an installed PWA.
 */
export const THEME_COLOR_DARK = "#1c1d21";
export const THEME_COLOR_LIGHT = "#f6f7f9";
