"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ENTER, SETTLE_SPRING, useStill } from "@/components/ui/Motion";
import { FounderPortrait } from "@/components/FounderAvatar";
import { PickMark } from "@/components/ui/PickMark";
import { play } from "@/lib/sound";
import { LoopExplainer } from "@/components/LoopExplainer";
import { PrimaryButton, StepShell } from "@/components/StepShell";
import { billingStatus, goToCheckout } from "@/lib/cloud/billing";
import { storefront, useSellsHere, useStorefront } from "@/lib/commerce";
import { FreeEditionDetails } from "@/components/FreeEdition";
import { BuyOnWeb } from "@/components/upgrade/BuyOnWeb";
import { LegalSheet } from "@/components/LegalSheet";
import { PRIVACY, TERMS, type LegalDocument } from "@/lib/legal/documents";
import {
  CADENCE_SUFFIX,
  CHAPTER_CUSTOM_MAX_SEATS,
  CHAPTER_CUSTOM_MIN_SEATS,
  CHAPTER_LICENCES,
  ONE_TIME_PURCHASES,
  PRO_FEATURES,
  MONTHLY_ANNUALISED_CENTS,
  PRO_MONTHLY,
  PRO_PROMISE,
  PRO_YEARLY,
  YEARLY_SAVING_CENTS,
  formatPrice,
  perSeatCents,
  priceLabel,
  grantProLocally,
  type SubscriptionPlan,
} from "@/lib/monetization";
import {
  createLevelMeter,
  mediaSupported,
  requestCapture,
  stopStream,
  type LevelMeter,
} from "@/lib/media/recorder";
import { speak, stopSpeaking } from "@/lib/ai/speech";
import { saveProfile, loadProfile } from "@/lib/engine/save";
import { markIntroSeen } from "@/lib/rewards/intro";
import { accountEntryRoute, ENTRY_ROUTES, entryRoute } from "@/lib/entry";
import {
  MIN_AGE,
  TOO_YOUNG_BODY,
  TOO_YOUNG_TITLE,
  isAgeBlocked,
  isOldEnough,
  isPlausibleAge,
  recordTooYoung,
} from "@/lib/auth/age";
import { usePrefetch } from "@/lib/prefetch";
import { useNavigating } from "@/lib/navigating";
import { loadAccount, MAX_NAME_LENGTH } from "@/lib/account";
import { enabledProviders, PROVIDER_LABEL, type OAuthProvider } from "@/lib/auth/providers";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/credentials";
import {
  signUp,
  signIn,
  nativeProviderSignIn,
  providerStartUrl,
} from "@/lib/cloud/auth";
import { restoreForSignIn } from "@/lib/cloud/sync";
import { appPath } from "@/lib/native/href";
import { Turnstile, turnstileEnabled } from "@/components/landing/Turnstile";
import { ChooseName } from "@/components/ChooseName";

/**
 * Onboarding O1–O7. Nine steps total; O8 (found the company) lives at /found
 * so a returning player can go straight there.
 *
 * The rule for every step here: nothing else on the screen. One idea, one
 * field, one call to action.
 */
type Step =
  | "wave"
  | "age"
  | "too-young"
  | "account"
  | "mic"
  | "explain"
  | "showme"
  | "plans";

const SHARK_EXPLANATION =
  "Novus is your company's whole life. You found it. You keep it alive year by year — and every year, you close it by talking to me. Tap through months for free. The year costs you a pitch.";

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("wave");
  const [age, setAge] = useState("");

  /*
   * A device that has already answered under 13 does not get asked again.
   *
   * Read after mount rather than in the initial state, because localStorage
   * does not exist on the server and this page is statically exported — a
   * first render that disagreed with the client's would be thrown away by
   * hydration, taking whatever had been typed with it. The same reason
   * /found reads its profile in an effect.
   */
  useEffect(() => {
    if (isAgeBlocked()) setStep("too-young");
  }, []);

  useEffect(() => () => stopSpeaking(), []);

  /*
   * Everywhere the button at the end of this can actually go.
   *
   * It warmed "/found" and "/play", and "/play" is not one of them: this
   * screen's CONTINUE pushes `entryRoute()`, and `entryRoute()` answers
   * "/islands" for anyone with a saved run — it stopped answering "/play" when
   * the picker became the front door (lib/entry.ts carries the reasoning).
   * So the heavy route a returning player actually lands on was the one route
   * never warmed, while a route they cannot reach from here was.
   *
   * `ENTRY_ROUTES` is that function's own list, exported for exactly this and
   * described in lib/entry.ts as "prefetch fodder", so the two cannot drift
   * apart again.
   */
  usePrefetch(...ENTRY_ROUTES);

  const [finishing, go] = useNavigating();

  const finish = useCallback(() => {
    /*
     * The last line of defence on this page. `finish()` is what writes the
     * profile and lets the player into the game, and it is reachable from the
     * plans sheet — so it re-checks rather than trusting that the step machine
     * above it was walked in order.
     */
    if (isAgeBlocked() || !isOldEnough(age)) {
      recordTooYoung();
      setStep("too-young");
      return;
    }
    /*
     * An account is required to reach this step (the "account" step below
     * does not call onNext() until one exists), so this is the same kind of
     * re-check the age gate gets above — reachable from the plans sheet, so
     * it does not trust that the step machine was walked in order.
     */
    const account = loadAccount();
    if (!account) {
      setStep("account");
      return;
    }
    const existing = loadProfile();
    saveProfile({
      founderName: account.displayName,
      playerAge: age ? parseInt(age, 10) : null,
      // Under-16s start with the plain-English layer on.
      rookieMode:
        !age || parseInt(age, 10) < 16 ? true : (existing?.rookieMode ?? true),
      onboarded: true,
      micCalibration: existing?.micCalibration ?? null,
    });
    /*
     * A player leaving this screen is taught briefcases by the guided first
     * play — the "briefcases" step in components/Coachmarks.tsx — so the
     * one-time "Introducing Briefcases" sheet that existing players get
     * (components/rewards/BriefcaseIntro.tsx) is recorded as seen here,
     * before they ever reach a screen that could show it. Without this a new
     * player would be told twice in their first ten minutes: once beside the
     * tab bar, then again as a card over the board.
     */
    markIntroSeen();
    // Onboarding is not a reason to lose a company. Someone who walks back
    // through these steps with a run in progress is returned to it.
    //
    // Latched, because `entryRoute()` resolves to /islands for anyone with a run —
    // the heaviest page in the app — and the last step of onboarding used to
    // end on a sheet that simply sat there through the whole chunk.
    go(() => router.push(entryRoute()));
  }, [age, router, go]);

  // AnimatePresence mode="wait" takes exactly ONE child. Rendering conditional
  // siblings leaves it waiting on an exit that never resolves, and the screen
  // freezes on step one.
  const screen = (() => {
    switch (step) {
      case "wave":
        return <Wave key="wave" onNext={() => setStep("age")} />;
      case "age":
        /*
         * ── A neutral age screen ──────────────────────────────────────────
         *
         * The label does not mention 13, and the field does not refuse until
         * CONTINUE is pressed. That is deliberate and it is the standard
         * shape for this gate: a screen that says "you must be 13" above an
         * empty box has told the child exactly what to type, and every
         * regulator's guidance on age screens says not to do that. The
         * refusal explains itself fully — afterwards.
         */
        return (
          <FieldStep
            key="age"
            label="How old are you? "
            value={age}
            onChange={(v) => setAge(v.replace(/\D/g, "").slice(0, 2))}
            placeholder="Age"
            inputMode="numeric"
            cta="CONTINUE"
            onNext={() => {
              if (!isOldEnough(age)) {
                // Recorded before the screen changes, so a reload cannot
                // outrun the write.
                recordTooYoung();
                setStep("too-young");
                return;
              }
              setStep("account");
            }}
            valid={isPlausibleAge(age)}
          />
        );
      case "too-young":
        return <TooYoung key="too-young" />;
      case "account":
        return <AccountStep key="account" onNext={() => setStep("mic")} />;
      case "mic":
        return <MicMoment key="mic" onNext={() => setStep("explain")} />;
      case "explain":
        return <Explanation key="explain" onNext={() => setStep("showme")} />;
      case "showme":
        return <LoopExplainer key="showme" onDone={() => setStep("plans")} />;
      case "plans":
        return <PlansSheet key="plans" onDone={finish} leaving={finishing} />;
    }
  })();

  // Each step animates in on mount (StepShell). No AnimatePresence: its exit
  // never resolves when the direct child is a component rather than a motion
  // element, which strands the whole flow on step one.
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      {screen}
    </main>
  );
}

/**
 * O1 · The opening.
 *
 * What was here: the 23 MB 3D mascot on a washed ground, a headline that faded
 * in after 400ms, and a button that did not arrive for 1.8 SECONDS. Three
 * scattered fades on three different clocks, and the first thing a new player
 * did was wait.
 *
 * What replaces it is one orchestrated move, done in about 600ms: the founder
 * rises, the promise sets under them, the button lands. It also shows the TIER
 * 5 founder — the tuxedo and the gold watch — because that is the thing being
 * offered, and the first screen should say what the game is for.
 */
function Wave({ onNext }: { onNext: () => void }) {
  useEffect(() => {
    play("splash");
    void speak("Welcome to Novus.", "narrator");
  }, []);

  return (
    <StepShell key="wave">
      <div className="flex flex-1 flex-col items-center justify-center">
        <motion.div
          // Rises from below with a spring, like something stepping into frame.
          initial={{ opacity: 0, y: 28, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={SETTLE_SPRING}
        >
          <FounderPortrait gender="male" tier={5} size={272} priority />
        </motion.div>

        <motion.h1
          className="mt-1 text-center text-[2rem] font-extrabold leading-[1.05] tracking-[-0.03em]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...ENTER, delay: 0.14 }}
        >
          Run a company.
          <br />
          Defend it out loud.
        </motion.h1>

        <motion.p
          className="mt-3 max-w-[19rem] text-center text-sm leading-snug text-[var(--n-8)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.24, duration: 0.3 }}
        >
          Months are free. The year costs you a pitch — on camera, to five
          investors who have read your numbers.
        </motion.p>
      </div>

      <motion.div
        className="w-full"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER, delay: 0.34 }}
      >
        <PrimaryButton onClick={onNext}>START</PrimaryButton>
      </motion.div>
    </StepShell>
  );
}

/** O2 / O3 · One field, centered, generous whitespace, orange caret. */
function FieldStep({
  label,
  value,
  onChange,
  placeholder,
  cta,
  onNext,
  valid,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  cta: string;
  onNext: () => void;
  valid: boolean;
  inputMode?: "numeric";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, []);

  return (
    <StepShell>
      <form
        className="flex w-full flex-1 flex-col justify-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onNext();
        }}
      >
        <label
          htmlFor="field"
          className="block text-center text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
        >
          {label.toUpperCase()}
        </label>
        {/*
          Set in the UI face, extrabold — the same treatment as the landing
          headline ("Run a company. Defend it out loud."), so the first thing the
          player types looks like it belongs to the same app as the first thing
          they read.

          This was the display serif at 40px for a while, on the theory that a
          name should look like a signature. In practice a lone serif field two
          screens after an extrabold grotesk headline read as a different
          product, so the whole flow is one voice now. The rule under the field
          rather than a box around it stays — that part was right.
        */}
        <input
          id="field"
          ref={inputRef}
          value={value}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          // focus-visible:outline-none is deliberate and is NOT a loss of a focus
          // indicator: the global ring draws a 2px box, which on a borderless
          // underlined field looks like a broken text input. Focus is shown by
          // the rule thickening and going full-contrast instead — appropriate
          // to the control, and still unmistakable.
          className="nv-name mx-auto mt-5 block w-full max-w-[16rem] border-0 border-b-2 border-[var(--n-5)] bg-transparent pb-3 text-center text-[2.25rem] font-extrabold leading-[1.15] tracking-[-0.03em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none placeholder:font-bold placeholder:text-[var(--n-6)]"
        />
      </form>
      <div className="mt-auto w-full">
        <PrimaryButton onClick={onNext} disabled={!valid}>
          {cta}
        </PrimaryButton>
      </div>
    </StepShell>
  );
}

/**
 * O3b · The account gate. Mandatory: nothing past this step runs without a
 * real account behind it.
 *
 * ── Why onboarding has this now, when it did not ───────────────────────────
 *
 * The product's own account docs (docs/ACCOUNTS-SETUP.md §8) call an account
 * requirement something Novus deliberately does NOT build, for a real reason:
 * the game is sold to schools, played by minors, and the free tier's whole
 * promise is that it needs nothing from anyone. This step overrides that on
 * purpose, at the owner's instruction, accepting the trade — a player with no
 * network cannot found a company any more, and the marketing copy elsewhere
 * ("Free is the whole game", "no account needed") is now only true of the
 * price, not the door. If that call is ever revisited, this is the one step
 * to remove; nothing past it depends on how the account was made.
 *
 * ── Why it is not just `AccountGate` reused ────────────────────────────────
 *
 * `components/landing/AccountGate.tsx` is the web front door's version of this
 * same state machine, and it is deliberately not imported here: on success it
 * navigates the whole page itself (`router.push(destination())`), because on
 * the landing page an account IS the destination. Here an account is a
 * checkpoint in the middle of onboarding — mic, the explainer and the plans
 * sheet still follow — so this step calls `onNext()` instead of leaving.
 *
 * ── Sign-up vs sign-in, same split as everywhere else ──────────────────────
 *
 * Sign-up KEEPS this device (nothing has been played yet, so there is nothing
 * to lose) and continues onboarding. Sign-in belongs to a RETURNING player —
 * this device may hold nobody's save yet, but the account might — so it wipes
 * the device and leaves onboarding entirely for `entryRoute()`, exactly as
 * `AccountSection`'s `submitSignIn` and `AccountGate`'s do; see lib/cloud/auth.ts
 * for why that order (wipe, then pull) is the one that cannot lose a save.
 *
 * The age gate above this step in the switch already ran — this step never
 * asks for an age of its own, and never collects an email before it has.
 */
function AccountStep({ onNext }: { onNext: () => void }) {
  const router = useRouter();
  /** null while the device is being checked, so nothing flashes a form at a
   *  player who turns out to already have an account. */
  const [mode, setMode] = useState<"checking" | "create" | "signIn" | "naming">("checking");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [suggestedName, setSuggestedName] = useState<string | null>(null);

  /** Seeded synchronously, same reasoning as AccountGate: the web build's
   *  answer never changes after mount, so there is nothing to wait for there.
   *  The app narrows it once the bridge confirms what the plugin can honour. */
  const [providers, setProviders] = useState<readonly OAuthProvider[]>(() => enabledProviders());
  const [nativeAuth, setNativeAuth] = useState(false);
  const [legal, setLegal] = useState(false);

  // The narration is about founding a company; it has no business playing
  // over a password field, same reasoning the old sign-in sheet had.
  useEffect(() => stopSpeaking(), []);

  // A resumed onboarding, or a sign-in from elsewhere that never finished
  // founding — skip straight past rather than asking again.
  useEffect(() => {
    if (loadAccount()) {
      onNext();
      return;
    }
    setMode("create");
    // Runs once, at mount only — onNext is stable from useCallback in the
    // parent and re-running this on every render would fight the mode it
    // just set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const canSignUp =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    agreed &&
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
      if (turnstileEnabled()) {
        setCaptchaToken(null);
        setCaptchaNonce((n) => n + 1);
      }
      // A taken email is nearly always a returning player.
      if (result.reason === "taken") setMode("signIn");
      return;
    }

    play("success");
    // Sign-up keeps this device — nothing played yet, nothing to lose — so
    // onboarding simply continues.
    onNext();
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
    setLeaving(true);
    // Sign-in wipes this device and pulls the account's own save — leave
    // onboarding for wherever that account actually belongs, exactly as
    // AccountSection.submitSignIn does and for the same reason (the comment
    // there has the long version).
    await restoreForSignIn();
    const route = accountEntryRoute();
    if (storefront() === "web") router.push(route);
    else window.location.href = appPath(route);
  };

  const useProvider = async (provider: OAuthProvider) => {
    if (busy) return;
    play("click");
    setBusy(true);
    setError(null);

    if (!nativeAuth) {
      // Leaves the page; /auth/callback finishes the round trip and this
      // component never runs again for it.
      window.location.href = providerStartUrl(provider);
      return;
    }

    const result = await nativeProviderSignIn(provider);
    if (!result.ok) {
      setBusy(false);
      // A closed sheet is a change of mind, not a failure.
      if (result.reason !== "cancelled") setError(result.message);
      return;
    }

    play("success");
    if (result.state === "new") {
      setBusy(false);
      setSuggestedName(
        result.suggestedName && result.suggestedName !== "Founder" ? result.suggestedName : null,
      );
      setMode("naming");
      return;
    }

    // A returning player, same as email sign-in above.
    setLeaving(true);
    await restoreForSignIn();
    const route = accountEntryRoute();
    if (storefront() === "web") router.push(route);
    else window.location.href = appPath(route);
  };

  if (mode === "checking") return <StepShell key="account">{null}</StepShell>;

  if (mode === "naming") {
    return (
      <StepShell key="account">
        <div className="flex w-full flex-1 flex-col justify-center">
          <p className="text-center text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
            ONE LAST THING
          </p>
          <h1 className="mt-2 text-center text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
            What should the shark call you?
          </h1>
          <div className="mt-6">
            <ChooseName suggested={suggestedName} onDone={onNext} />
          </div>
        </div>
      </StepShell>
    );
  }

  return (
    <StepShell key="account">
      <div className="flex w-full flex-1 flex-col justify-center">
        <p className="text-center text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
          {mode === "signIn" ? "WELCOME BACK" : "MAKE AN ACCOUNT"}
        </p>
        <h1 className="mt-2 text-center text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
          {mode === "signIn"
            ? "Sign in and your companies come back."
            : "One account keeps your companies safe."}
        </h1>
        <p className="mt-2 text-center text-sm leading-relaxed text-[var(--n-8)]">
          {mode === "signIn"
            ? "Every island, every year, exactly where you left them."
          : "Your free account keeps your companies and progress together, even on a new phone."}
        </p>

        <form
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            void (mode === "signIn" ? submitSignIn() : submitSignUp());
          }}
        >
          {mode !== "signIn" && (
            <AccountField
              id="onboard-name"
              label="YOUR NAME"
              value={name}
              onChange={(v) => setName(v.slice(0, MAX_NAME_LENGTH))}
              placeholder="Your name"
              autoComplete="nickname"
              enterKeyHint="next"
            />
          )}
          <AccountField
            id="onboard-email"
            label="EMAIL"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="next"
            className={mode !== "signIn" ? "mt-4" : undefined}
          />
          <AccountField
            id="onboard-password"
            label="PASSWORD"
            value={password}
            onChange={setPassword}
            placeholder={mode === "signIn" ? "Your password" : `${MIN_PASSWORD_LENGTH} characters or more`}
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signIn" ? "current-password" : "new-password"}
            enterKeyHint={mode === "signIn" ? "go" : "next"}
            className="mt-4"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="mx-auto mt-2 block py-2 text-center text-2xs text-[var(--n-7)] underline underline-offset-4"
          >
            {showPassword ? "Hide password" : "Show password"}
          </button>

          {mode !== "signIn" && (
            <label
              style={{ touchAction: "manipulation" }}
              className="mx-auto mt-4 flex max-w-[21rem] cursor-pointer items-start gap-2.5 py-2 text-left"
            >
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-px h-5 w-5 shrink-0 accent-[var(--action)]"
              />
              <span className="text-2xs leading-relaxed text-[var(--n-8)]">
                I&rsquo;ve read the{" "}
                <button
                  type="button"
                  onClick={() => setLegal(true)}
                  className="inline-block py-1.5 font-bold underline underline-offset-2"
                >
                  privacy policy
                </button>{" "}
                — your email and progress are stored so you can sign back in.
              </span>
            </label>
          )}

          {mode !== "signIn" && turnstileEnabled() ? (
            <Turnstile key={captchaNonce} onToken={setCaptchaToken} />
          ) : null}

          <div className="mt-5">
            <PrimaryButton
              onClick={() => void (mode === "signIn" ? submitSignIn() : submitSignUp())}
              disabled={(mode === "signIn" ? !canSignIn : !canSignUp) || busy || leaving}
            >
              {busy || leaving
                ? mode === "signIn"
                  ? "SIGNING IN…"
                  : "CREATING…"
                : mode === "signIn"
                  ? "SIGN IN"
                  : "CREATE ACCOUNT"}
            </PrimaryButton>
          </div>
        </form>

        {providers.length > 0 ? (
          <div className="mt-4">
            <div className="flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-[var(--hairline)]" />
              <span className="text-2xs font-bold tracking-[0.18em] text-[var(--n-7)]">OR</span>
              <span className="h-px flex-1 bg-[var(--hairline)]" />
            </div>
            {providers.map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => void useProvider(provider)}
                disabled={busy || leaving}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                className="nv-gc mt-3 flex h-14 w-full items-center justify-center gap-3 rounded-[var(--radius-card)] nv-on px-6 text-[0.9375rem] font-extrabold tracking-[0.02em] text-[var(--n-11)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                {provider === "google" ? <GoogleMark /> : <AppleMark />}
                <span className="truncate">Continue with {PROVIDER_LABEL[provider]}</span>
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mx-auto mt-3 max-w-[21rem] text-center text-2xs leading-relaxed text-[var(--color-alert)]">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => {
            setError(null);
            setMode(mode === "signIn" ? "create" : "signIn");
          }}
          className="mx-auto mt-4 block py-2 text-center text-2xs font-bold tracking-[0.06em] text-[var(--n-7)] underline underline-offset-4"
        >
          {mode === "signIn" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </button>
      </div>

      {legal && <LegalSheet doc={PRIVACY} onClose={() => setLegal(false)} />}
    </StepShell>
  );
}

/** One field, on the account step. Same underline treatment as FieldStep's
 *  input, a size down — this screen holds three of them, not one. */
function AccountField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  inputMode,
  enterKeyHint,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>["enterKeyHint"];
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
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        autoCapitalize="none"
        spellCheck={false}
        className="mx-auto mt-2 block w-full max-w-[18rem] border-0 border-b-2 border-[var(--n-5)] bg-transparent pb-2 text-center text-[1.125rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)] transition-colors focus:border-[var(--n-11)] focus-visible:outline-none! placeholder:font-bold placeholder:text-[var(--n-6)]"
      />
    </div>
  );
}

/** Google's four-colour G, drawn rather than fetched — see AccountGate.tsx's
 *  GoogleMark for why: no request to a CDN from a page a minor is looking at. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/** Apple's mark, in the current text colour — see AccountGate.tsx's AppleMark. */
function AppleMark() {
  return (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden focusable="false" fill="currentColor">
      <path d="M14.03 10.62c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.75 2.21 1.1-.05 1.52-.71 2.86-.71 1.33 0 1.71.71 2.88.69 1.19-.02 1.94-1.08 2.67-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.34-3.53M11.85 4.1c.61-.74 1.02-1.77.91-2.79-.88.04-1.94.58-2.57 1.32-.56.65-1.05 1.7-.92 2.7.98.08 1.98-.5 2.58-1.23" />
    </svg>
  );
}

/**
 * O4 · The mic moment. Grants microphone permission, calibrates input level,
 * and teaches the core mechanic — in this product you talk, and things happen.
 * A quiet "type instead" path exists because some users are in class.
 */
function MicMoment({ onNext }: { onNext: () => void }) {
  /*
   * This used to demand the question OUT LOUD — mic permission, a level meter,
   * two seconds of signal — before the game would explain itself. Speaking to
   * the shark is the game's heart, but demanding it from someone who has known
   * the product for forty seconds, possibly on a bus, was a wall dressed as a
   * moment. Now it is a tap: the shark answers, and the microphone waits for
   * the first real pitch, where permission is asked at the moment of use.
   */
  const proceed = useCallback(() => {
    const profile = loadProfile();
    saveProfile({
      founderName: profile?.founderName ?? "",
      playerAge: profile?.playerAge ?? null,
      rookieMode: profile?.rookieMode ?? true,
      onboarded: false,
      micCalibration: profile?.micCalibration ?? null,
    });
    onNext();
  }, [onNext]);

  return (
    <StepShell>
      <div className="flex flex-1 flex-col items-center justify-center">
        <FounderPortrait gender="male" tier={5} size={220} />
        <h1 className="mt-3 text-center text-[1.75rem] font-extrabold tracking-[-0.02em] lg:text-[2rem]">
          Meet the shark.
        </h1>
        <p className="mt-2 max-w-[20rem] text-center text-sm text-[var(--n-8)]">
          He runs the room you&rsquo;ll pitch in. Ask him what this is.
        </p>
      </div>
      <div className="w-full">
        <PrimaryButton onClick={proceed}>WHAT IS NOVUS? ▸</PrimaryButton>
      </div>
    </StepShell>
  );
}

function Explanation({ onNext }: { onNext: () => void }) {
  const [shown, setShown] = useState(0);
  const done = shown >= SHARK_EXPLANATION.length;
  const reduced = useStill();

  /*
   * ── The typewriter, rewritten ─────────────────────────────────────────────
   *
   * It was a 22 ms `setInterval` advancing one character at a time: 194 React
   * commits over 4.3 seconds, none of them frame-aligned, on the fourth screen
   * a new player ever sees. An interval that does not divide the frame budget
   * beats against it — some frames drew two characters, some drew none — so
   * the effect it produced was a stutter rather than typing. The caret beside
   * it ran on `animate-pulse`, a completely separate CSS clock, so the two
   * halves of one effect were never in step.
   *
   * Driven from elapsed time in a rAF now: at most one commit per frame, and
   * the character count is derived from how long has actually passed rather
   * than from how many times a timer managed to fire. On a frame that drops,
   * it catches up instead of falling behind.
   *
   * And it can be skipped. This is the shark explaining the game — the player
   * who has read it, or who reads faster than 45 characters a second, should
   * not be held. Tapping the text completes it; that is what everyone tries
   * first, and it did nothing.
   */
  useEffect(() => {
    void speak(SHARK_EXPLANATION, "narrator");
    if (reduced) {
      setShown(SHARK_EXPLANATION.length);
      return;
    }
    let raf = 0;
    let start = 0;
    const CPS = 45; // characters a second — the old 22 ms interval, honestly stated
    const tick = (now: number) => {
      start ||= now;
      const n = Math.min(
        SHARK_EXPLANATION.length,
        Math.floor(((now - start) / 1000) * CPS),
      );
      setShown((prev) => (prev === n ? prev : n));
      if (n < SHARK_EXPLANATION.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const skip = () => setShown(SHARK_EXPLANATION.length);

  return (
    <StepShell>
      <div className="flex h-44 items-center justify-center">
        <FounderPortrait gender="male" tier={5} size={168} />
      </div>
      {/* The whole block is the skip target: a player who taps the text is
          asking for the rest of it, not for a button they have to find. */}
      <p
        onClick={done ? undefined : skip}
        className={`mt-2 min-h-[9rem] text-[1.0625rem] leading-relaxed text-[var(--n-11)] ${
          done ? "" : "cursor-pointer"
        }`}
      >
        {SHARK_EXPLANATION.slice(0, shown)}
        {!done && (
          <span className="ml-0.5 inline-block h-5 w-[2px] animate-pulse bg-[var(--action)] align-middle" />
        )}
      </p>
      <div className="mt-auto w-full">
        {done && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <PrimaryButton onClick={onNext}>SHOW ME ▸</PrimaryButton>
          </motion.div>
        )}
        <button
          type="button"
          onClick={() => setShown(SHARK_EXPLANATION.length)}
          className={`mx-auto mt-3 block text-xs text-[var(--n-7)] underline underline-offset-4 transition-opacity ${
            done ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          Skip
        </button>
      </div>
    </StepShell>
  );
}

/**
 * O7 · Pro.
 *
 * What was here: two buttons — "START FREE" and "See Pro later" — that ran the
 * same function and made the same offer. A pricing screen with no prices on it,
 * where both paths were the same path. It could not sell Pro and it could not
 * explain free either.
 *
 * ── The order of the argument ──────────────────────────────────────────────
 *
 * The headline says free is the whole game before it says anything Pro costs,
 * because that is the true thing and because the alternative — leading with a
 * locked-feature table — teaches a fourteen-year-old that the version they can
 * afford is the broken one. Free founds a company, runs twelve months, pitches
 * to five investors and lands on Still Standing with everyone else. Pro adds
 * rooms. It never adds an advantage, and PRO_PROMISE sits directly above the
 * buttons rather than in a footnote, because it is the reason a school can hand
 * this to thirty kids at once.
 *
 * ── On the two buttons ─────────────────────────────────────────────────────
 *
 * Same width, same height, one filled with the accent and one with a solid
 * neutral. Free is not an underlined 12px apology at the bottom of a paywall.
 * The label is CHOOSE PRO, not START PRO, because no billing exists in this
 * build and the only thing the tap actually does is record which plan you
 * wanted — see recordPlanIntent(). Saying "start" would be a lie the player
 * discovers at the first locked industry.
 *
 * Prices, seat counts and every entitlement come from lib/monetization.ts so
 * Settings and the eventual paywall read the same numbers as this screen.
 */
function PlansSheet(props: { onDone: () => void; leaving: boolean }) {
  const where = useStorefront();
  if (where === null) return null;
  if (where !== "app-store") return <PaidPlansSheet {...props} />;
  return (
    <StepShell>
      <div className="w-full flex-1">
        <h1 className="mb-5 text-[1.75rem] font-extrabold">Your company starts here.</h1>
        <FreeEditionDetails />
      </div>
      <div className="mt-6 w-full">
        <PrimaryButton onClick={props.onDone} disabled={props.leaving}>START PLAYING</PrimaryButton>
      </div>
    </StepShell>
  );
}

function PaidPlansSheet({
  onDone,
  leaving,
}: {
  onDone: () => void;
  leaving: boolean;
}) {
  const [plan, setPlan] = useState<SubscriptionPlan>(PRO_YEARLY);
  const [panel, setPanel] = useState<"pro" | "chapter">("pro");
  const reduced = useReducedMotion();

  // Null until the status route answers. The line under the button says
  // different things depending on it, so it renders nothing rather than
  // flashing the wrong promise for one frame.
  const [canCharge, setCanCharge] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Whether this build may show a way to pay at all.
   *
   * This is the step the shipped app boots into — public/boot.html sends a
   * first-run cold start straight to /welcome — so for a while the iPhone
   * build's fourth screen was a subscription button that opened Stripe
   * Checkout. That is App Store Guideline 3.1.1, the single most reliably
   * rejected thing an app can do, and 3.1.3(a) closes the "link to our site"
   * escape hatch behind it. In a store build the prices, the chips, the
   * checkout button and the classroom price list are all withdrawn and the
   * step becomes what Pro contains; see lib/commerce.ts.
   *
   * Null until the shell is known, so the prerendered HTML never paints a
   * price for one frame inside the App Store build.
   */
  const sellsHere = useSellsHere();
  const [legal, setLegal] = useState<LegalDocument | null>(null);

  useEffect(() => {
    let alive = true;
    void billingStatus().then((s) => {
      if (alive) setCanCharge(s.configured);
    });
    return () => {
      alive = false;
    };
  }, []);

  const swap = (next: "pro" | "chapter") => {
    play("tab");
    setPanel(next);
  };

  /**
   * Two behaviours behind one button, decided by whether Stripe is wired up.
   *
   * With keys set this opens Stripe's hosted checkout and the player leaves the
   * page; Pro is granted by the webhook when the money lands, never here. With
   * no keys it keeps the pre-billing behaviour exactly — grant on this device,
   * no card, walk into the game — because that is still the honest answer on a
   * deploy that cannot charge anyone.
   *
   * The failure branch deliberately does NOT fall back to the local grant. On a
   * deploy that CAN take money, a checkout that failed and granted Pro anyway
   * would make Pro free to anyone who can drop a request.
   */
  const takePro = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await goToCheckout(plan.id);
    if (result.ok) return; // navigating to Stripe; leave the button busy.

    // The operator's fork: skipped means granted (server-side, already
    // adopted), so continue exactly as a completed purchase would.
    if (result.reason === "admin-cancel") {
      setBusy(false);
      return;
    }
    if (result.reason === "admin-skip") {
      onDone();
      return;
    }

    if (result.reason === "not-configured") {
      grantProLocally(plan.id);
      onDone();
      return;
    }
    if (result.reason === "owned") {
      onDone();
      return;
    }

    setBusy(false);
    setError(
      result.reason === "needs-account"
        ? "Pro attaches to an account, so it survives a new phone. Create one on the front page first — the free game does not need one."
        : result.reason === "signed-out"
          ? // `signed-out` is a refusal, not a network failure — the route
            // answers 200 with `signedIn: false`. Naming the real cause is what
            // stops a player retrying a button that will never work.
            "Nobody is signed in on this browser, and Pro attaches to a Novus account rather than to a device. Sign in on the front page, then choose a plan again."
          : result.message
            ? `Checkout could not be opened. Nothing was charged. (${result.message})`
            : "Checkout could not be opened. Nothing was charged.",
    );
  };

  const enter = reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 };

  return (
    <StepShell>
      <div className="w-full flex-1">
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
          NOVUS PRO
        </p>
        <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">
          Free is the whole game. Pro is more rooms in it.
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
          Same twelve months, same year-end pitch, same scoring, same board.
        </p>

        <AnimatePresence mode="wait" initial={false}>
          {panel === "pro" ? (
            <motion.div
              key="pro"
              initial={enter}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
              transition={{ ...ENTER }}
            >
              <ul className="mt-4">
                {PRO_FEATURES.map((f) => (
                  <li
                    key={f.id}
                    className="border-t border-[var(--hairline)] py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-sm font-extrabold">{f.title}</h2>
                      <span className="shrink-0 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
                        FREE · {f.free.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                      {f.body}
                    </p>
                  </li>
                ))}
              </ul>

              {/* The third line on each chip is the comparison, carried by both
                  options rather than only the one being sold. A yearly plan
                  that shows its saving while the monthly plan hides its true
                  cost is an argument, not a price list.

                  Withdrawn entirely in a store build: a price with no way to
                  pay it is a dead end, and a price with a way to pay it that
                  is not the store's is a rejection. */}
              {sellsHere === true && (
                <div
                  className="mt-4 grid grid-cols-2 gap-2"
                  role="group"
                  aria-label="Billing period"
                >
                  {[PRO_MONTHLY, PRO_YEARLY].map((p) => {
                    const on = p.id === plan.id;
                    const monthly = p.id === PRO_MONTHLY.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          play("click");
                          setPlan(p);
                        }}
                        className={`nv-gc rounded-[var(--radius-card)] px-3 py-2 text-left ${
                          on ? "nv-pick" : ""
                        }`}
                      >
                        {/* The tick rides beside the price rather than under
                            it: this tile is what CHOOSE PRO below will charge,
                            and the two things a player needs to see together
                            are the figure and whether it is the chosen one. */}
                        <span className="flex items-start justify-between gap-2">
                          <span
                            className={`tnum block text-base font-extrabold ${
                              on
                                ? "text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)]"
                            }`}
                          >
                            {formatPrice(p.priceCents)}
                          </span>
                          <PickMark on={on} size={18} className="mt-0.5" />
                        </span>
                        <span
                          className={`block text-2xs font-bold tracking-[0.1em] ${
                            on
                              ? "text-[var(--text-secondary)]"
                              : "text-[var(--text-tertiary)]"
                          }`}
                        >
                          {monthly ? "A MONTH" : "A YEAR"}
                        </span>
                        <span className="tnum mt-0.5 block text-2xs text-[var(--text-tertiary)]">
                          {monthly
                            ? `${formatPrice(MONTHLY_ANNUALISED_CENTS)} a year`
                            : `${formatPrice(YEARLY_SAVING_CENTS)} less`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* What replaces the prices in a store build: a statement of
                  where Pro lives — no price, no link, no button (the 1.0(3)
                  rejection; see BuyOnWeb.tsx). Deliberately no Restore here:
                  onboarding's job is the game, and the note sends an owner
                  to sign-in, after which Pro arrives with their saves. */}
              {sellsHere === false && <BuyOnWeb className="mt-4" />}
            </motion.div>
          ) : (
            <motion.div
              key="chapter"
              initial={enter}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
              transition={{ ...ENTER }}
            >
              <p className="mt-5 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                A CHAPTER IS ONE CLASSROOM OR CLUB
              </p>
              <ul className="mt-1">
                {CHAPTER_LICENCES.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] py-2"
                  >
                    <span className="text-sm font-extrabold">
                      {l.seats} users
                    </span>
                    <span className="text-right">
                      <span className="tnum text-sm font-extrabold">
                        {formatPrice(l.priceCents)}
                      </span>
                      <span className="text-2xs text-[var(--text-tertiary)]">
                        /year
                      </span>
                      <span className="tnum ml-2 text-2xs text-[var(--text-tertiary)]">
                        {formatPrice(perSeatCents(l))} a seat
                      </span>
                    </span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] py-2">
                  <span className="text-sm font-extrabold">
                    Custom
                    <span className="tnum ml-1 text-2xs font-bold text-[var(--text-tertiary)]">
                      {CHAPTER_CUSTOM_MIN_SEATS}–{CHAPTER_CUSTOM_MAX_SEATS}
                    </span>
                  </span>
                  <span className="tnum text-2xs text-[var(--text-tertiary)]">
                    priced by size, on the pricing page
                  </span>
                </li>
              </ul>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                One licence covers every seat for the year. No student is asked
                for a card.
              </p>

              <p className="mt-4 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                ONE-TIME, IN THE CLOSET
              </p>
              {/* Name and price only. Each item's `what` line is carried in
                  lib/monetization.ts for the Closet store, which has the room
                  for it; here the summary below covers all three at once. */}
              <ul className="mt-1">
                {ONE_TIME_PURCHASES.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] py-2"
                  >
                    <span className="text-sm font-extrabold">{item.name}</span>
                    <span className="tnum shrink-0 text-sm font-extrabold">
                      {priceLabel(item)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-[var(--text-tertiary)]">
                Bought once. Cosmetics, industries and slots only.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* The other panel is a price list — classroom licences and the
            one-time buys — so it goes with the prices in a store build. */}
        {sellsHere === true && (
          <button
            type="button"
            onClick={() => swap(panel === "pro" ? "chapter" : "pro")}
            className="mt-2.5 text-xs text-[var(--text-tertiary)] underline underline-offset-4"
          >
            {panel === "pro"
              ? "Classrooms, clubs and one-time buys"
              : "What Pro adds"}
          </button>
        )}
      </div>

      {/* The promise sits above the buttons, not in a footnote, because it is
          the thing a teacher has to be able to read before spending $799. */}
      <div className="mt-4 w-full">
        <p className="border-t border-[var(--hairline)] pt-3.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          {PRO_PROMISE}{" "}
          <span className="text-[var(--text-primary)]">
            That is not a promise — it is the design.
          </span>
        </p>

        {sellsHere === true && (
          <div className="mt-3.5">
            <PrimaryButton onClick={takePro} disabled={busy}>
              {busy ? "OPENING…" : "CHOOSE PRO"}
            </PrimaryButton>
          </div>
        )}

        {/* The one line under the button has to match what the button does.
            Before billing it promised no card; with Stripe wired up that would
            be false, and this is the screen a teacher reads before spending. */}
        <p className="mt-1.5 text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
          {sellsHere !== true || canCharge === null
            ? " "
            : canCharge
              ? `Novus Pro, ${formatPrice(plan.priceCents)}${CADENCE_SUFFIX[plan.cadence]}, billed by Stripe. Renews automatically each ${plan.cadence} until you cancel; cancel any time from Settings.`
              : "No card is taken. Pro switches on for this device until accounts launch."}
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-1.5 text-center text-2xs leading-relaxed text-[var(--color-alert)]"
          >
            {error}
          </p>
        ) : null}

        {/* Same width and height as CHOOSE PRO, solid rather than accented.
            On the web, Free is one of two answers to the question, not the
            way out of a paywall, and a 12px underline at the bottom would
            say otherwise.

            In a store build this IS the only button on the step again — the
            GET PRO link-out came and went with the 1.0(3) rejection — and it
            stays solid there too, deliberately: the one control on a screen
            does not need the accent to be found, and one label on every
            platform keeps the step (and the audit that reads it) simple. */}
        {/* `leaving`, not the `busy` above: that one belongs to CHOOSE PRO and
            its checkout. This is the last tap of onboarding, and it resolves to
            entryRoute() — /play for anyone with a run, the heaviest page in the
            app. It used to sit here unchanged for the whole of that chunk. */}
        <button
          type="button"
          onClick={onDone}
          disabled={leaving}
          className="nv-gc mt-2.5 h-14 w-full rounded-[var(--radius-card)] nv-on text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--text-primary)] disabled:opacity-60"
        >
          {leaving ? "OPENING…" : "CONTINUE FREE"}
        </button>

        {/* Reachable from the screen that offers the subscription, and read
            without leaving the app — a link out to a browser is not a link a
            reviewer can follow on a plane. */}
        <div className="mt-3 flex justify-center gap-5 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
          <button
            type="button"
            onClick={() => setLegal(TERMS)}
            className="-my-2 py-2 underline underline-offset-4"
          >
            TERMS OF USE
          </button>
          <button
            type="button"
            onClick={() => setLegal(PRIVACY)}
            className="-my-2 py-2 underline underline-offset-4"
          >
            PRIVACY
          </button>
        </div>
      </div>

      {legal && <LegalSheet doc={legal} onClose={() => setLegal(null)} />}
    </StepShell>
  );
}

/**
 * The refusal. A full stop, not a form.
 *
 * There is deliberately no "go back" and no "I typed that wrong" button: a
 * control that returns to the age field is the gate deleting itself, and one
 * that a child can find in two seconds is not a gate. The copy carries the
 * recovery path instead — it is honest about being recoverable, and it costs
 * an adult thirty seconds while costing a child the intent to do it.
 *
 * It says what the rule is, that it is the law rather than a judgement about
 * them, and when they can come back. Nothing here scolds a thirteen-year-old
 * for being thirteen.
 */
function TooYoung() {
  const [legal, setLegal] = useState<LegalDocument | null>(null);
  return (
    <StepShell>
      <div className="flex w-full flex-1 flex-col justify-center text-center">
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] text-[var(--n-11)]">
          {TOO_YOUNG_TITLE}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          {TOO_YOUNG_BODY}
        </p>
        <p className="mt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
          You need to be {MIN_AGE} or older. If you typed the wrong number,
          clearing this site&rsquo;s data in your browser settings will let you
          answer again.
        </p>
        <div className="mt-8 flex justify-center gap-5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
          <button
            type="button"
            onClick={() => setLegal(TERMS)}
            className="-my-2 py-2 underline underline-offset-4"
          >
            TERMS
          </button>
          <button
            type="button"
            onClick={() => setLegal(PRIVACY)}
            className="-my-2 py-2 underline underline-offset-4"
          >
            PRIVACY
          </button>
        </div>
      </div>
      {legal && <LegalSheet doc={legal} onClose={() => setLegal(null)} />}
    </StepShell>
  );
}

function MicGlyph() {
  return (
    <svg
      width="24"
      height="30"
      viewBox="0 0 22 28"
      fill="none"
      className="relative"
      aria-hidden="true"
    >
      <rect x="7" y="1.5" width="8" height="14" rx="4" fill="currentColor" />
      <path
        d="M3.5 12.5a7.5 7.5 0 0 0 15 0M11 20v5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
