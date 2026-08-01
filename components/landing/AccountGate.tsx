"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { MAX_NAME_LENGTH, loadAccount, signOut as forgetLocalAccount } from "@/lib/account";
import { identity, requestPasswordReset, signIn, signOut, signUp } from "@/lib/cloud/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import { loadProfile } from "@/lib/engine/save";
import { play } from "@/lib/sound";

/**
 * The front door's only interactive element, and the page's one accent.
 *
 * It used to be a name and nothing else — no email, no password — because the
 * store behind it was a device-local simulation. Real accounts exist now, and
 * the reason is Pro: a subscription attached to a cookie is a subscription the
 * player loses the first time they clear their browser, and there would be no
 * way for them to prove they ever paid.
 *
 * ── What did not change ────────────────────────────────────────────────────
 *
 * The privacy checkbox still gates creation, the name is still the player's
 * own invention, and none of this is required to PLAY. A player who never
 * makes an account still gets the whole free game on this device — the
 * localStorage path is unchanged and is still a supported way to run Novus.
 * The account is what makes progress portable and a purchase recoverable.
 *
 * ── Four states ────────────────────────────────────────────────────────────
 *
 *   create    the resting state, one button
 *   signUp    name + email + password + policy checkbox
 *   signIn    email + password, with a way to ask for a reset
 *   signedIn  CONTINUE AS <NAME>
 */

type Mode = "create" | "signUp" | "signIn" | "signedIn";

export function AccountGate() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [displayName, setDisplayName] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement>(null);

  // localStorage is unreachable during SSR; hydrate the real state after
  // mount. The default (create) is also the most common first visit.
  useEffect(() => {
    const account = loadAccount();
    if (account) {
      setDisplayName(account.displayName);
      setMode("signedIn");
    }

    /*
     * ...then check with the server, because localStorage can lie.
     *
     * The cache says "signed in" for as long as it survives, but the thing that
     * actually signs a player in is the session cookie — and cookies expire, get
     * cleared on their own, and are dropped by browsers with aggressive storage
     * policies while localStorage survives. A player in that state sees
     * CONTINUE AS SAM, plays as a freshly minted anonymous user, and is told to
     * "create an account" the moment they try to buy Pro, having had one all
     * along.
     *
     * Only demotes an account the server does not recognise; it never promotes,
     * because the cache is the thing being checked.
     */
    let alive = true;
    void identity().then((who) => {
      if (!alive || !who.configured) return;
      if (account && (!who.signedIn || who.anonymous)) {
        forgetLocalAccount();
        setDisplayName("");
        setMode("signIn");
        setNotice("Your session expired. Sign in to pick up where you left off.");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (mode === "signUp" || mode === "signIn") firstFieldRef.current?.focus();
  }, [mode]);

  /** Where a signed-in player goes: onboarding once, then straight to
   *  founding a company. */
  const destination = () => (loadProfile()?.onboarded ? "/found" : "/welcome");

  const go = (next: Mode) => {
    play("click");
    setError(null);
    setNotice(null);
    setMode(next);
  };

  const canSignUp =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    agreed;

  const canSignIn = email.trim().length > 0 && password.length > 0;

  const submitSignUp = async () => {
    if (!canSignUp || busy) return;
    setBusy(true);
    setError(null);

    const result = await signUp(email, password, name);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      // A taken email is nearly always a returning player, so put them one tap
      // from the door they actually wanted rather than making them find it.
      if (result.reason === "taken") setMode("signIn");
      return;
    }

    play("success");
    // Unlike sign-in, sign-up KEEPS this device's progress — signUp() has just
    // pushed it into the new account — so a client-side push is fine here and
    // the anonymous player's half-built company survives making an account.
    router.push(destination());
  };

  const submitSignIn = async () => {
    if (!canSignIn || busy) return;
    setBusy(true);
    setError(null);

    const result = await signIn(email, password);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }

    play("success");
    /*
     * A full page load, not router.push().
     *
     * signIn() has just emptied this device (it belonged to whoever was here
     * before). The account's own save has NOT been pulled yet — that happens
     * in restoreOnBoot, which runs when CloudSync mounts, and CloudSync is in
     * the root layout so a client-side navigation never remounts it.
     *
     * Landing on `/` also means destination() is evaluated after the restore
     * rather than before it: routing on the now-empty profile would send a
     * returning player through onboarding they finished a term ago.
     */
    window.location.href = "/";
  };

  const forgot = async () => {
    if (busy) return;
    if (!email.trim()) {
      setError("Enter your email first, then tap this again.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(await requestPasswordReset(email));
    setBusy(false);
  };

  /**
   * Sign out, then reload rather than flip state.
   *
   * signOut() now clears the game's localStorage as well as the session (a
   * shared classroom machine must not hand the next student the last one's
   * companies — see lib/cloud/auth.ts). GameProvider and every screen that
   * read those keys at mount are still holding the old values in memory, and
   * no amount of setState here reaches them. A full reload is the only honest
   * way to show a device that has genuinely been emptied.
   */
  const leave = async () => {
    play("click");
    setBusy(true);
    await signOut();
    window.location.href = "/";
  };

  return (
    <div className="w-full">
      {(mode === "signUp" || mode === "signIn") && (
        <form
          className="mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === "signUp" ? submitSignUp() : submitSignIn());
          }}
        >
          {mode === "signUp" && (
            <Field
              id="display-name"
              inputRef={firstFieldRef}
              label="YOUR NAME"
              value={name}
              onChange={(v) => setName(v.slice(0, MAX_NAME_LENGTH))}
              placeholder="Your name"
              autoComplete="nickname"
              hero
            />
          )}

          <Field
            id="account-email"
            inputRef={mode === "signIn" ? firstFieldRef : undefined}
            label="EMAIL"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            className={mode === "signUp" ? "mt-5" : undefined}
          />

          <Field
            id="account-password"
            label="PASSWORD"
            value={password}
            onChange={setPassword}
            placeholder={mode === "signUp" ? `${MIN_PASSWORD_LENGTH} characters or more` : "Your password"}
            type="password"
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            className="mt-5"
          />

          {mode === "signUp" && (
            <label className="mx-auto mt-5 flex max-w-[21rem] cursor-pointer items-start gap-2.5 text-left">
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
                — the short version: your email and progress are stored so you
                can sign back in, your video never leaves this device, words are
                judged, voices are not.
              </span>
            </label>
          )}

          {/* Submit lives outside the form's visible buttons below, but a
              hidden one keeps Enter working in every browser. */}
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
        </form>
      )}

      {mode === "signedIn" ? (
        <GateButton onClick={() => router.push(destination())}>
          CONTINUE AS {displayName.toUpperCase()}
        </GateButton>
      ) : mode === "signUp" ? (
        <GateButton onClick={() => void submitSignUp()} disabled={!canSignUp || busy}>
          {busy ? "CREATING…" : "CREATE ACCOUNT"}
        </GateButton>
      ) : mode === "signIn" ? (
        <GateButton onClick={() => void submitSignIn()} disabled={!canSignIn || busy}>
          {busy ? "SIGNING IN…" : "SIGN IN"}
        </GateButton>
      ) : (
        <GateButton onClick={() => go("signUp")}>CREATE ACCOUNT</GateButton>
      )}

      {error ? (
        <p
          role="alert"
          className="mx-auto mt-3 max-w-[21rem] text-center text-2xs leading-relaxed text-[var(--color-alert)]"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mx-auto mt-3 max-w-[21rem] text-center text-2xs leading-relaxed text-[var(--text-secondary)]"
        >
          {notice}
        </p>
      ) : null}

      {mode === "signedIn" ? (
        <button
          type="button"
          onClick={() => void leave()}
          disabled={busy}
          className="mx-auto mt-3 block text-2xs text-[var(--text-tertiary)] underline underline-offset-4"
        >
          Not {displayName}? Sign out on this device
        </button>
      ) : mode === "signUp" ? (
        <FootLink onClick={() => go("signIn")}>
          Already have an account? Sign in
        </FootLink>
      ) : mode === "signIn" ? (
        <div className="mt-3 space-y-2">
          <FootLink onClick={() => void forgot()}>Forgot your password?</FootLink>
          <FootLink onClick={() => go("signUp")}>
            No account yet? Create one
          </FootLink>
        </div>
      ) : (
        <>
          <FootLink onClick={() => go("signIn")}>
            Already have an account? Sign in
          </FootLink>
          <p className="mx-auto mt-3 max-w-[21rem] text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
            An account keeps your companies when you switch device, and is what
            a Pro subscription attaches to. The free game plays without one.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The underline field from onboarding. `hero` is the 28px name treatment the
 * front door has always used; email and password sit a step down because two
 * hero fields stacked stop reading as one form.
 *
 * Focus is the rule going full-contrast — a 2px ring box around a borderless
 * field reads as a broken input (see /welcome's name step). The `!` matters:
 * globals.css sets the ring UNLAYERED, which beats a layered utility;
 * important flips that back.
 */
function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  inputRef,
  hero,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  hero?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-center text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
      >
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        className={`mx-auto mt-3 block w-full max-w-[16rem] border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-center font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)] ${
          hero ? "text-[1.75rem]" : "text-[1.125rem]"
        }`}
      />
    </div>
  );
}

function FootLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto mt-3 block text-2xs text-[var(--text-tertiary)] underline underline-offset-4"
    >
      {children}
    </button>
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
