"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import { forgetInviteSetup, readInviteSetup, rememberInviteSetup, replaceInviteSetup } from "@/lib/auth/invite-setup";
import { confirmPasswordReset } from "@/lib/cloud/auth";
import { MAX_NAME_LENGTH, createAccount } from "@/lib/account";

/**
 * Both mailers link directly to this welcome page. The mailbox proves the
 * account, and this form asks for its name and first password. Credentials
 * leave the URL immediately and have a bounded, tab-only refresh handover.
 * Legacy /join links now request this same email rather than returning a
 * recovery credential to a caller holding a reusable invitation token.
 */

type Phase = "reading" | "ready" | "no-token" | "done";

export default function SeatSetupPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("reading");
  const [tokens, setTokens] = useState<{ access: string; refresh: string } | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against reading the hash twice — the effect CLEARS it as its last
   * act, so a second invocation finds nothing and would flip a perfectly good
   * link to "no-token". StrictMode double-invokes effects in development,
   * which is precisely where this flow gets tested. Same reasoning as /reset.
   */
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(hash);

    const access = params.get("access_token");
    const refresh = params.get("refresh_token");

    // Supabase reports its own failures in the same place — an expired link
    // arrives as `error_description` rather than tokens, and saying so beats
    // showing a form that cannot work.
    const described = params.get("error_description");

    if (access && refresh) {
      setTokens({ access, refresh });
      rememberInviteSetup({ access, refresh });
      setPhase("ready");
      // replaceState keeps the history entry rather than adding one, so Back
      // still leaves the page.
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      // A failed NEW link must never pick up another account's old handover.
      if (described || hash) {
        forgetInviteSetup();
        if (described) setError(described);
        setPhase("no-token");
      } else {
        const pending = readInviteSetup();
        setTokens(pending);
        setPhase(pending ? "ready" : "no-token");
      }
    }
  }, []);

  const chosenName = name.trim();
  const ready = password.length >= MIN_PASSWORD_LENGTH && chosenName.length > 0;

  const submit = async () => {
    if (!tokens || busy || !ready) return;
    setBusy(true);
    setError(null);

    const result = await confirmPasswordReset(
      tokens.access,
      tokens.refresh,
      password,
      chosenName,
    );
    if (!result.ok) {
      if (result.retryTokens) {
        setTokens(result.retryTokens);
        replaceInviteSetup(result.retryTokens);
      }
      setBusy(false);
      setError(result.message);
      return;
    }

    // The confirm route leaves them signed in. Write the local account cache
    // to match, or the front door would read no account and offer CREATE
    // ACCOUNT to someone who is already signed in. confirmPasswordReset has
    // just wiped this device — it may have belonged to another student — so
    // this write lands on an empty device.
    if (result.email) {
      createAccount(result.displayName ?? chosenName ?? "Founder", result.email);
    }

    forgetInviteSetup();
    setPhase("done");

    // Straight into onboarding rather than the marketing front door: this
    // person was invited, they have just made an account, and the next thing
    // they need is the game. A full page load, not router.push() — the device
    // was emptied a moment ago, and the account's own saves are pulled by
    // restoreOnBoot when CloudSync remounts, which a client-side navigation
    // never triggers.
    setTimeout(() => {
      window.location.href = "/welcome";
    }, 1200);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[24rem] flex-col justify-center px-6 py-16">
      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
        NOVUS
      </p>
      <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">
        {phase === "done"
          ? "You're in."
          : "Welcome to Novus."}
      </h1>

      {phase === "reading" && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          Checking your link…
        </p>
      )}

      {phase === "no-token" && (
        <>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            {error ??
              "This page finishes a chapter invite, and the link that opens it works once. If yours has expired, whoever runs your chapter can send it again — and if you already chose a password, use “Forgot password?” on the sign-in screen instead."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="nv-gc mt-6 h-14 w-full rounded-[var(--radius-card)] nv-on text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--text-primary)]"
          >
            BACK TO NOVUS
          </button>
        </>
      )}

      {phase === "ready" && (
        <>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            Your seat is live. Choose a password and the account is yours — it
            is how you get back into your company on any device, in any class.
          </p>
          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label
              htmlFor="seat-name"
              className="block text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
            >
              YOUR NAME
            </label>
            <input
              id="seat-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What the shark should call you"
              autoComplete="name"
              maxLength={MAX_NAME_LENGTH}
              autoFocus
              className="mt-3 mb-6 block w-full border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-[1.125rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)]"
            />

            <label
              htmlFor="seat-password"
              className="block text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
            >
              YOUR PASSWORD
            </label>
            <input
              id="seat-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`${MIN_PASSWORD_LENGTH} characters or more`}
              autoComplete="new-password"
              className="mt-3 block w-full border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-[1.125rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)]"
            />

            <button
              type="submit"
              disabled={busy || !ready}
              className="nv-gc mt-6 block h-14 w-full rounded-[var(--radius-card)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {busy ? "SAVING…" : "SET PASSWORD AND PLAY"}
            </button>

            {error ? (
              <p role="alert" className="mt-3 text-2xs leading-relaxed text-[var(--color-alert)]">
                {error}
              </p>
            ) : null}
          </form>
          <p className="mt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
            Next: found your company. The seat is Novus Pro for the licence
            year — it never buys a score, a survival, or a place on the board.
          </p>
        </>
      )}

      {phase === "done" && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          Your account is ready and you are signed in. Taking you to your first
          company…
        </p>
      )}
    </main>
  );
}
