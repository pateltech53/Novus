"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { checkEmail, normaliseEmail } from "@/lib/auth/credentials";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";

/** Older invitation links request a fresh email. Setup credentials are never
 * returned to a browser holding a reusable legacy token. New invitations
 * already go directly from the mailbox to /join/setup. */
type Phase = "reading" | "ready" | "no-code" | "leaving";

export default function JoinPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("reading");
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** StrictMode double-invoke guard — same reasoning as /reset. */
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    const value = new URLSearchParams(window.location.search).get("code");
    if (value) {
      setCode(value);
      setPhase("ready");
    } else {
      setPhase("no-code");
    }
  }, []);

  const submit = async () => {
    if (busy || !code) return;
    const cleaned = normaliseEmail(email);
    if (checkEmail(cleaned)) {
      setError("That does not look like an email address.");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(apiUrl("/api/chapter/claim"), {
        method: "POST",
        credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: code, email: cleaned }),
      });
      const body = (await res.json()) as { ok?: boolean; sent?: boolean; error?: string };
      if (!res.ok || !body.ok || !body.sent) {
        setBusy(false);
        setError(body.error ?? "That did not work. Try the link from the email again.");
        return;
      }
      setPhase("leaving");
    } catch {
      setBusy(false);
      setError("Could not reach the server. Check your connection and try again.");
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[24rem] flex-col justify-center px-6 py-16">
      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
        NOVUS
      </p>
      <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
        {phase === "leaving" ? "Check your inbox." : "Claim your seat."}
      </h1>

      {phase === "reading" && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          Checking your link…
        </p>
      )}

      {phase === "no-code" && (
        <>
          <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            This page only works from the link in a chapter invite email. If
            yours has expired or gone missing, whoever runs your chapter can
            send it again.
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
            A seat in a Novus chapter is set aside for you. Confirm the email
            the invite was sent to. We will email a fresh link to choose your
            name and password.
          </p>
          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label
              htmlFor="join-email"
              className="block text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
            >
              YOUR EMAIL
            </label>
            <input
              id="join-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="The address the invite was sent to"
              autoComplete="email"
              autoFocus
              className="mt-3 block w-full border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-[1.125rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)]"
            />

            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="nv-gc mt-6 block h-14 w-full rounded-[var(--radius-card)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {busy ? "SENDING…" : "SEND SETUP EMAIL"}
            </button>

            {error ? (
              <p role="alert" className="mt-3 text-2xs leading-relaxed text-[var(--color-alert)]">
                {error}
              </p>
            ) : null}
          </form>
          <p className="mt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
            Next step: open the setup email and choose your password. The seat is Novus Pro for the
            licence year — it never buys a score, a survival, or a place on
            the board.
          </p>
        </>
      )}

      {phase === "leaving" && (
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
          We sent a setup link to {email}. Open it to choose your name and password. Your seat is claimed after setup finishes.
        </p>
      )}
    </main>
  );
}
