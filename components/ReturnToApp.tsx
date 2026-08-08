"use client";

import { useEffect, useState } from "react";

import { captureHandoff } from "@/lib/cloud/billing";

/**
 * THE WAY BACK, for a purchase that was made in a browser on behalf of an app.
 *
 * A store build cannot sell, so GET PRO opens this website in the player's own
 * browser (lib/commerce.ts). Until now the flow simply stopped there: they
 * paid, Stripe returned them to a page on the web, and the app — the reason
 * they were buying anything — was somewhere behind it, still showing the
 * paywall. Nothing was broken and nothing had happened, which is the worst
 * shape a payment can take.
 *
 * So the checkout's return URL carries `&app=1` when the buyer walked in from
 * a store build, and this hops them home: `novus://purchase?state=ok`, which
 * the app answers by closing the browser and re-reading its receipt
 * (lib/cloud/purchase-return.ts).
 *
 * ── Why there is a button as well as an automatic hop ───────────────────────
 *
 * A custom scheme is not a link a browser owes you. Safari will follow one from
 * a page load it considers user-initiated and will quietly ignore one it does
 * not, iOS shows a confirmation the player may dismiss, and an in-app browser
 * inside some other app may refuse outright. The automatic attempt covers the
 * ordinary case; the button is what stops the unusual one from being a dead
 * end, and it is a real user gesture, which is the input every browser honours.
 *
 * Nothing here is load-bearing for the purchase itself. The grant is the
 * webhook's, the app re-reads it on the next foreground either way, and this is
 * only the difference between "it appeared while you watched" and "it appeared
 * some time later, if you thought to look".
 */
export function ReturnToApp() {
  const [state, setState] = useState<"ok" | "cancelled" | null>(null);
  const [hopped, setHopped] = useState(false);

  useEffect(() => {
    // The claim the app put on the way in — parked here for the whole tab,
    // because signing in reloads this page and the press that needs it comes
    // afterwards. Every load, not only the returning one.
    captureHandoff();

    const params = new URLSearchParams(window.location.search);
    if (params.get("app") !== "1") return;
    const purchase = params.get("purchase");
    if (purchase !== "ok" && purchase !== "cancelled") return;
    setState(purchase);
  }, []);

  useEffect(() => {
    if (!state || hopped) return;
    // One attempt, on a short delay so the page has painted first: a hop that
    // fires before anything is on screen looks like a crash if it fails.
    const t = window.setTimeout(() => {
      setHopped(true);
      window.location.href = `novus://purchase?state=${state}`;
    }, 700);
    return () => window.clearTimeout(t);
  }, [state, hopped]);

  if (!state) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto w-full max-w-md rounded-[var(--radius-card)] bg-[var(--card)] p-4 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]">
        <p className="text-sm font-bold">
          {state === "ok" ? "Payment received." : "Nothing was charged."}
        </p>
        <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
          {state === "ok"
            ? "Pro is on your account. Go back to Novus and it will be waiting — it reads the receipt as soon as it is in front of you."
            : "The checkout was closed before it finished. You can go back to Novus and try again whenever you like."}
        </p>
        <a
          href={`novus://purchase?state=${state}`}
          className="nv-gc mt-3 flex h-12 w-full items-center justify-center rounded-[var(--radius-row)] nv-t-action text-sm font-extrabold tracking-[0.04em]"
        >
          BACK TO NOVUS
        </a>
      </div>
    </div>
  );
}
