"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { GameProvider, useGame } from "@/lib/state/GameProvider";
import { FounderPortrait } from "@/components/FounderAvatar";
import type { Gender } from "@/lib/engine/avatar";
import { INDUSTRIES } from "@/lib/engine/constants";
import type { Industry } from "@/lib/engine/types";
import { loadProfile } from "@/lib/engine/save";
import { loadEntitlements, runsRemainingToday } from "@/lib/monetization";

export default function FoundPageWrapper() {
  return (
    <GameProvider>
      <FoundPage />
    </GameProvider>
  );
}

/** O8 · Found the company. Locked industries are aspiration, not annoyance. */
function FoundPage() {
  const router = useRouter();
  const game = useGame();
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState<Industry>("FOOD");
  const [gender, setGender] = useState<Gender>("male");
  const [skipTutorial, setSkipTutorial] = useState(false);
  const [lockedNote, setLockedNote] = useState<string | null>(null);
  /** null until mounted — the ledger lives in localStorage. */
  const [slotsLeft, setSlotsLeft] = useState<number | null>(null);
  /**
   * Device Pro opens the eight paid industries. This gate used to read only the
   * static `free` flag, so a player who had just chosen Pro still saw every
   * industry locked — the purchase appeared to do nothing, which is worse than
   * either honest state.
   */
  const [hasPro, setHasPro] = useState(false);
  useEffect(() => {
    setSlotsLeft(runsRemainingToday());
    setHasPro(loadEntitlements().pro);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);
  const profile = loadProfile();

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  const start = () => {
    game.startRun({
      founderName: profile?.founderName ?? "Founder",
      playerAge: profile?.playerAge ?? null,
      companyName: companyName.trim() || "GlorpCo",
      industry,
      rookieMode: profile?.rookieMode ?? true,
      tutorial: !skipTutorial,
      gender,
    });
    router.push("/play");
  };

  const valid = companyName.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
        THE PAPERWORK
      </p>
      <h1 className="mt-1 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
        Name it. Then make it worth something.
      </h1>

      {/* Who you are, before anything else. This is the only avatar decision
          the player ever makes — the wardrobe after this is earned, not
          chosen, so it is worth spending real estate on. Both options render
          at tier 1: everyone starts in the hoodie. */}
      <fieldset className="mt-5">
        <legend className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
          WHO IS FOUNDING IT
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["male", "female"] as Gender[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              aria-pressed={gender === g}
              className={`nv-press flex flex-col items-center rounded-[var(--radius-card)] p-2 ${
                gender === g
                  ? "bg-[var(--surface-elevated)] shadow-[var(--e2)]"
                  : "bg-[var(--surface)]"
              }`}
            >
              <FounderPortrait gender={g} tier={1} size={120} priority />
              <span
                className={`text-2xs font-bold tracking-[0.1em] ${
                  gender === g ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
                }`}
              >
                {g === "male" ? "HE" : "SHE"}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <input
        ref={inputRef}
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value.slice(0, 28))}
        placeholder="Company name"
        autoComplete="off"
        className="mt-6 w-full border-b border-[var(--hairline)] bg-transparent pb-2 text-[1.5rem] font-extrabold tracking-[-0.01em] outline-none transition-colors focus:border-[var(--text-primary)] placeholder:font-medium placeholder:text-[var(--text-tertiary)]"
      />

      <h2 className="mt-8 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
        WHAT BUSINESS ARE YOU IN
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {INDUSTRIES.map((ind) => {
          const selected = industry === ind.code;
          return (
            <li key={ind.code}>
              <button
                type="button"
                onClick={() =>
                  ind.free || hasPro
                    ? (setIndustry(ind.code), setLockedNote(null))
                    : setLockedNote(ind.name)
                }
                className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-card)] border px-3 py-3 text-left transition-colors duration-150 ${
                  selected
                    ? "border-[var(--text-primary)] bg-[var(--surface-elevated)] font-bold"
                    : ind.free || hasPro
                      ? "border-[var(--hairline)] hover:bg-[var(--card)]"
                      : "border-[var(--hairline)] opacity-55"
                }`}
              >
                <span className="text-sm font-semibold leading-tight">{ind.name}</span>
                {!ind.free && !hasPro && <LockGlyph />}
              </button>
            </li>
          );
        })}
      </ul>

      {lockedNote && (
        <motion.p
          className="mt-3 text-xs leading-relaxed text-[var(--text-tertiary)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          This industry requires Pro.
        </motion.p>
      )}

      {profile?.onboarded && (
        <label className="mt-7 flex items-center gap-3 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={skipTutorial}
            onChange={(e) => setSkipTutorial(e.target.checked)}
            className="h-4 w-4 accent-[var(--action)]"
          />
          Skip the guided year — I&rsquo;ve done this before
        </label>
      )}

      <div className="mt-auto w-full pt-8">
        <button
          type="button"
          onClick={start}
          disabled={!valid || slotsLeft === 0}
          className="w-full rounded-[var(--radius-card)] bg-[var(--action)] px-5 py-4 text-base font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-colors duration-150 hover:bg-[var(--action-hover)] active:bg-[var(--action-press)] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {slotsLeft === 0 ? "NO RUNS LEFT TODAY" : "FOUND IT ▸"}
        </button>
        {slotsLeft === 0 && (
          <p className="mt-2 text-center text-2xs leading-snug text-[var(--text-tertiary)]">
            One company a day on the free plan, and a dead one stays dead.
            Tomorrow, or Pro.
          </p>
        )}
      </div>
    </main>
  );
}

function LockGlyph() {
  return (
    <svg width="11" height="13" viewBox="0 0 13 15" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M3 6V4a3.5 3.5 0 1 1 7 0v2" stroke="var(--text-tertiary)" strokeWidth="1.7" strokeLinecap="round" />
      <rect x="1.5" y="6" width="10" height="7.5" rx="1.6" fill="var(--text-tertiary)" />
    </svg>
  );
}
