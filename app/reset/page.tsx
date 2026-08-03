"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import { confirmPasswordReset } from "@/lib/cloud/auth";
import { createAccount } from "@/lib/account";

/**
 * Where the password reset email lands.
 *
 * Supabase puts the recovery tokens in the URL **fragment** — `#access_token=…`
 * — and a fragment never reaches a server; the browser keeps it. So this page
 * reads its own hash and posts the values to /api/auth/reset/confirm, which
 * does the actual work. That is the only shape available without running a
 * Supabase client in the browser, which this app deliberately does not do.
 *
 * The hash is cleared from the address bar as soon as it is read, so the
 * tokens do not sit in history or get shoulder-read off a classroom projector.
 */

type Phase = "reading" | "ready" | "no-token" | "done";

export default function ResetPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("reading");
  const [tokens, setTokens] = useState<{ access: string; refresh: string } | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against reading the hash twice.
   *
   * The effect CLEARS the hash as its last act, so a second invocation finds
   * nothing and would flip a perfectly good link to "no-token". React's
   * StrictMode double-invokes effects in development, which means without this
   * every reset link appears broken on localhost — exactly where this flow
   * gets tested.
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

    // Supabase reports its own failures here too — an expired link arrives as
    // `error_description` rather than tokens, and saying so beats showing a
    // form that cannot work.
    const described = params.get("error_description");

    if (access && refresh) {
      setTokens({ access, refresh });
      setPhase("ready");
      // Drop the tokens out of the address bar. replaceState keeps the entry
      // rather than adding one, so Back still leaves the page.
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      if (described) setError(described);
      setPhase("no-token");
    }
  }, []);

  const submit = async () => {
    if (!tokens || busy || password.length < MIN_PASSWORD_LENGTH) return;
    setBusy(true);
    setError(null);

    const result = await confirmPasswordReset(tokens.access, tokens.refresh, password);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }

    // The confirm route leaves the player signed in. Write the local account
    // cache to match, or the front door would read no account and offer
    // CREATE ACCOUNT to someone who is already signed in.
    if (result.ok && result.email) {
      createAccount(result.displayName ?? "Founder", result.email);
    }

    setPhase("done");
    setTimeout(() => router.push("/"), 1200);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[24rem] flex-col justify-center px-6 py-16">
      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
        NOVUS
      </p>
      <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
        {phase === "done" ? "Password changed." : "Choose a new password."}
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
              "This page only works from the link in a password reset email, and that link can only be used once."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="nv-gc mt-6 h-14 w-full rounded-[var(--radius-pill)] nv-on text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--text-primary)]"
          >
            BACK TO NOVUS
          </button>
        </>
      )}

      {phase === "ready" && (
        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label
            htmlFor="new-password"
            className="block text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
          >
            NEW PASSWORD
          </label>
          <input
            id="new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`${MIN_PASSWORD_LENGTH} characters or more`}
            autoComplete="new-password"
            autoFocus
            className="mt-3 block w-full border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-[1.125rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)]"
          />

          <button
            type="submit"
            disabled={busy || password.length < MIN_PASSWORD_LENGTH}
            className="nv-gc mt-6 block h-14 w-full rounded-[var(--radius-pill)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {busy ? "SAVING…" : "SET PASSWORD"}
          </button>

          {error ? (
            <p role="alert" className="mt-3 text-2xs leading-relaxed text-[var(--color-alert)]">
              {error}
            </p>
          ) : null}
        </form>
      )}

      {phase === "done" && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          You are signed in. Taking you back to the game…
        </p>
      )}
    </main>
  );
}
