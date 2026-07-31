/**
 * Theme.
 *
 * Light is the default world. Dark is a real, shipped alternative — not an
 * inversion, not a debug flag. Both are considered surfaces and both get looked
 * at before anything ships.
 *
 * `system` follows the OS and is what a first-run player gets, so the app
 * arrives matching the phone they opened it on.
 */

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "novus:theme:v1";

export function loadTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage?.getItem(KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

/**
 * Writes `data-theme` on <html>, which is what globals.css keys off.
 * `system` removes the attribute entirely so the CSS default applies.
 */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (choice === "system") {
    // No attribute → the stylesheet's own default (light) takes over, and a
    // dark-preferring OS is handled by the media query in globals.css.
    el.removeAttribute("data-theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    if (prefersDark) el.setAttribute("data-theme", "dark");
  } else {
    el.setAttribute("data-theme", choice);
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    window.localStorage?.setItem(KEY, choice);
  } catch {
    /* private mode — the choice just does not persist */
  }
  applyTheme(choice);
}

/**
 * Inlined into <head> before first paint.
 *
 * Without this the page paints light, then swaps to dark a frame later — the
 * flash every themed app gets wrong once. It has to be a blocking script, and
 * it has to be small enough to read in one go.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
  var c = localStorage.getItem('${KEY}');
  var d = c === 'dark' || (c !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  if (d) document.documentElement.setAttribute('data-theme','dark');
}catch(e){}})();
`.trim();
