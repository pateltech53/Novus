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
import { isPro, loadEntitlements, onEntitlementsChange, runsRemainingToday } from "@/lib/monetization";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";
import { usePrefetch } from "@/lib/prefetch";

export default function FoundPageWrapper() {
  return (
    <GameProvider>
      <FoundPage />
    </GameProvider>
  );
}

/**
 * O8 · Found the company. Locked industries are aspiration, not annoyance.
 *
 * ── Why this screen knows about the company you already have ─────────────────
 *
 * It is reachable with a run in progress — a bookmark, the back button, the
 * reload the cloud restore performs after adopting a save — and it used to
 * pretend otherwise. Two things went wrong when it did. A free player, who gets
 * one founding a real day, saw NO RUNS LEFT TODAY with no way to reach the
 * company that was sitting in storage the whole time. And a player who DID have
 * a slot left founded straight over a live company: startRun writes the new run
 * to the same key, so the old one went without a record, an autopsy, or a
 * question.
 *
 * So: an open company is offered back first, and founding another one closes it
 * the honest way — through endRun(), which writes it into legacy exactly as
 * Settings does — behind a confirmation that says the name out loud.
 */
function FoundPage() {
  const router = useRouter();
  const game = useGame();
  const upgrade = useUpgrade();
  const saved = game.run;
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState<Industry>("FOOD");
  const [gender, setGender] = useState<Gender>("male");
  const [skipTutorial, setSkipTutorial] = useState(false);
  const [lockedNote, setLockedNote] = useState<string | null>(null);
  /** Armed by the first tap on FOUND IT when a company is already open. */
  const [confirmReplace, setConfirmReplace] = useState(false);
  /** null until mounted — the ledger lives in localStorage. */
  const [slotsLeft, setSlotsLeft] = useState<number | null>(null);
  /**
   * Device Pro opens the eight paid industries. This gate used to read only the
   * static `free` flag, so a player who had just chosen Pro still saw every
   * industry locked — the purchase appeared to do nothing, which is worse than
   * either honest state.
   */
  const [hasPro, setHasPro] = useState(false);
  /**
   * Read after mount, like the two above it, and for a sharper reason.
   *
   * `loadProfile()` used to be called during render. localStorage does not
   * exist on the server, so the returning player's "skip the guided year"
   * checkbox was in the client's tree and not in the server's — a hydration
   * mismatch, which React answers by throwing away that subtree and building
   * it again. The subtree contains the company-name field, so anything already
   * typed into it was discarded: type fast enough on the screen that focuses
   * itself 400ms in, and the name you chose is simply gone.
   */
  const [profile, setProfile] = useState<ReturnType<typeof loadProfile>>(null);
  /*
   * The entitlement half re-reads on every write, not only at mount. Buying Pro
   * from the upgrade screen happens without leaving this page, and reading once
   * meant the grid the player was staring at kept its locks and FOUND IT stayed
   * disabled — the purchase looked like it had failed. The profile stays a
   * one-shot read: a purchase does not rename anybody.
   *
   * `isPro` rather than the raw `pro` flag, to match `industryUnlocked()` in
   * lib/monetization.ts: a chapter seat is Pro for the year, and reading the
   * flag directly locked every paid industry for a classroom that had paid for
   * all of them.
   */
  useEffect(() => {
    const sync = () => {
      setSlotsLeft(runsRemainingToday());
      setHasPro(isPro(loadEntitlements()));
    };
    sync();
    setProfile(loadProfile());
    return onEntitlementsChange(sync);
  }, []);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * …and the field keeps whatever is already in it.
   *
   * This page is server-rendered, so the input exists and accepts typing
   * before React has hydrated — which is the normal state of the screen for a
   * returning player who opens it directly. A controlled input resolves that
   * gap by resetting the DOM to its prop, so the browser's own value loses to
   * an empty string that was decided before the player arrived.
   *
   * Uncontrolled through hydration, then adopted: `maxLength` enforces the
   * same 28 characters the slice below does, so the two can never disagree.
   */
  useEffect(() => {
    const typed = inputRef.current?.value;
    if (typed) setCompanyName(typed.slice(0, 28));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, []);

  // Naming a company is the last thing before the game itself.
  usePrefetch("/play");

  const start = () => {
    /*
     * The ledger is a real calendar day and this screen can sit open across
     * midnight in either direction, so the slot is re-counted at the tap rather
     * than trusted from mount. Without this the confirmation below could close
     * a live company for a founding that startRun would then refuse.
     */
    const left = runsRemainingToday();
    setSlotsLeft(left);
    if (left <= 0) return;

    if (saved && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    // Close it properly first. endRun writes the company into legacy — years
    // survived, what killed it, or that you closed it yourself — which is the
    // whole difference between ending a run and overwriting one.
    if (saved) game.endRun();

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
      {/*
        The company you already have, offered back before the form for a new
        one. It is the first thing on the screen because for a returning player
        it is the only thing they came for.
      */}
      {saved && (
        <section className="mb-6 rounded-[var(--radius-card)] bg-[var(--surface)] p-4 shadow-[var(--e1)]">
          <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
            {saved.alive ? "STILL OPEN" : "CHAPTER SEVEN"}
          </p>
          <p className="mt-1 truncate text-[1.125rem] font-extrabold leading-tight tracking-[-0.01em]">
            {saved.companyName}
          </p>
          <p className="mt-0.5 text-2xs leading-snug text-[var(--text-tertiary)]">
            {saved.alive
              ? `Year ${saved.year}, month ${saved.month}. Right where you left it.`
              : `It went under in year ${saved.year}. The books are still open.`}
          </p>
          <button
            type="button"
            onClick={() => router.push("/play")}
            className="nv-press mt-3 h-12 w-full truncate rounded-[var(--radius-pill)] bg-[var(--action)] px-5 text-sm font-extrabold tracking-[0.06em] text-[var(--n-11)]"
          >
            {saved.alive ? "CONTINUE ▸" : "READ WHAT KILLED IT ▸"}
          </button>
        </section>
      )}

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
        defaultValue=""
        maxLength={28}
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
                onClick={() => {
                  if (ind.free || hasPro) {
                    setIndustry(ind.code);
                    setLockedNote(null);
                    return;
                  }
                  // Both, and they do different jobs. The notification explains
                  // the limit once per session and offers the screen; the note
                  // below names THIS industry and stays put, so the second tap
                  // on a second locked card is still answered by something.
                  setLockedNote(ind.name);
                  upgrade.notify("industries");
                }}
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
        <motion.button
          type="button"
          onClick={() => upgrade.open("industries")}
          className="mt-3 block text-left text-xs leading-relaxed text-[var(--text-secondary)]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {lockedNote} is one of the eight Pro industries.{" "}
          {/* `nowrap`: §7 forbids clickable text breaking across two lines, and
              the sentence in front of it is long enough to push this over the
              edge at 320px. The sentence still wraps; the label cannot. */}
          <span className="whitespace-nowrap font-bold text-[var(--color-prestige)] underline underline-offset-4">
            See what Pro adds
          </span>
        </motion.button>
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
        {/*
          design.md §1.5, the strictest rule in the system: the accent paints
          at most ONE element per screen, and it belongs to the primary CTA.
          With a company still open the primary action is continuing it, so
          this button steps down to a surface while CONTINUE takes the orange.
          On an empty device it is the primary CTA and keeps it.
        */}
        <button
          type="button"
          onClick={start}
          disabled={!valid || slotsLeft === 0}
          className={`w-full truncate rounded-[var(--radius-card)] px-5 py-4 text-base font-extrabold tracking-[0.06em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35 ${
            saved
              ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[var(--e1)] hover:bg-[var(--surface-overlay)]"
              : "bg-[var(--action)] text-[var(--n-11)] hover:bg-[var(--action-hover)] active:bg-[var(--action-press)]"
          }`}
        >
          {slotsLeft === 0
            ? "NO RUNS LEFT TODAY"
            : saved && confirmReplace
              ? "TAP AGAIN TO REPLACE IT ▸"
              : "FOUND IT ▸"}
        </button>

        {/* Named, because "are you sure?" is not a question anyone reads. And
            a way back out, because an armed confirmation with no exit is a
            trap rather than a safeguard. */}
        {saved && confirmReplace && slotsLeft !== 0 && (
          <>
            <p className="mt-2 text-center text-2xs leading-snug text-[var(--text-tertiary)]">
              This files {saved.companyName} away for good. Year {saved.year}{" "}
              goes into your legacy — the company does not come back.
            </p>
            <button
              type="button"
              onClick={() => setConfirmReplace(false)}
              className="mx-auto mt-1 flex min-h-11 w-full items-center justify-center text-2xs text-[var(--text-tertiary)] underline underline-offset-4"
            >
              Keep {saved.companyName}
            </button>
          </>
        )}

        {slotsLeft === 0 &&
          (saved ? (
            <p className="mt-2 text-center text-2xs leading-snug text-[var(--text-tertiary)]">
              One company a day on the free plan. {saved.companyName} is still
              yours — continue it above, or found another tomorrow.
            </p>
          ) : (
            /*
             * The one place in the app where free stops a player from playing
             * at all rather than from playing wider, so the way out is a
             * control rather than a line of grey text under a disabled button.
             *
             * Only on an empty device. The branch above has a company sitting
             * in storage, and there the honest next step is continuing it —
             * selling Pro to someone who already has somewhere to go would be
             * the upsell talking over the answer.
             */
            <button
              type="button"
              onClick={() => upgrade.open("run_slots")}
              className="mt-2 block w-full text-center text-2xs leading-snug text-[var(--text-secondary)]"
            >
              One company a day on the free plan, and a dead one stays dead.
              Tomorrow, or{" "}
              <span className="whitespace-nowrap font-bold text-[var(--color-prestige)] underline underline-offset-4">
                three a day with Pro
              </span>
              .
            </button>
          ))}
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
