import { NextResponse, type NextRequest } from "next/server";
import { isNativeOrigin } from "@/lib/native/origins";

/**
 * CORS for the shipped app, and for nothing else.
 *
 * ── The bug this fixes ──────────────────────────────────────────────────────
 *
 * The iOS and Android builds serve their bundle from `app.novuspitch.com`
 * under `capacitor://` and `https://`, while the route handlers live at the
 * real origin. Every call the app makes is therefore cross-origin, carries
 * `content-type: application/json` and asks for credentials — which means the
 * browser sends a preflight `OPTIONS` first and refuses to send the real
 * request unless that preflight comes back with permission.
 *
 * Nothing here answered that. A preflight got a bare 204 with no
 * `Access-Control-Allow-Origin`, so the browser blocked the call before it was
 * ever sent, and the app reported a network error while the same code worked
 * perfectly in a browser tab — where it is same-origin and no preflight
 * happens at all. That asymmetry is why it survived every check that ran on
 * the web build.
 *
 * ── Why the allow-list, and why not `*` ─────────────────────────────────────
 *
 * These requests carry the session cookie, and `Access-Control-Allow-Origin: *`
 * is invalid with credentials — the browser rejects it. The origin has to be
 * echoed back exactly, which means deciding whether we trust it. Only the two
 * origins we ship ourselves are echoed; every other site gets no CORS headers
 * and is blocked exactly as before.
 *
 * `Vary: Origin` is not optional. Without it a CDN can serve a response cached
 * for one origin to another, which turns an allow-list into a hole.
 *
 * This is the transport half. The CSRF half — deciding whether a request that
 * did arrive is allowed to act — stays in `crossSite()` in lib/supabase/route.ts,
 * and reads the same list.
 */

const ALLOWED_HEADERS = "content-type";
const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");

  // Not the app: leave the response completely untouched. Same-origin browser
  // traffic needs no CORS headers and must not start carrying any.
  if (!isNativeOrigin(origin)) return NextResponse.next();

  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };

  // The preflight is answered here rather than by each route: a route handler
  // that forgets its OPTIONS export fails as a network error with no clue
  // attached, and there are fourteen of them.
  if (req.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": ALLOWED_METHODS,
        "Access-Control-Allow-Headers": ALLOWED_HEADERS,
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const res = NextResponse.next();
  for (const [key, value] of Object.entries(cors)) res.headers.set(key, value);
  return res;
}

/** Only the server routes. Pages are never fetched cross-origin by the app —
 *  it ships its own copy of them. */
export const config = {
  matcher: "/api/:path*",
};
