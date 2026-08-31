import { isNative } from "@/lib/native/platform";

/**
 * Is this document being served off the device, by Capacitor's own file
 * server? That — not "is this the app" — is what decides whether the
 * index.html rule below applies, and the two stopped being the same thing
 * when the shell went remote (capacitor.config.ts): a page loaded from
 * https://www.novuspitch.com inside the app is answered by the real Next
 * server, which resolves routes, and suffixing "/index.html" onto a route
 * there is a 404, not a fix.
 *
 * iOS serves the bundle over the `capacitor:` scheme, which no browser and no
 * remote page is ever on. Android serves it over https at the one hostname
 * capacitor.config.ts reserves for the local server, so the hostname is the
 * tell there — the remote shell runs at www.novuspitch.com.
 */
function bundledShell(): boolean {
  if (typeof window === "undefined" || !isNative()) return false;
  if (window.location.protocol === "capacitor:") return true;
  return window.location.hostname === "app.novuspitch.com";
}

/**
 * A path the iOS shell can actually resolve.
 *
 * ── The rule, from the shell's own source ───────────────────────────────────
 *
 * Every navigation in the app is served by `WebViewAssetHandler`, which hands
 * the path to `CapacitorRouter.route(for:)`. That function is nine lines long
 * and the whole of this file exists because of four of them:
 *
 *     if pathUrl.pathExtension.isEmpty {
 *         return basePath + "/index.html"
 *     }
 *     return basePath + path
 *
 * A path with no file extension does not resolve to that directory's
 * index.html. It resolves to **the index.html at the root of the bundle** —
 * the shell assumes a single-document SPA, which is what almost every
 * Capacitor app is and what this one is not. The export is a separate document
 * per route, and the document at the root is the marketing page.
 *
 * So `/play/` did not load the play screen. It loaded the landing page, as did
 * `/found/`, `/welcome/`, and every other extensionless path — including the
 * one `boot.html` redirected to on launch. The app opened on a marketing page
 * carrying an account gate, and CONTINUE AS navigated to `/play/`, which
 * served the same landing page again: a loop between a screen and itself, with
 * no wrong code anywhere in it.
 *
 * It was believed to work the other way round. `SettingsScreen` said so in a
 * comment — "the app's file server resolves a route by finding its
 * index.html, so it needs the trailing slash" — and the trailing slash is
 * precisely what triggers this. The belief was never tested against the shell,
 * only against a Node server written to serve the export the way the shell was
 * assumed to.
 *
 * ── What to do about it ─────────────────────────────────────────────────────
 *
 * Name the file. `/play/index.html` has an extension, so the router returns it
 * untouched and the right document loads.
 *
 * This applies to **document navigations only** — anything that goes through
 * `window.location`. A client-side `router.push` never reaches the scheme
 * handler: Next swaps the page in place and fetches chunks, which have `.js`
 * extensions and resolve fine. That asymmetry is why some routes in the app
 * worked and others could not.
 */
export function appPath(route: string): string {
  if (!bundledShell()) return route;
  // Already a file, or already fixed. Do not append twice.
  if (/\.[a-z0-9]+$/i.test(route)) return route;
  return `${route.replace(/\/$/, "")}/index.html`;
}
