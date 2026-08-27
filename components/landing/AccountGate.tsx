"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { MAX_NAME_LENGTH, loadAccount, signOut as forgetLocalAccount } from "@/lib/account";
import {
  MIN_AGE,
  TOO_YOUNG_BODY,
  TOO_YOUNG_TITLE,
  isAgeBlocked,
  isOldEnough,
  recordTooYoung,
} from "@/lib/auth/age";
import { loadProfile } from "@/lib/engine/save";
import {
  PROVIDER_LABEL,
  enabledProviders,
  type OAuthProvider,
} from "@/lib/auth/providers";
import { ownedLine, standingLine, standingNote, usePlan } from "@/lib/plan";
import { openBillingPortal } from "@/lib/cloud/billing";
import { ChooseName } from "@/components/ChooseName";
import {
  deleteAccount,
  identity,
  nativeProviderSignIn,
  providerStartUrl,
  requestPasswordReset,
  signIn,
  signOut,
  signUp,
} from "@/lib/cloud/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import { resumePendingPro } from "@/lib/cloud/pending-pro";
import { whenRestored } from "@/lib/cloud/sync";
import { ENTRY_ROUTES, entryRoute } from "@/lib/entry";
import { play } from "@/lib/sound";
import { Turnstile, turnstileEnabled } from "@/components/landing/Turnstile";
import { usePrefetch } from "@/lib/prefetch";
import { storefront, useSellsHere } from "@/lib/commerce";
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
 * own invention, and the localStorage path is unchanged — the game still
 * reads and writes this device first, and the store builds still boot
 * straight into it. What changed is the web's front door: PLAY FREE lands
 * here now instead of walking in anonymously (see enter() in Landing.tsx),
 * so every browser player has an account their companies can attach to. The
 * account is what makes progress portable and a purchase recoverable.
 *
 * ── Five states ────────────────────────────────────────────────────────────
 *
 *   create    the resting state, one button
 *   signUp    name + email + password + policy checkbox
 *   signIn    email + password, with a way to ask for a reset
 *   signedIn  CONTINUE AS <NAME>, over what that account is on
 *   naming    a provider account, one screen old, choosing what to be called
 *
 * ── What signedIn says now ─────────────────────────────────────────────────
 *
 * It used to say a name and nothing else, which was fine while the account was
 * a name and nothing else. It is not any more: a subscription, an island and an
 * industry pack all attach to it, and none of them appeared anywhere a player
 * arriving at the front door could see. Somebody who had paid for Pro that
 * morning met the identical screen they met the day before, scrolled to the
 * prices and found MONTHLY and YEARLY offered to them as though they were on
 * neither — which is what "did my purchase go through?" looks like from the
 * outside. `PlanStanding` below is the answer, and lib/plan.ts holds the
 * wording so this screen and the price list cannot disagree about it.
 *
 * ── The provider buttons ───────────────────────────────────────────────────
 *
 * Google and Apple appear under the form when the deploy switches them on
 * (`enabledProviders()`, which is off by default and says why). They are ONE
 * button doing both jobs — "Continue with Google" is a sign-up the first time
 * and a sign-in every time after — so they sit outside the create/signIn split
 * the email fields are organised by, and the server tells us afterwards which
 * it turned out to be (lib/auth/oauth-profile.ts).
 *
 * On the web pressing one leaves the page: the whole flow is a redirect out to
 * the provider and back to /auth/callback, which finishes it. In the shipped
 * app it never leaves — the system sheet returns a token in-process — so the
 * `naming` state exists to hold the one screen a new account still needs
 * without sending an app that is already open somewhere else and back.
 */

type Mode = "create" | "signUp" | "signIn" | "signedIn" | "naming";

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
  /**
   * The reset link's own flag, and its own line of text.
   *
   * Both used to be shared with the sign-in form, and sharing them is what made
   * the link look dead — see forgot(). `n` counts the taps so an identical
   * repeat of the same sentence still remounts, which is both a change on
   * screen and a fresh announcement to a screen reader.
   */
  const [sending, setSending] = useState(false);
  const [resetSaid, setResetSaid] = useState<{ ok: boolean; text: string; n: number } | null>(null);
  const sayReset = (ok: boolean, text: string) =>
    setResetSaid((prev) => ({ ok, text, n: (prev?.n ?? 0) + 1 }));
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

  /**
   * The providers this deploy offers, and whether the app can do them natively.
   *
   * Seeded synchronously from the environment so the server render and the
   * first client render agree — the alternative is a hydration mismatch, or two
   * buttons appearing under the hero a beat after the page settles. The effect
   * only ever narrows it, and only inside the shipped app: there the list
   * depends on a Capacitor plugin whose presence cannot be known until the
   * bridge is up (lib/cloud/native-oauth.ts).
   */
  const [providers, setProviders] = useState<readonly OAuthProvider[]>(() => enabledProviders());
  const [nativeAuth, setNativeAuth] = useState(false);
  /** The name Google or Apple offered, for the `naming` step to prefill. */
  const [suggestedName, setSuggestedName] = useState<string | null>(null);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /** True only for a mode change the player tapped for — gates the
   *  scroll-and-focus effect below. */
  const wantsFocus = useRef(false);

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

  // Which provider buttons the shipped app can actually honour. A no-op in
  // every browser, where the seed above is already the answer.
  useEffect(() => {
    let alive = true;
    void import("@/lib/cloud/native-oauth").then(({ nativeAuthAvailable, availableProviders }) => {
      if (!alive || !nativeAuthAvailable()) return;
      setNativeAuth(true);
      setProviders(availableProviders());
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (mode !== "signUp" && mode !== "signIn") return;
    /*
     * Only when the player asked. The async session-expiry demotion above
     * also lands in signIn, and with two gates on the landing page both used
     * to yank scroll and raise the keyboard seconds after load, unprompted.
     * `go()` sets the flag; the demotion never does.
     */
    if (!wantsFocus.current) return;
    wantsFocus.current = false;

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
    wantsFocus.current = true;
    setError(null);
    setNotice(null);
    setResetSaid(null);
    setSending(false);
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

    /*
     * ── The age gate, on the door that actually creates the account ────────
     *
     * Onboarding asks first (app/welcome/page.tsx), but this form is reachable
     * without it — the landing page offers it to anyone, and a player can
     * arrive here from a link having never seen a step of onboarding. The
     * check that matters is the one on the surface that makes the account, and
     * this is that surface.
     *
     * Two sources, and either one is enough to refuse: a device that already
     * answered under 13, and a profile written by onboarding that carries an
     * age under 13. Neither is verification — see lib/auth/age.ts, which is
     * candid about what an age screen can and cannot do — but this is where a
     * "no" already given has to be honoured rather than forgotten.
     */
    const profileAge = loadProfile()?.playerAge ?? null;
    if (isAgeBlocked() || (profileAge !== null && !isOldEnough(profileAge))) {
      recordTooYoung();
      setError(`${TOO_YOUNG_TITLE} ${TOO_YOUNG_BODY}`);
      return;
    }

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

    // Only ever true when this account was created BECAUSE a price was
    // pressed — the pricing section records the plan when checkout refuses a
    // signed-out buyer, and this is the moment that refusal stops being true.
    // Answering true means the browser is already leaving for Stripe.
    if (await resumePendingPro()) return;

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
     * Somebody who signed in in order to buy goes to the checkout, not home.
     *
     * This is the whole point of the handoff: the App Store build's GET PRO
     * link opens the pricing section in a browser that has never held the app's
     * session, so pressing a plan there ALWAYS lands here first. Sending them
     * back to the top of the front page and hoping they find the prices a
     * second time is how the purchase gets abandoned.
     *
     * Nothing is skipped by leaving early — the account's save is pulled by
     * restoreOnBoot on whichever page Stripe returns them to.
     */
    if (await resumePendingPro()) return;

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

  /**
   * Continue with Google, or with Apple.
   *
   * ── Two shapes, one button ────────────────────────────────────────────────
   *
   * On the web this is a document navigation and nothing after it runs: the
   * player is going to accounts.google.com and coming back to /auth/callback,
   * which finishes the sign-in and decides where they land. `busy` is set and
   * never cleared on purpose — the page is leaving, and a button that
   * re-enables itself during that is a button that can be pressed twice.
   *
   * In the shipped app it resolves in place. The system sheet hands back a
   * token in the app's own process, so there is no round trip to survive and
   * nowhere to send anybody: a returning player is reloaded into the game, and
   * a brand-new one gets the naming step here rather than on a page this app
   * would have to leave itself to reach.
   */
  const useProvider = async (provider: OAuthProvider) => {
    if (busy) return;
    play("click");
    setBusy(true);
    setError(null);
    setNotice(null);

    if (!nativeAuth) {
      window.location.href = providerStartUrl(provider);
      return;
    }

    const result = await nativeProviderSignIn(provider);
    if (!result.ok) {
      setBusy(false);
      // A closed sheet is a change of mind, not a failure. Saying anything
      // about it turns "I'll do it later" into "something went wrong".
      if (result.reason !== "cancelled") setError(result.message);
      return;
    }

    play("success");
    if (await resumePendingPro()) return;

    if (result.state === "new") {
      setBusy(false);
      setSuggestedName(
        result.suggestedName && result.suggestedName !== "Founder" ? result.suggestedName : null,
      );
      setMode("naming");
      return;
    }

    // A returning player. nativeProviderSignIn has emptied this device, and the
    // account's own saves are pulled by restoreOnBoot when CloudSync remounts —
    // which a client-side navigation never triggers. Same reload signIn does.
    window.location.href = "/";
  };

  /**
   * Ask for a reset email.
   *
   * ── Why this stopped borrowing the sign-in form's state ────────────────────
   *
   * Pressing "Forgot your password?" used to change exactly one thing on the
   * screen, and it was the wrong thing: setting `busy` flipped the full-width
   * button NEXT to it to SIGNING IN…, an action the player had just decided not
   * to take. The link itself did nothing at all. FootLink has no press
   * animation (the scale rule in globals.css keys off `nv-gc`, which it does
   * not carry), its tap highlight is suppressed on the element, it took no
   * `disabled`, its label was a constant — and this was the one handler in the
   * file that never played the click. Five ways to acknowledge a tap and not
   * one of them was wired, so "I pressed it and nothing happened" was a fair
   * description of what the pressed thing did.
   *
   * The answer then landed in the shared notice, ABOVE the link: behind the
   * finger, and shoving the link itself down the page. And because the message
   * is deliberately the same whether or not the address has an account, a
   * second press — which is what anyone does when the first appears to fail —
   * produced a genuinely identical DOM. The button was fine. Every signal it
   * gave was either about something else or somewhere else.
   *
   * So: its own flag, its own label, its own line of text directly beneath it,
   * and the click every other control here already played.
   */
  const forgot = async () => {
    if (sending) return;
    play("click");
    setError(null);
    setNotice(null);
    // The last answer goes the moment a new attempt starts, or it sits there
    // contradicting the label — "enter your email first" in red above a link
    // that is busy sending to the email that was just entered.
    setResetSaid(null);

    if (!email.trim()) {
      sayReset(false, "Enter your email above first, then tap this again.");
      return;
    }

    setSending(true);
    try {
      const result = await requestPasswordReset(email);
      sayReset(result.ok, result.message);
    } finally {
      setSending(false);
    }
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

  /*
   * The account exists and has just been named. Sign-up KEEPS this device — the
   * companies in localStorage are the player's own and keeping them is why they
   * made an account — so `destination()` is meaningful here in a way it never is
   * after a sign-in, and it takes them back to whatever they had open.
   */
  if (mode === "naming") {
    return (
      <div className="w-full text-left">
        <p className="mb-5 text-2xs leading-relaxed text-[var(--text-secondary)]">
          Your account is made. This is the name the game uses — your own
          invention, not the one on your Google or Apple account.
        </p>
        <ChooseName
          suggested={suggestedName}
          onDone={() => {
            const route = destination();
            if (storefront() === "web") router.push(route);
            else window.location.href = appPath(route);
          }}
        />
      </div>
    );
  }

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
                  className="-my-1.5 inline-block py-1.5 font-bold underline underline-offset-2"
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
        <>
          <GateButton onClick={() => void enter()} disabled={entering}>
            {entering ? "OPENING…" : `CONTINUE AS ${displayName.toUpperCase()}`}
          </GateButton>
          <PlanStanding />
        </>
      ) : mode === "create" ? (
        <GateButton onClick={() => go("signUp")}>CREATE ACCOUNT</GateButton>
      ) : null}

      {/* One button per provider, in every state except signedIn — where the
          player already is who they are and a second way in is noise. Renders
          nothing at all on a deploy that has not switched them on, which is
          the default (enabledProviders). */}
      {mode !== "signedIn" && providers.length > 0 ? (
        <div className="mt-4">
          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-[var(--hairline)]" />
            <span className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
              OR
            </span>
            <span className="h-px flex-1 bg-[var(--hairline)]" />
          </div>

          {providers.map((provider) => (
            <ProviderButton
              key={provider}
              provider={provider}
              disabled={busy}
              onClick={() => void useProvider(provider)}
            />
          ))}

          {/* Said once, plainly, before anybody presses anything: this is the
              one thing in Novus that contacts somebody else. The rest of the
              app routes Supabase and Stripe through our own origin precisely so
              it can say that. */}
          <p className="mx-auto mt-3 max-w-[21rem] text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
            This takes you to {providers.map((p) => PROVIDER_LABEL[p]).join(" or ")} and back.
            They tell us your email address and nothing else.
          </p>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mx-auto mt-3 max-w-[21rem] text-center text-2xs leading-relaxed text-[var(--alert)]"
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
          <FootLink onClick={() => void forgot()} disabled={sending}>
            {sending ? "Sending reset link…" : "Forgot your password?"}
          </FootLink>

          {/* Directly under the link that produced it, not in the shared slot
              above — the answer to a tap belongs where the finger already is,
              and putting it overhead moved the link out from under it. Keyed on
              the tap count so an identical repeat still counts as a change. */}
          {resetSaid ? (
            <p
              key={resetSaid.n}
              role="status"
              className={`mx-auto max-w-[21rem] text-center text-2xs leading-relaxed ${
                resetSaid.ok ? "text-[var(--text-secondary)]" : "text-[var(--alert)]"
              }`}
            >
              {resetSaid.text}
            </p>
          ) : null}

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
            a Pro subscription attaches to. It costs nothing — the free game
            stays the whole game.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * What the account under CONTINUE AS is actually on.
 *
 * ── Why it is here and not only in Settings ────────────────────────────────
 *
 * Settings is inside the game, behind a company, behind CONTINUE. The front
 * door is where a player stands when the question occurs to them — they paid
 * ten minutes ago, or on another device, or they are not sure whether the card
 * went through — and answering it here costs one line and saves a support
 * email. It is also the screen a lapsed subscription has to be visible on: Pro
 * ending is not an event the player is told about, so the first honest place to
 * find out is the door.
 *
 * ── Three lines, and the third is the receipt ──────────────────────────────
 *
 * The chip is the standing, the line under it is what that standing gets you in
 * this account's own numbers, and BOUGHT is everything that was paid for once
 * rather than subscribed to — the island, the industry pack. That last line is
 * the only place outside Settings a one-time purchase has ever appeared, which
 * is why it names each item rather than counting them: "1 extra island · Gaming"
 * answers "what did I buy", and "2 items" does not.
 *
 * ── And why it can render nothing ──────────────────────────────────────────
 *
 * `usePlan()` answers null until the client has mounted and read localStorage —
 * see lib/plan.ts. Drawing a FREE chip at a subscriber for one frame is the
 * exact failure this component exists to fix, so the empty first render is the
 * point rather than a gap to fill with a placeholder.
 */
function PlanStanding() {
  const plan = usePlan();
  /* The portal is Stripe's, and it is a web page. A store build must not offer
     a button that cannot open — same rule Settings follows, where the row
     becomes a sentence about where the subscription lives instead. */
  const sells = useSellsHere();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  if (!plan) return null;
  const { entitlements, standing } = plan;
  const bought = ownedLine(entitlements);

  const manage = async () => {
    if (opening) return;
    play("click");
    setOpening(true);
    setFailed(null);
    const opened = await openBillingPortal();
    if (opened) return; // leaving for Stripe
    setOpening(false);
    // The honest failure. A device-local grant (a deploy with no Stripe keys)
    // and a Pro that arrived as a gift both reach this line, and neither has a
    // subscription for the portal to open — which is a fact about the account,
    // not an error the player did something to cause.
    setFailed("There is no Stripe subscription on this account to manage.");
  };

  return (
    /* A plain card, deliberately not `.nv-gc`. The glass press rule is
       `.nv-gc:active`, and `:active` matches ancestors as well as the element
       pressed — so a lens here would shrink the whole standing card every time
       somebody tapped MANAGE OR CANCEL inside it. This is a statement, not a
       control; it should not move when its one button is pressed. */
    <div className="mt-3 rounded-[var(--radius-card)] bg-[var(--surface-elevated)] px-4 py-3 text-left ring-1 ring-[var(--hairline)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          className={`text-2xs font-bold tracking-[0.14em] ${
            standing.pro ? "text-[var(--prestige)]" : "text-[var(--text-tertiary)]"
          }`}
        >
          {standing.badge}
        </span>
        <span className="tnum text-2xs text-[var(--text-tertiary)]">
          {standingLine(entitlements)}
        </span>
      </div>

      <p className="mt-1 text-2xs leading-relaxed text-[var(--text-secondary)]">
        {standingNote(standing)}
      </p>

      {bought ? (
        <p className="mt-1.5 border-t border-[var(--hairline)] pt-1.5 text-2xs leading-relaxed text-[var(--text-secondary)]">
          <span className="font-bold tracking-[0.1em] text-[var(--text-tertiary)]">BOUGHT </span>
          {bought}
        </p>
      ) : null}

      {/* Only for a subscription this player pays for themselves. A chapter
          seat has no card to change and an operator account has no plan, so
          offering either of them a portal is a door onto nothing. */}
      {standing.via === "subscription" && sells === true ? (
        <button
          type="button"
          onClick={() => void manage()}
          disabled={opening}
          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
          /* 44px tall, like FootLink and for the same reason: 12px text is a
             miss-target on a phone held one-handed, and this app is used by
             children on shared school hardware. `-mb-2` takes back the padding
             at the card's edge without shrinking what you can hit. */
          className="-mb-2 mt-0.5 flex min-h-11 items-center py-2.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-tertiary)] underline underline-offset-4 disabled:opacity-50"
        >
          {opening ? "OPENING…" : "MANAGE OR CANCEL"}
        </button>
      ) : null}

      {failed ? (
        <p role="status" className="mt-1 text-2xs leading-relaxed text-[var(--text-tertiary)]">
          {failed}
        </p>
      ) : null}
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
 * Continue with Google / Continue with Apple.
 *
 * Quieter than the primary pill and identical in height to it, because these
 * are alternatives to CREATE ACCOUNT rather than competitors for it — a
 * full-accent Google button next to a full-accent Novus one makes the page ask
 * a question it does not mean to ask.
 *
 * ── The marks are drawn, not fetched ──────────────────────────────────────
 *
 * Both brands require their own mark on a sign-in button, and both publish it
 * on a CDN. Loading it from there would put a request to Google on the landing
 * page of a product for minors before anybody has pressed anything — which is
 * the exact thing docs/LEADERBOARD.md §1.4 rules out and the whole architecture
 * of this app is arranged to avoid. Inline SVG satisfies the guidelines and
 * contacts nobody.
 */
function ProviderButton({
  provider,
  onClick,
  disabled,
}: {
  provider: OAuthProvider;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
      className="nv-gc mt-3 flex h-14 w-full items-center justify-center gap-3 rounded-[var(--radius-card)] nv-on px-6 text-[0.9375rem] font-extrabold tracking-[0.02em] text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {provider === "google" ? <GoogleMark /> : <AppleMark />}
      <span className="truncate">Continue with {PROVIDER_LABEL[provider]}</span>
    </button>
  );
}

/** Google's four-colour G, at the fixed proportions their guidelines set. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** Apple's mark, in the current text colour so it works in both themes —
 *  which is what their guidelines ask for on a non-black button. */
function AppleMark() {
  return (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden focusable="false" fill="currentColor">
      <path d="M14.03 10.62c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.75 2.21 1.1-.05 1.52-.71 2.86-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.34-3.53M11.85 4.1c.61-.74 1.02-1.77.91-2.79-.88.04-1.94.58-2.57 1.32-.56.65-1.05 1.7-.92 2.7.98.08 1.98-.5 2.58-1.23" />
    </svg>
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
      className="nv-gc block h-14 w-full truncate rounded-[var(--radius-card)] nv-t-action px-6 text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}
