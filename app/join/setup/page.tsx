"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import { forgetInviteName, readInviteName } from "@/lib/auth/invite";
import { confirmPasswordReset } from "@/lib/cloud/auth";
import { MAX_NAME_LENGTH, createAccount } from "@/lib/account";

/**
 * Where a chapter invite finishes: the welcome, and the password.
 *
 * ── Why this page exists at all ────────────────────────────────────────────
 *
 * Both invite paths used to land on /reset. A student who had never had an
 * account, who opened an email headed "A seat is waiting for you", arrived at
 * a page that said **"Choose a new password."** — new to what? The account was
 * ninety seconds old and had never had one. That page is written for someone
 * who forgot a password they chose themselves, and every word of it is wrong
 * for someone being handed a seat. It reads as a mix-up at best and as a phish
 * at worst, which is exactly the reaction the invite email is careful to avoid
 * and then handed straight to /reset.
 *
 * So the invite ends here instead. Same mechanism, entirely different sentence:
 * this is the first screen of an account, not the repair of one.
 *
 * ── The mechanism ─────────────────────────────────────────────────────────
 *
 * Supabase puts its tokens in the URL **fragment** (`#access_token=…`), and a
 * fragment never reaches a server — the browser keeps it. So this page reads
 * its own hash and posts the values to /api/auth/reset/confirm, which does the
 * work: adopts the session, sets the password, and leaves the student signed
 * in. Same endpoint /reset uses, because it is the same operation; only the
 * page around it differs. The hash is cleared from the address bar as soon as
 * it is read, so the tokens do not sit in history or get shoulder-read off a
 * classroom projector.
 *
 * Two kinds of link arrive here, and both work:
 *
 *   · the one /join mints (Resend path) — the name was typed a screen ago and
 *     is already on the account, so this page greets them by it and asks only
 *     for the password;
 *   · Supabase's own "You have been invited" mail (no Resend configured) —
 *     which never had a claim screen, so the name is asked for here.
 */

type Phase = "reading" | "ready" | "no-token" | "done";

export default function SeatSetupPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("reading");
  const [tokens, setTokens] = useState<{ access: string; refresh: string } | null>(null);
  /** The name typed at /join, when this browser is the one that typed it. */
  const [known, setKnown] = useState<string | null>(null);
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

    setKnown(readInviteName());

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
      setPhase("ready");
      // replaceState keeps the history entry rather than adding one, so Back
      // still leaves the page.
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      if (described) setError(described);
      setPhase("no-token");
    }
  }, []);

  const chosenName = (known ?? name).trim();
  const ready = password.length >= MIN_PASSWORD_LENGTH && chosenName.length > 0;

  const submit = async () => {
    if (!tokens || busy || !ready) return;
    setBusy(true);
    setError(null);

    // The name only travels when this page is the one that asked for it. On
    // the /join path it is already on the account (the claim endpoint wrote
    // it), and re-sending it would be a second write of the same string.
    const result = await confirmPasswordReset(
      tokens.access,
      tokens.refresh,
      password,
      known ? undefined : chosenName,
    );
    if (!result.ok) {
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

    forgetInviteName();
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
          : known
            ? `Welcome, ${known}.`
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
            {/* Only asked when nothing asked already. The Resend invite takes
                the name at /join; Supabase's own invite mail has no claim
                screen at all, and without this the account would keep the
                "Founder" placeholder forever. */}
            {!known && (
              <>
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
              </>
            )}

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
              autoFocus={!!known}
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
              <p role="alert" className="mt-3 text-2xs leading-relaxed text-[var(--alert)]">
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
