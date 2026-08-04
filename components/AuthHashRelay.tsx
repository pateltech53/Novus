"use client";

import { useEffect, useRef } from "react";

import { readInviteName } from "@/lib/auth/invite";

/**
 * The catch for an auth link that landed on the front door.
 *
 * ── The failure this exists for ───────────────────────────────────────────
 *
 * Supabase only redirects to URLs on its allow-list (Authentication → URL
 * Configuration). When a link asks for one that is not on it, GoTrue does not
 * fail loudly — it sends the visitor to the **Site URL** instead, with the
 * session still in the fragment. So a chapter invite on a project whose
 * allow-list has not been updated does not show an error: the student lands on
 * the marketing page, sees a landing page, and the seat appears not to work.
 *
 * The tokens are right there in the URL when that happens. This forwards them
 * to the page that knows what to do with them, so a missing dashboard entry
 * costs nobody their invite. It is a safety net, not the mechanism — the
 * redirect URLs in docs/CHAPTERS.md are still the thing to configure.
 *
 * ── Which page ────────────────────────────────────────────────────────────
 *
 * Supabase names the link type in the same fragment. `type=invite` is an
 * account being handed over and belongs on the welcome screen; `type=recovery`
 * is somebody repairing a password they already have, and belongs on /reset —
 * unless this tab just came through /join, in which case it is the second half
 * of an invite wearing a recovery link (see app/api/chapter/claim/route.ts)
 * and the welcome screen is right after all.
 *
 * Nothing happens without both tokens, so an ordinary `#anchor` on the landing
 * page is untouched.
 */
export function AuthHashRelay() {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const raw = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    if (!raw) return;

    const params = new URLSearchParams(raw);
    if (!params.get("access_token") || !params.get("refresh_token")) return;

    const invited = params.get("type") === "invite" || readInviteName() !== null;

    // replace(), not assign(): the front door was never a step in this flow,
    // and leaving it in history would put Back on a URL whose tokens are spent.
    window.location.replace(`${invited ? "/join/setup" : "/reset"}#${raw}`);
  }, []);

  return null;
}
