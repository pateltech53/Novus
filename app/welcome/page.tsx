"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FounderPortrait } from "@/components/FounderAvatar";
import { play } from "@/lib/sound";
import { LoopExplainer } from "@/components/LoopExplainer";
import { PrimaryButton, StepShell } from "@/components/StepShell";
import { billingStatus, goToCheckout } from "@/lib/cloud/billing";
import {
  CADENCE_SUFFIX,
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
import { usePrefetch } from "@/lib/prefetch";

/**
 * Onboarding O1–O7. Nine steps total; O8 (found the company) lives at /found
 * so a returning player can go straight there.
 *
 * The rule for every step here: nothing else on the screen. One idea, one
 * field, one call to action.
 */
type Step = "wave" | "name" | "age" | "mic" | "explain" | "showme" | "plans";

const SHARK_EXPLANATION =
  "Novus is your company's whole life. You found it. You keep it alive year by year — and every year, you close it by talking to me. Tap through months for free. The year costs you a pitch.";

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("wave");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");

  useEffect(() => () => stopSpeaking(), []);

  // The paperwork screen is the only place this screen leads.
  usePrefetch("/found");

  const finish = useCallback(() => {
    const existing = loadProfile();
    saveProfile({
      founderName: name.trim() || "Founder",
      playerAge: age ? parseInt(age, 10) : null,
      // Under-16s start with the plain-English layer on.
      rookieMode: !age || parseInt(age, 10) < 16 ? true : (existing?.rookieMode ?? true),
      onboarded: true,
      micCalibration: existing?.micCalibration ?? null,
    });
    router.push("/found");
  }, [name, age, router]);

  // AnimatePresence mode="wait" takes exactly ONE child. Rendering conditional
  // siblings leaves it waiting on an exit that never resolves, and the screen
  // freezes on step one.
  const screen = (() => {
    switch (step) {
      case "wave":
        return <Wave key="wave" onNext={() => setStep("name")} />;
      case "name":
        return (
          <FieldStep
            key="name"
            label="What should the shark call you?"
            value={name}
            onChange={setName}
            placeholder="Your name"
            cta="CONTINUE"
            onNext={() => setStep("age")}
            valid={name.trim().length > 0}
          />
        );
      case "age":
        return (
          <FieldStep
            key="age"
            label="How old are you?"
            value={age}
            onChange={(v) => setAge(v.replace(/\D/g, "").slice(0, 2))}
            placeholder="Age"
            inputMode="numeric"
            cta="CONTINUE"
            onNext={() => setStep("mic")}
            valid={age.length > 0 && parseInt(age, 10) > 0}
          />
        );
      case "mic":
        return <MicMoment key="mic" onNext={() => setStep("explain")} />;
      case "explain":
        return <Explanation key="explain" onNext={() => setStep("showme")} />;
      case "showme":
        return <LoopExplainer key="showme" onDone={() => setStep("plans")} />;
      case "plans":
        return <PlansSheet key="plans" onDone={finish} />;
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
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
        >
          <FounderPortrait gender="male" tier={5} size={272} priority />
        </motion.div>

        <motion.h1
          className="mt-1 text-center text-[2rem] font-extrabold leading-[1.05] tracking-[-0.03em]"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
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
        transition={{ delay: 0.34, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
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

  useEffect(() => {
    void speak(SHARK_EXPLANATION, "narrator");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(SHARK_EXPLANATION.length);
      return;
    }
    const id = setInterval(() => {
      setShown((n) => {
        if (n >= SHARK_EXPLANATION.length) {
          clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, 22);
    return () => clearInterval(id);
  }, []);

  return (
    <StepShell>
      <div className="flex h-44 items-center justify-center">
        <FounderPortrait gender="male" tier={5} size={168} />
      </div>
      <p className="mt-2 min-h-[9rem] text-[1.0625rem] leading-relaxed text-[var(--n-11)]">
        {SHARK_EXPLANATION.slice(0, shown)}
        {!done && <span className="ml-0.5 inline-block h-5 w-[2px] animate-pulse bg-[var(--action)] align-middle" />}
      </p>
      <div className="mt-auto w-full">
        {done && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
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
function PlansSheet({ onDone }: { onDone: () => void }) {
  const [plan, setPlan] = useState<SubscriptionPlan>(PRO_YEARLY);
  const [panel, setPanel] = useState<"pro" | "chapter">("pro");
  const reduced = useReducedMotion();

  // Null until the status route answers. The line under the button says
  // different things depending on it, so it renders nothing rather than
  // flashing the wrong promise for one frame.
  const [canCharge, setCanCharge] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      result.reason === "signed-out"
        ? "Could not reach your account. Check your connection and try again."
        : "Checkout could not be opened. Nothing was charged.",
    );
  };

  const enter = reduced
    ? { opacity: 1, y: 0 }
    : { opacity: 0, y: 8 };

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
              transition={{ duration: reduced ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <ul className="mt-4">
                {PRO_FEATURES.map((f) => (
                  <li key={f.id} className="border-t border-[var(--hairline)] py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-sm font-extrabold">{f.title}</h2>
                      <span className="shrink-0 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
                        FREE · {f.free.toUpperCase()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{f.body}</p>
                  </li>
                ))}
              </ul>

              {/* The third line on each chip is the comparison, carried by both
                  options rather than only the one being sold. A yearly plan
                  that shows its saving while the monthly plan hides its true
                  cost is an argument, not a price list. */}
              <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Billing period">
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
                      className={`nv-press rounded-[var(--radius-card)] px-3 py-2 text-left ${
                        on
                          ? "bg-[var(--surface-elevated)] shadow-[var(--e2)]"
                          : "bg-[var(--surface)]"
                      }`}
                    >
                      <span
                        className={`tnum block text-base font-extrabold ${
                          on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                        }`}
                      >
                        {formatPrice(p.priceCents)}
                      </span>
                      <span className="block text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
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
            </motion.div>
          ) : (
            <motion.div
              key="chapter"
              initial={enter}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
              transition={{ duration: reduced ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
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
                    <span className="text-sm font-extrabold">{l.seats} users</span>
                    <span className="text-right">
                      <span className="tnum text-sm font-extrabold">
                        {formatPrice(l.priceCents)}
                      </span>
                      <span className="text-2xs text-[var(--text-tertiary)]">/year</span>
                      <span className="tnum ml-2 text-2xs text-[var(--text-tertiary)]">
                        {formatPrice(perSeatCents(l))} a seat
                      </span>
                    </span>
                  </li>
                ))}
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

        <button
          type="button"
          onClick={() => swap(panel === "pro" ? "chapter" : "pro")}
          className="mt-2.5 text-xs text-[var(--text-tertiary)] underline underline-offset-4"
        >
          {panel === "pro" ? "Classrooms, clubs and one-time buys" : "What Pro adds"}
        </button>
      </div>

      {/* The promise sits above the buttons, not in a footnote, because it is
          the thing a teacher has to be able to read before spending $299. */}
      <div className="mt-4 w-full">
        <p className="border-t border-[var(--hairline)] pt-3.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          {PRO_PROMISE}{" "}
          <span className="text-[var(--text-primary)]">
            That is not a promise — it is the design.
          </span>
        </p>

        <div className="mt-3.5">
          <PrimaryButton onClick={takePro} disabled={busy}>
            {busy ? "OPENING…" : "CHOOSE PRO"}
          </PrimaryButton>
        </div>

        {/* The one line under the button has to match what the button does.
            Before billing it promised no card; with Stripe wired up that would
            be false, and this is the screen a teacher reads before spending. */}
        <p className="mt-1.5 text-center text-2xs text-[var(--text-tertiary)]">
          {canCharge === null
            ? " "
            : canCharge
              ? `${formatPrice(plan.priceCents)}${CADENCE_SUFFIX[plan.cadence]}, billed by Stripe. Cancel any time.`
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
            Free is one of two answers to the question, not the way out of a
            paywall, and a 12px underline at the bottom would say otherwise. */}
        <button
          type="button"
          onClick={onDone}
          className="nv-press mt-2.5 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--surface-elevated)] text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--text-primary)]"
        >
          CONTINUE FREE
        </button>
      </div>
    </StepShell>
  );
}

function MicGlyph() {
  return (
    <svg width="24" height="30" viewBox="0 0 22 28" fill="none" className="relative" aria-hidden="true">
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
