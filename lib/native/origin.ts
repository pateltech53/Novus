import { isNative } from "@/lib/native/platform";

/**
 * Where the server half lives.
 *
 * The bundled app is a static export with no server behind it, so the four
 * routes that need one — session, sync, billing status, billing checkout —
 * are called at their real origin instead of relatively. On the web this
 * function is the identity: a relative path stays relative, which keeps
 * preview deploys and localhost talking to themselves.
 *
 * `NEXT_PUBLIC_API_ORIGIN` is read at build time so the shipped binary has no
 * runtime configuration step and no way to be pointed somewhere else.
 *
 * **It must be the canonical host, with no redirect in front of it.** The
 * default was `novuspitch.com`, which 308s to `www.` — and a browser does not
 * follow redirects on a CORS preflight, so every call from the app failed
 * before it was sent. A redirect here is not a slower path, it is a broken one.
 */
const ORIGIN = (process.env.NEXT_PUBLIC_API_ORIGIN || "https://www.novuspitch.com").replace(/\/$/, "");

/**
 * The same host, as an absolute URL, for the places that must leave the app
 * entirely rather than call into it — the purchase link opens this in the
 * player's browser, where a relative path would resolve against
 * `capacitor://localhost` and go nowhere.
 */
export const WEB_ORIGIN = ORIGIN;

export function apiUrl(path: string): string {
  if (!isNative()) return path;
  return `${ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Cross-origin from the app's own scheme, so the session cookie only travels
 * when it is asked for explicitly. Same-origin on the web, where this is the
 * default anyway and stating it costs nothing.
 */
export const API_CREDENTIALS: RequestCredentials = "include";
