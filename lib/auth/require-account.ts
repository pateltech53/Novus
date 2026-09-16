"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { loadAccount } from "@/lib/account";
import { storefront } from "@/lib/commerce";
import { appPath } from "@/lib/native/href";

/**
 * The front door, enforced on the destination rather than on one button.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The landing page's PLAY FREE already routes through `AccountGate` instead of
 * walking a visitor in anonymously (see the header comment on
 * `components/landing/AccountGate.tsx` and `Landing.tsx`'s own `enter()`) —
 * but that is a funnel on one button, not a property of where it leads.
 * Two doors are still open under it, and this hook is the guard on both:
 *
 * · **A bookmark, a shared link, or the back button reaches these pages on
 *   the web**, independent of the landing page's button.
 * · **A deep link, a widget tap, or a stale build reaches one of these pages
 *   in the app** without going through `public/boot.html`'s own account
 *   check first (added alongside this file — see its header). Boot.html
 *   closes the common case, a cold start with no account, for free; this
 *   hook is what still catches everything else, on both platforms, because
 *   a page cannot trust that whatever put it on screen already checked.
 *
 * This is the same check `AccountGate` itself makes first, on the same cache
 * — `loadAccount()`, the synchronous localStorage mirror `lib/account.ts`
 * keeps for exactly this reason ("what the first paint can afford to know").
 * A false "signed in" here is no more dangerous than it already is on the
 * front door: `AccountGate`'s own effect double-checks the real session
 * afterwards and signs a stale cache out, which happens wherever it happens
 * to render next — this hook does not need to re-invent that.
 *
 * ── What it returns ──────────────────────────────────────────────────────────
 *
 * `false` on the server, on the first client render (before the effect has
 * had a chance to read localStorage — reading it any earlier is exactly the
 * hydration-mismatch trap `AccountGate`'s own comment warns about), and for
 * as long as an unauthenticated visitor is being sent away. `true` once a
 * local account is confirmed, and only then. The caller's job is one line:
 * render nothing (or its own placeholder) until this says so.
 */
export function useRequireAccount(): boolean {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loadAccount()) {
      setReady(true);
      return;
    }
    // Both platforms land on "/", same as AccountGate's own enter() and
    // Landing.tsx's leave() already send a signed-out visitor there. That
    // page carries pricing and checkout — Guideline 3.1.1 territory in a
    // store build — but PricingSection gates itself on `sells !== true`
    // (Landing.tsx, "not decoration"), the `=== true` direction specifically
    // so a native visitor never paints it, even for the one tick before
    // hydration answers. This is a document navigation in the shipped app,
    // for the same reason AccountGate's own enter() picks one: a client-side
    // push is meaningless once `window.location` is what actually owns the
    // shell's history, and `appPath` is what keeps a bundled binary's router
    // able to resolve it. `replace`, not `push`, on the web — the page being
    // left behind was never a place the back button should be able to
    // return to.
    if (storefront() === "web") router.replace("/");
    else window.location.href = appPath("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ready;
}
