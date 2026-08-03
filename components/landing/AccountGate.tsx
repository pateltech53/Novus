"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { MAX_NAME_LENGTH, loadAccount, signOut as forgetLocalAccount } from "@/lib/account";
import {
  deleteAccount,
  identity,
  requestPasswordReset,
  signIn,
  signOut,
  signUp,
} from "@/lib/cloud/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import { whenRestored } from "@/lib/cloud/sync";
import { ENTRY_ROUTES, entryRoute } from "@/lib/entry";
import { play } from "@/lib/sound";
import { Turnstile, turnstileEnabled } from "@/components/landing/Turnstile";
import { usePrefetch } from "@/lib/prefetch";
import { storefront } from "@/lib/commerce";
import { appPath } from "@/lib/native/href";

/**
 * How long CONTINUE stays busy before it will take another press.
 *
 * Comfortably longer than any navigation that is going to succeed — a hard
 * one unloads the page in a fraction of this — and short enough that a player
 * whose tap went nowhere is not left holding a dead button.
 */
const RETRY_AFTER_MS = 6000;

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
  /** Second tap arms the delete. Reset by any other action. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** CONTINUE has been pressed and the app is on its way in. */
  const [entering, setEntering] = useState(false);
  /** Reveal the password. Off by default; resets whenever the mode changes. */
  const [showPassword, setShowPassword] = useState(false);
  /**
   * The Turnstile token, when the human check is switched on for this deploy.
   *
   * `captchaNonce` remounts the widget to get a fresh one. Tokens are
   * single-use, so after a failed sign-up the old one is spent and retrying
   * with it would fail a second time for a reason the player cannot see.
   */
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /*
   * Field ids have to be unique per instance, and this component is rendered
   * TWICE on the landing page — once in the hero, once above the footer. With
   * hard-coded ids both copies claimed the same three, which is invalid HTML
   * and breaks the thing labels exist for: tapping "EMAIL" on the footer form
   * moved focus to the hero form, hundreds of pixels up the page. useId gives
   * each instance its own set.
   */
  const uid = useId();
  const fieldId = (name: string) => `${uid}-${name}`;

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
    if (mode !== "signUp" && mode !== "signIn") return;

    /*
     * Bring the form to the player.
     *
     * This component lives partway down a tall landing page, and on a phone
     * the button that opens it is often the only part on screen. Expanding
     * three fields and a button below the fold meant tapping CREATE ACCOUNT
     * appeared to do nothing until you scrolled.
     *
     * Focus first — the focus itself scrolls, and on iOS raises the keyboard,
     * which changes the viewport; scrolling after that lands in the right
     * place rather than fighting it. `block: "center"` leaves the fields above
     * the keyboard instead of behind it.
     */
    firstFieldRef.current?.focus({ preventScroll: true });
    formRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [mode]);

  /** Where a signed-in player goes: back into the company they have open, or
   *  onboarding once, then founding. See lib/entry.ts — CONTINUE has to mean
   *  continue, and it used to land a returning player on the found screen. */
  const destination = () => entryRoute();

  // All three, because which one it is depends on storage this component reads
  // lazily — and warming the wrong one costs nothing next to a cold push.
  usePrefetch(...ENTRY_ROUTES);

  /**
   * CONTINUE.
   *
   * ── Why it waits ───────────────────────────────────────────────────────────
   *
   * `destination()` reads localStorage, and on a device that has never seen
   * this account — a new phone, a cleared browser, the next machine in a
   * computer lab — the company that answers it is still arriving from the
   * server. Pressing CONTINUE before the boot restore lands routed a returning
   * player into onboarding. whenRestored() resolves immediately once that has
   * settled, which is every press after the first second, and gives up after
   * four seconds so a network that never answers is a pause rather than a
   * locked door (lib/cloud/sync.ts).
   *
   * ── Why it says so ─────────────────────────────────────────────────────────
   *
   * /play is the heaviest route in the app, and a client-side push to it shows
   * nothing at all while its bundle is on the wire. Every other button on this
   * gate reports itself — CREATING…, SIGNING IN… — and the one that carries the
   * most traffic did not, so a slow push was indistinguishable from a dead
   * button. The sound is the other half of that: it fires on the tap itself,
   * before anything has to load.
   *
   * ── Why it navigates twice over ────────────────────────────────────────────
   *
   * A client-side `router.push` is right on the web and wrong in a store
   * build, where a document navigation is what actually leaves this page. And
   * that navigation has to name a FILE — the shell's router serves the bundle's
   * root index.html for any extensionless path, which in this export is the
   * marketing page, so a trailing slash pointed straight back here. See
   * lib/native/href.ts; `appPath` is the whole of the rule.
   *
   * ── And why it lets go ─────────────────────────────────────────────────────
   *
   * `entering` guards against a double tap, and it latched: nothing ever set
   * it back, because the only expected outcome was a navigation that took the
   * page with it. Any outcome that is NOT that — a push that resolves nowhere,
   * a file the shell cannot find — left the one button on the screen dead for
   * good, with a second press swallowed by the guard that was supposed to be
   * protecting it. A navigation unloads this component long before the timer
   * matters; if it is still here, the tap failed and the player gets it back.
   */
  const enter = async () => {
    if (entering) return;
    play("click");
    setEntering(true);
    window.setTimeout(() => setEntering(false), RETRY_AFTER_MS);
    await whenRestored();

    const route = destination();
    if (storefront() === "web") router.push(route);
    else window.location.href = appPath(route);
  };

  const go = (next: Mode) => {
    play("click");
    setError(null);
    setNotice(null);
    setConfirmDelete(false);
    setShowPassword(false);
    setCaptchaToken(null);
    setCaptchaNonce((n) => n + 1);
    setMode(next);
  };

  const canSignUp =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    agreed &&
    // Only a gate when the check is actually configured. With no site key the
    // widget renders nothing and the server requires nothing.
    (!turnstileEnabled() || !!captchaToken);

  const canSignIn = email.trim().length > 0 && password.length > 0;

  const submitSignUp = async () => {
    if (!canSignUp || busy) return;
    setBusy(true);
    setError(null);

    const result = await signUp(email, password, name, captchaToken);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);

      // The token is spent whatever the outcome — Turnstile tokens are
      // single-use — so a fresh widget is needed before the player can try
      // again, or the second attempt fails for an invisible reason.
      if (turnstileEnabled()) {
        setCaptchaToken(null);
        setCaptchaNonce((n) => n + 1);
      }

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

  /**
   * Delete the account, on the second tap.
   *
   * Two taps rather than a modal: the confirmation is the label changing to
   * say what is about to happen, which is harder to click through on autopilot
   * than a dialog with an OK button. Reloads on success for the same reason
   * sign-out does — the device has just been emptied and every screen holding
   * those values in memory needs to re-read them.
   */
  const remove = async () => {
    if (busy) return;
    if (!confirmDelete) {
      play("click");
      setError(null);
      setNotice(null);
      setConfirmDelete(true);
      return;
    }

    setBusy(true);
    const result = await deleteAccount();
    if (!result.ok) {
      setBusy(false);
      setConfirmDelete(false);
      setError(result.message ?? "Could not delete the account.");
      return;
    }
    window.location.href = "/";
  };

  return (
    <div className="w-full">
      {(mode === "signUp" || mode === "signIn") && (
        <form
          ref={formRef}
          className="mb-1"
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === "signUp" ? submitSignUp() : submitSignIn());
          }}
        >
          {mode === "signUp" && (
            <Field
              id={fieldId("name")}
              inputRef={firstFieldRef}
              label="YOUR NAME"
              value={name}
              onChange={(v) => setName(v.slice(0, MAX_NAME_LENGTH))}
              placeholder="Your name"
              autoComplete="nickname"
              enterKeyHint="next"
              hero
            />
          )}

          <Field
            id={fieldId("email")}
            inputRef={mode === "signIn" ? firstFieldRef : undefined}
            label="EMAIL"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            type="email"
            inputMode="email"
            enterKeyHint="next"
            autoComplete="email"
            className={mode === "signUp" ? "mt-5" : undefined}
          />

          <Field
            id={fieldId("password")}
            label="PASSWORD"
            value={password}
            onChange={setPassword}
            placeholder={mode === "signUp" ? `${MIN_PASSWORD_LENGTH} characters or more` : "Your password"}
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            enterKeyHint={mode === "signUp" ? "done" : "go"}
            className="mt-5"
          />

          {/* A reveal, because the alternative is a teenager typing eight or
              more characters blind on a phone keyboard and being told the
              password is wrong with no way to see why. Defaults to hidden and
              resets on every mode change, so it cannot be left on. */}
          <FootLink onClick={() => setShowPassword((v) => !v)}>
            {showPassword ? "Hide password" : "Show password"}
          </FootLink>

          {mode === "signUp" && (
            <label
              style={{ touchAction: "manipulation" }}
              className="mx-auto mt-5 flex max-w-[21rem] cursor-pointer items-start gap-2.5 py-2 text-left"
            >
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                // 20px rather than 16px, and the whole label row is the target.
                className="mt-px h-5 w-5 shrink-0 accent-[var(--action)]"
              />
              <span className="text-2xs leading-relaxed text-[var(--text-secondary)]">
                I&rsquo;ve read the{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  // inline-block + py gives the link a real hit area without
                  // breaking the sentence it sits inside.
                  className="inline-block py-1.5 font-bold underline underline-offset-2"
                >
                  privacy policy
                </Link>{" "}
                — the short version: your email and progress are stored so you
                can sign back in, your video never leaves this device, words are
                judged, voices are not.
              </span>
            </label>
          )}

          {/* The human check. Renders nothing, and requires nothing, unless
              NEXT_PUBLIC_TURNSTILE_SITE_KEY is set — see Turnstile.tsx for why
              the script is loaded here rather than in the root layout. */}
          {mode === "signUp" && turnstileEnabled() ? (
            <Turnstile key={captchaNonce} onToken={setCaptchaToken} />
          ) : null}

          {/* The real submit, INSIDE the form.
              It used to sit outside with a hidden <button type="submit"> to
              keep Enter working. That works, but password managers look for a
              submit control within the form to decide whether they have just
              seen a login — so an offer to save the password never appeared,
              on the one screen where saving it matters most. */}
          <div className="mt-6">
            <GateButton
              type="submit"
              disabled={(mode === "signUp" ? !canSignUp : !canSignIn) || busy}
            >
              {busy
                ? mode === "signUp"
                  ? "CREATING…"
                  : "SIGNING IN…"
                : mode === "signUp"
                  ? "CREATE ACCOUNT"
                  : "SIGN IN"}
            </GateButton>
          </div>
        </form>
      )}

      {mode === "signedIn" ? (
        <GateButton onClick={() => void enter()} disabled={entering}>
          {entering ? "OPENING…" : `CONTINUE AS ${displayName.toUpperCase()}`}
        </GateButton>
      ) : mode === "create" ? (
        <GateButton onClick={() => go("signUp")}>CREATE ACCOUNT</GateButton>
      ) : null}

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
        <>
          <FootLink onClick={() => void leave()} disabled={busy}>
            Not {displayName}? Sign out on this device
          </FootLink>

          {/* The privacy policy promises deletion is real and immediate. A
              promise whose only implementation is an email address is a slower
              promise, so it is a button — behind one confirmation, because it
              cannot be undone and this is a product for teenagers. */}
          <FootLink onClick={() => void remove()} disabled={busy}>
            {confirmDelete
              ? "Tap again to permanently delete your account"
              : "Delete my account"}
          </FootLink>
        </>
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
  inputMode,
  enterKeyHint,
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
  /** Which soft keyboard to raise. `email` puts @ and . on the front row. */
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  /** What the phone's return key says: Next through the form, Go to submit. */
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>["enterKeyHint"];
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
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        autoCapitalize="none"
        spellCheck={false}
        className={`mx-auto mt-3 block w-full max-w-[16rem] border-0 border-b-2 border-[var(--hairline)] bg-transparent pb-2 text-center font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)] ${
          hero ? "text-[1.75rem]" : "text-[1.125rem]"
        }`}
      />
    </div>
  );
}

/**
 * The secondary actions under the button — switch mode, forgot password, sign
 * out, delete.
 *
 * The vertical padding is doing real work. As bare 12px text these were 14–18px
 * tall, which is a miss-target on a phone held one-handed, and this app is used
 * by children on shared school hardware. `min-h-11` is 44px — the smallest
 * thing Apple's HIG considers reliably tappable — while `py-3` keeps the hit
 * area centred on the label. The text is unchanged; only what you can hit is.
 */
function FootLink({
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
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
      className="mx-auto flex min-h-11 w-full items-center justify-center px-2 py-3 text-center text-2xs text-[var(--text-tertiary)] underline underline-offset-4 disabled:opacity-50"
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
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      // touch-action: manipulation kills the 300ms double-tap-zoom delay, and
      // the tap highlight is suppressed on the element rather than globally —
      // design.md §6, which is explicit that doing it globally breaks text
      // selection.
      style={{ touchAction:"manipulation", WebkitTapHighlightColor:"transparent" }}
      className="nv-gc block h-14 w-full truncate rounded-[var(--radius-pill)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}
