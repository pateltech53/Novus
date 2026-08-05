"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { isOAuthState } from "@/lib/auth/providers";
import { ChooseName } from "@/components/ChooseName";
import { completeProviderSignIn } from "@/lib/cloud/auth";
import { resumePendingPro } from "@/lib/cloud/pending-pro";
import { storefront } from "@/lib/commerce";
import { entryRoute } from "@/lib/entry";
import { appPath } from "@/lib/native/href";

/**
 * Where Google and Apple put the player down.
 *
 * The session already exists by the time this renders — `/api/auth/oauth/
 * callback` did the exchange server-side and set the cookie, which is the
 * whole reason the PKCE flow was chosen over the one that leaves tokens in the
 * URL. So this page holds no credential and reads none. It does the two things
 * a server cannot:
 *
 *   1. **Settles this device.** A sign-in empties localStorage because on the
 *      shared machines this app runs on it belongs to whoever was here before;
 *      a sign-UP keeps it, because those companies are the player's own and
 *      keeping them is why they made an account. `?state=` says which happened
 *      (lib/auth/oauth-profile.ts) and lib/cloud/auth.ts acts on it.
 *   2. **Asks a brand-new account what it is called.** The row exists by then,
 *      named whatever Google volunteered — or "Founder", which is what Apple
 *      leaves behind on every sign-in after the first. Neither is the player's
 *      answer, and this app's convention has always been that the name is the
 *      player's own invention.
 *
 * The privacy checkbox is here for the same structural reason. On the email
 * form it gates creation, because there creation is ours to gate. Here the
 * account is made by the round trip before we can put anything in front of
 * anybody, so consent is collected at the first moment there is a screen — and
 * recorded on the row rather than only on the device (app/api/auth/name).
 */

type Phase = "working" | "naming" | "leaving" | "failed";

/** What each `?error=` means to somebody who is not going to read the code.
 *  `cancelled` is deliberately gentle: the commonest way to arrive here with an
 *  error is to look at a consent screen and change your mind. */
const MESSAGES: Record<string, string> = {
  cancelled: "That sign-in was cancelled. Nothing has changed.",
  provider: "The sign-in provider refused that request. Try again, or use an email and password.",
  "not-configured": "Accounts are not switched on for this build.",
  throttled: "Too many sign-in attempts from this network. Wait a few minutes and try again.",
  expired: "That sign-in took too long, or was finished in a different browser. Start again.",
  state: "That sign-in could not be matched to the one this browser started. Start again.",
  "no-code": "That link is missing the part that proves the sign-in finished. Start again.",
  exchange: "That sign-in could not be completed. Start again.",
  profile: "The account was created but its profile could not be. Try signing in again.",
  unavailable: "Signing in with Google or Apple is not available on this deploy yet.",
};

export default function OAuthCallbackPage() {
  return (
    // useSearchParams needs one, and this page is a spinner for the half-second
    // before the effect runs anyway.
    <Suspense fallback={<Shell title="Signing you in…" />}>
      <Callback />
    </Suspense>
  );
}

function Callback() {
  const router = useRouter();
  const params = useSearchParams();

  const [phase, setPhase] = useState<Phase>("working");
  const [error, setError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);

  /**
   * Runs the adopt exactly once.
   *
   * StrictMode double-invokes effects in development, and the second pass would
   * run the device wipe again — harmless on its own, but it would also fire a
   * second `pushLocalNow` on the sign-up path, against a device the first pass
   * has already pushed. Same guard, and the same reason, as /reset.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const failed = params.get("error");
    if (failed) {
      setError(MESSAGES[failed] ?? "That sign-in could not be completed. Try again.");
      setPhase("failed");
      return;
    }

    const state = params.get("state");
    if (!isOAuthState(state)) {
      setError("This page is where Google and Apple send you back. There is nothing to finish here.");
      setPhase("failed");
      return;
    }

    void completeProviderSignIn(state).then(async (result) => {
      if (!result.ok) {
        setError(result.message);
        setPhase("failed");
        return;
      }

      if (result.state === "new") {
        // "Founder" is the placeholder the callback route writes when the
        // provider offered nothing. Showing it as a prefill would invite the
        // player to accept it, which is the opposite of what this screen is
        // for, so it becomes an empty field.
        setSuggested(
          result.suggestedName && result.suggestedName !== "Founder" ? result.suggestedName : null,
        );
        setPhase("naming");
        return;
      }

      await leave("known");
    });
    // params is stable for the life of this document — the effect is guarded to
    // run once regardless, and re-running it on a router-internal change is the
    // thing the guard exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Out of here, the same way every other sign-in path leaves.
   *
   * **known** goes to "/" and lets the front door decide after the restore. The
   * device was just emptied, so choosing a route from localStorage here would
   * choose it for nobody — this is signIn()'s reasoning verbatim, and the
   * reason it is a document load rather than a router.push: the account's saves
   * are pulled by restoreOnBoot when CloudSync remounts, which a client-side
   * navigation never triggers.
   *
   * **new** goes wherever the player already was. Sign-up keeps this device, so
   * a player who had a company half-built before they made an account goes back
   * to it rather than through onboarding they do not need.
   */
  const leave = async (state: "new" | "known") => {
    setPhase("leaving");

    // Somebody who signed in in order to buy goes to the checkout, not home.
    // The pricing section records the plan when checkout refuses a signed-out
    // buyer, and this is the moment that refusal stops being true. Answering
    // true means the browser is already leaving for Stripe.
    if (await resumePendingPro()) return;

    const route = state === "new" ? entryRoute() : "/";
    window.location.href = storefront() === "web" ? route : appPath(route);
  };

  if (phase === "failed") {
    return (
      <Shell title="That did not work.">
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">{error}</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="nv-gc mt-6 h-14 w-full rounded-[var(--radius-card)] nv-on text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--text-primary)]"
        >
          BACK TO NOVUS
        </button>
      </Shell>
    );
  }

  if (phase === "naming") {
    return (
      <Shell title="What should we call you?">
        <p className="mt-3 mb-6 text-xs leading-relaxed text-[var(--text-secondary)]">
          Your account is made. This is the name the game uses — your own
          invention, not the one on your Google or Apple account.
        </p>

        <ChooseName suggested={suggested} onDone={() => leave("new")} />
      </Shell>
    );
  }

  return (
    <Shell title={phase === "leaving" ? "You’re in." : "Signing you in…"}>
      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        {phase === "leaving" ? "Taking you to the game…" : "One moment."}
      </p>
    </Shell>
  );
}

/** The frame /reset and /join/setup use, so the three pages of this flow are
 *  visibly the same place. */
function Shell({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[24rem] flex-col justify-center px-6 py-16">
      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">NOVUS</p>
      <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
        {title}
      </h1>
      {children}
    </main>
  );
}
