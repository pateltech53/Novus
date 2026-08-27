"use client";

import { useState } from "react";
import Link from "next/link";

import { MAX_NAME_LENGTH } from "@/lib/account";
import { setDisplayName } from "@/lib/cloud/auth";
import { play } from "@/lib/sound";

/**
 * The one screen a Google or Apple account gets that an email account does not.
 *
 * ── Why it exists ─────────────────────────────────────────────────────────
 *
 * The email form asks for a name before it asks for anything else, so an
 * account made that way is named from its first instant. A provider account is
 * not: pressing "Continue with Google" creates one without a single field
 * having been typed, and the name on the row at that point is whatever the
 * provider volunteered — or "Founder", which is what Apple leaves behind on
 * every sign-in after the first, because Apple hands over a name once and never
 * again.
 *
 * Neither is the player's answer. A Google account very often carries a real
 * full name that a teenager did not choose to publish here, and this app's
 * convention — stated in components/landing/AccountGate.tsx and true since
 * before there were accounts at all — is that the name is the player's own
 * invention. So the provider's version is offered as a prefill that can be
 * typed over, and never as a fait accompli.
 *
 * ── Why the privacy checkbox is here and not earlier ──────────────────────
 *
 * On the email form it gates creation, because there creation is ours to gate.
 * It cannot work that way for a provider: the account is made by the round trip
 * to Google, before there is any screen of ours to put a checkbox on. So
 * consent is collected at the first moment there IS a screen, and recorded on
 * the profile row rather than only in localStorage — see app/api/auth/name.
 *
 * ── Why it is a component and not a page ──────────────────────────────────
 *
 * Two surfaces need it and they leave in opposite directions. On the web the
 * round trip lands on /auth/callback and the player is sent into the game from
 * there; in the shipped app the sign-in happens inside a settings sheet that is
 * already sitting on top of the game, and navigating to a callback page would
 * mean leaving and coming back for no reason. Same step, same wording, two
 * hosts — so the host owns the navigation and this owns the field.
 */
export function ChooseName({
  suggested,
  onDone,
  submitLabel = "START PLAYING",
}: {
  /** The provider's name for this person, or null. "Founder" is treated as
   *  null by the caller — it is a placeholder, not a suggestion. */
  suggested: string | null;
  /** Called once the name is saved. The host decides where to go. */
  onDone: () => void | Promise<void>;
  submitLabel?: string;
}) {
  const [name, setName] = useState(suggested ?? "");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const chosen = name.trim();
    if (busy || !chosen || !agreed) return;
    setBusy(true);
    setError(null);

    const result = await setDisplayName(chosen, agreed);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }

    play("success");
    await onDone();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label
        htmlFor="chosen-name"
        className="block text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
      >
        YOUR NAME
      </label>
      <input
        id="chosen-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
        placeholder="Your name"
        autoComplete="nickname"
        enterKeyHint="go"
        spellCheck={false}
        autoFocus
        className="mt-3 block w-full border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)]"
      />

      {/* 20px box and the whole row is the target — this is a product used
          one-handed on shared phones, and a 16px checkbox is a miss. */}
      <label
        style={{ touchAction: "manipulation" }}
        className="mt-6 flex cursor-pointer items-start gap-2.5 py-2 text-left"
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-px h-5 w-5 shrink-0 accent-[var(--action)]"
        />
        <span className="text-2xs leading-relaxed text-[var(--text-secondary)]">
          I&rsquo;ve read the{" "}
          <Link
            href="/privacy"
            target="_blank"
            className="-my-1.5 inline-block py-1.5 font-bold underline underline-offset-2"
          >
            privacy policy
          </Link>{" "}
          — the short version: your email and progress are stored so you can sign
          back in, your video never leaves this device, words are judged, voices
          are not.
        </span>
      </label>

      <button
        type="submit"
        disabled={busy || !name.trim() || !agreed}
        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
        className="nv-gc mt-4 block h-14 w-full rounded-[var(--radius-card)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:cursor-not-allowed disabled:opacity-35"
      >
        {busy ? "SAVING…" : submitLabel}
      </button>

      {error ? (
        <p role="alert" className="mt-3 text-2xs leading-relaxed text-[var(--alert)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
