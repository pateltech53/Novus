"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_NAME_LENGTH,
  createAccount,
  loadAccount,
  signOut,
} from "@/lib/account";
import { loadProfile } from "@/lib/engine/save";
import Link from "next/link";
import { play } from "@/lib/sound";
import { usePrefetch } from "@/lib/prefetch";

/**
 * The front door's only interactive element, and the page's one accent.
 *
 * Three states: CREATE ACCOUNT (no account yet), the name field (mid-create),
 * CONTINUE AS <NAME> (account on this device). The name is the entire form —
 * no email, no password — because the store behind it is lib/account.ts, a
 * device-local simulation for a product used by minors. That limit is stated
 * on screen rather than dressed up as a login.
 */

type Mode = "create" | "naming" | "signedIn";

export function AccountGate() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [displayName, setDisplayName] = useState("");
  const [name, setName] = useState("");
  /** The policy checkbox. Creation is disabled until it is ticked — "must
   *  agree" means the button will not work, not that a banner was shown. */
  const [agreed, setAgreed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // localStorage is unreachable during SSR; hydrate the real state after
  // mount. The default (create) is also the most common first visit.
  useEffect(() => {
    const account = loadAccount();
    if (account) {
      setDisplayName(account.displayName);
      setMode("signedIn");
    }
  }, []);

  useEffect(() => {
    if (mode === "naming") inputRef.current?.focus();
  }, [mode]);

  /** Where a signed-in player goes: onboarding once, then straight to
   *  founding a company. */
  const destination = () => (loadProfile()?.onboarded ? "/found" : "/welcome");

  // Both, because which one it is depends on storage this component reads
  // lazily — and warming the wrong one costs nothing next to a cold push.
  usePrefetch("/welcome", "/found");

  const valid = name.trim().length > 0 && agreed;

  const create = () => {
    if (!createAccount(name)) return;
    play("success");
    // A fresh name always walks through onboarding — /found would reuse the
    // previous player's founder profile under the new account.
    router.push("/welcome");
  };

  return (
    <div className="w-full">
      {mode === "naming" && (
        <form
          className="mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create();
          }}
        >
          <label
            htmlFor="display-name"
            className="block text-center text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
          >
            YOUR NAME
          </label>
          <input
            id="display-name"
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
            placeholder="Your name"
            autoComplete="off"
            spellCheck={false}
            // The underline field from onboarding, at hero scale. Focus is the
            // rule going full-contrast — a 2px ring box around a borderless
            // field reads as a broken input (see /welcome's name step).
            // The `!` matters: globals.css sets the ring UNLAYERED, which
            // beats a layered utility; important flips that back.
            className="mx-auto mt-3 block w-full max-w-[16rem] border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-center text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)]"
          />
          <label className="mx-auto mt-4 flex max-w-[21rem] cursor-pointer items-start gap-2.5 text-left">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--action)]"
            />
            <span className="text-2xs leading-relaxed text-[var(--text-secondary)]">
              I&rsquo;ve read the{" "}
              <Link
                href="/privacy"
                target="_blank"
                className="font-bold underline underline-offset-2"
              >
                privacy policy
              </Link>{" "}
              — the short version: the game stays on this device, video never
              leaves it, words are judged, voices are not.
            </span>
          </label>
        </form>
      )}

      {mode === "signedIn" ? (
        <GateButton onClick={() => router.push(destination())}>
          CONTINUE AS {displayName.toUpperCase()}
        </GateButton>
      ) : mode === "naming" ? (
        <GateButton onClick={create} disabled={!valid}>
          CREATE ACCOUNT
        </GateButton>
      ) : (
        <GateButton
          onClick={() => {
            play("click");
            setMode("naming");
          }}
        >
          CREATE ACCOUNT
        </GateButton>
      )}

      {mode === "signedIn" ? (
        <button
          type="button"
          onClick={() => {
            play("click");
            signOut();
            setDisplayName("");
            setName("");
            setMode("create");
          }}
          className="mx-auto mt-3 block text-2xs text-[var(--text-tertiary)] underline underline-offset-4"
        >
          Not {displayName}? Sign out on this device
        </button>
      ) : (
        <p className="mx-auto mt-3 max-w-[21rem] text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
          No email, no password. Accounts are stored on this device until
          online accounts launch.
        </p>
      )}
    </div>
  );
}

/**
 * The pill from onboarding (StepShell's PrimaryButton), rebuilt with truncate:
 * CONTINUE AS plus a 24-character name must stay one line at 320px, and a
 * two-line button is forbidden at any breakpoint.
 */
function GateButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block h-14 w-full truncate rounded-[var(--radius-pill)] bg-[var(--action)] px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)] transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}
