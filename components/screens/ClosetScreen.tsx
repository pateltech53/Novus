"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SHEET_SPRING } from "@/components/ui/Motion";
import { useGame } from "@/lib/state/GameProvider";
import { FounderPortrait, useWornRewardSkin } from "@/components/FounderAvatar";
import ClosetRewards from "@/components/rewards/ClosetRewards";
import { takeOffRewardSkin } from "@/lib/rewards/wear";
import { Glass } from "@/components/ui/Glass";
import {
  TIERS,
  TITLES,
  unlockedTier,
  type AvatarConfig,
  type Gender,
  type Tier,
  type TierDef,
} from "@/lib/engine/avatar";
import {
  SKINS,
  currentRecord,
  demandText,
  equipSkin,
  isSkinWearable,
  loadWardrobe,
  skinDef,
  skinProgress,
  syncEarnedSkins,
  type SkinId,
} from "@/lib/engine/wardrobe";
import { STAGE_NAME, STAGE_REVENUE_FLOOR } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import { isPro, loadEntitlements, onEntitlementsChange } from "@/lib/monetization";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";
import type { StageNum } from "@/lib/engine/types";

/** The panel only has room for so much name before it stops being a name. */
const NAME_MAX = 18;

/** Distance in stages, spelled out. Index is stages remaining, 1..4. */
const STAGES_AWAY = ["", "one stage up", "two stages up", "three stages up", "four stages up"];

/**
 * Fiscal years this company has already CLOSED, which is one fewer than the
 * year it is currently in — a run in fiscal year 4 has three behind it.
 *
 * The wardrobe demands count closed years, and they have to count this run's
 * as well as the record's, or a founder eight years into their first company
 * would be told they had never closed one.
 */
const closedYears = (run: { year: number } | null): number =>
  run ? Math.max(0, Math.trunc(run.year) - 1) : 0;

/**
 * What a locked tier is actually waiting on.
 *
 * Stage is promoted off TRAILING ANNUAL REVENUE (sim.ts `stageCheck`), not
 * valuation — so the bar is measured against revenue or it would be lying.
 * The fraction is revenue against the floor that tier's stage requires: a
 * plain ratio with nothing anchored or rescaled, which is why the caption can
 * state it in one clause without hedging.
 *
 * `measurable` exists because the floors are tunable knobs. If a floor is ever
 * set to zero there is no fraction to draw, and the row falls back to text
 * rather than rendering a bar that means nothing.
 */
function tierProgress(def: TierDef, stage: StageNum, revenueAnnual: number) {
  const need = STAGE_REVENUE_FLOOR[def.unlocksAtStage];
  const measurable = Number.isFinite(need) && need > 0;
  return {
    need,
    measurable,
    frac: measurable ? Math.max(0, Math.min(1, revenueAnnual / need)) : 0,
    remaining: Math.max(0, need - revenueAnnual),
    stagesAway: def.unlocksAtStage - stage,
  };
}

/**
 * The Closet — a wardrobe you earn, not a shop you browse.
 *
 * This replaces the mix-and-match customiser. That version offered 29 items
 * across skin / suit / shirt / accessory, of which effectively none rendered:
 * the mesh had no separable parts, so every pick collapsed into one flat
 * repaint, and the avatar was invisible on every screen except this one.
 *
 * What replaces it says more with less. Five tiers, unlocked by company stage.
 * Tier 1 is a hoodie in a garage; tier 5 is a tuxedo and a gold watch. You do
 * not pick the tuxedo — the company earns it, and the wardrobe becomes a
 * read-out of the business rather than a storefront.
 *
 * Locked tiers render at FULL fidelity, only quieter, so the player can see the
 * tuxedo from the garage. That reads as something to reach for, which is the
 * opposite of a paywall. (Brand Law 4: nothing purchasable touches progression.)
 */
export function ClosetScreen({
  onClose,
  onChange,
}: {
  onClose: () => void;
  /** Fires on every edit so the parent can persist immediately. */
  onChange: (next: AvatarConfig) => void;
}) {
  const { run } = useGame();
  const upgrade = useUpgrade();
  const [name, setName] = useState(run?.avatar.name ?? "");
  /*
   * Read once on open. This screen only mounts client-side (behind a tap), so
   * the storage reads are safe, and nothing else writes these while it is up.
   *
   * Both initialisers are PURE reads. `loadWardrobe` already reports the fits
   * an old run-count save had earned, so the first paint is correct before
   * anything is written — and writing from a `useState` initialiser would be
   * writing during render, which fires the wardrobe's change event and can set
   * state in another component mid-render.
   */
  const [ledger, setLedger] = useState<SkinId[]>(() => loadWardrobe().earned ?? []);
  const [record] = useState(() => currentRecord(closedYears(run)));
  /*
   * The commit, after paint. It banks a fit whose demands were met on a device
   * that happened to be offline at the time, and it is what persists the
   * migration off the old run-count rule. Once per open; the sync writes
   * nothing when there is nothing to bank.
   */
  const years = closedYears(run);
  useEffect(() => {
    if (syncEarnedSkins(years).length > 0) setLedger(loadWardrobe().earned ?? []);
  }, [years]);
  /*
   * Pro is the one value on this screen that another surface can change while
   * it is open: the upgrade screen opens straight from the wardrobe track, and
   * read-once meant a player bought Pro, landed back on six greyscale portraits
   * and had to close the closet to see what they had paid for.
   */
  const [proActive, setProActive] = useState(() => isPro(loadEntitlements()));
  useEffect(
    () => onEntitlementsChange(() => setProActive(isPro(loadEntitlements()))),
    [],
  );
  const [equipped, setEquipped] = useState<SkinId | null>(() => loadWardrobe().equipped);
  /*
   * The briefcase skin underneath, if any. Read through the store's own hook
   * rather than mirrored into local state, because the ceremony on /rewards
   * and the WEARING row further down this screen both change it, and the
   * portrait at the top has to follow either.
   */
  const wornReward = useWornRewardSkin();

  if (!run) return null;

  const avatar = run.avatar;
  const maxTier = unlockedTier(run.stage);
  const revenueAnnual = run.stats.revenueAnnual;
  const set = (patch: Partial<AvatarConfig>) => onChange({ ...avatar, ...patch });

  // What is actually on the founder's back — storage says equipped, but only
  // an earned fit on an active Pro renders. Everything else is the tier.
  const wornSkin =
    equipped && isSkinWearable(skinDef(equipped), record, proActive, ledger)
      ? equipped
      : null;

  const wear = (id: SkinId) => {
    const next = equipped === id ? null : id; // tap the worn fit to take it off
    // One outfit at a time: putting a fit ON takes any briefcase skin off
    // (lib/rewards/wear.ts does the reverse when a reward skin goes on).
    // Taking a fit OFF leaves the reward record alone, so the founder falls
    // back to whichever is underneath — the reward skin, else the tier.
    if (next) takeOffRewardSkin();
    equipSkin(next); // persists + notifies every mounted FounderAvatar
    setEquipped(next);
  };

  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto bg-[var(--bg)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={SHEET_SPRING}
      // Full-bleed and opaque, so it is a modal whether or not it says so.
      // Settings, its twin, already carried these; this one did not, which
      // left a screen reader walking through the play screen underneath it.
      role="dialog"
      aria-modal="true"
      aria-label="The Closet"
    >
      {/*
        Pinned, and glass — the wardrobe is the longest scroll in the app and
        DONE used to leave with the first swipe. Full-bleed rather than inside
        the column, so the ladder passes under a pane that reaches both edges
        instead of under a strip with the page showing either side of it.
      */}
      <Glass
        as="header"
        className="sticky top-0 z-10 px-5 pt-[max(0.75rem,var(--nv-safe-top))] pb-3"
      >
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <h1 className="text-xl font-extrabold tracking-[-0.01em]">The Closet</h1>
          <button
            type="button"
            onClick={onClose}
            className="nv-gc nv-flat h-10 rounded-[var(--radius-pill)] px-4 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
          >
            DONE
          </button>
        </div>
      </Glass>

      <div className="mx-auto w-full max-w-md px-5 pt-4 pb-[max(2rem,var(--nv-safe-bottom))]">

        {/* Who you are right now — the fit if one is worn, else the briefcase
            skin, else the tier: the same precedence FounderAvatar applies on
            every other screen, so the Closet shows what the masthead shows. */}
        <section className="mt-4 flex flex-col items-center rounded-[var(--radius-card)] bg-[var(--surface)] p-5 shadow-[var(--e2)]">
          <FounderPortrait
            gender={avatar.gender}
            tier={avatar.tier}
            skin={wornSkin ?? wornReward}
            size={200}
            priority
          />
          <p className="mt-2 text-base font-extrabold">
            {avatar.name || run.founderName || "Founder"}
          </p>
          <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            {TIERS[avatar.tier - 1].label.toUpperCase()} · {STAGE_NAME[run.stage].toUpperCase()}
          </p>
        </section>

        {/* Gender is a founder choice, not a stat. Switchable, costs nothing. */}
        <h2 className="mt-7 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
          YOUR FOUNDER
        </h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["male", "female"] as Gender[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => set({ gender: g })}
              aria-pressed={avatar.gender === g}
              className={`nv-gc flex flex-col items-center rounded-[var(--radius-card)] p-3 ${
                avatar.gender === g
                  ? "nv-on shadow-[var(--e2)]"
                  : ""
              }`}
            >
              <FounderPortrait gender={g} tier={avatar.tier} size={96} />
              <span
                className={`mt-1 text-2xs font-bold tracking-[0.1em] ${
                  avatar.gender === g
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)]"
                }`}
              >
                {g === "male" ? "HE" : "SHE"}
              </span>
            </button>
          ))}
        </div>

        {/* The ladder. */}
        <div className="mt-7 flex items-baseline justify-between gap-3">
          <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
            THE LADDER
          </h2>
          <span className="tnum text-2xs text-[var(--text-tertiary)]">
            {fmtMoney(revenueAnnual)} trailing
          </span>
        </div>
        <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
          Every bar below is trailing annual revenue against the floor that tier needs. The
          wardrobe is cosmetic: it never touches your score, your survival or the leaderboard,
          and no tier is for sale at any price.
        </p>

        <ul className="mt-2 space-y-2">
          {TIERS.map((t) => {
            const unlocked = t.tier <= maxTier;
            const worn = avatar.tier === t.tier;
            const p = tierProgress(t, run.stage, revenueAnnual);
            // Stage promotes only at the year-end review, so revenue can clear a
            // floor while the tier is still locked. Say that rather than showing
            // a full bar with nothing to explain it.
            const cleared = p.remaining <= 0;
            // Rounding a real sliver down to "0%" would read as "you have not
            // started", which is a different claim. Say "<1%" instead.
            const pct = Math.round(p.frac * 100);
            const pctLabel = pct === 0 && p.frac > 0 ? "<1%" : `${pct}%`;

            return (
              <li key={t.tier}>
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => set({ tier: t.tier as Tier })}
                  className={`nv-gc flex w-full items-center gap-3 rounded-[var(--radius-card)] p-3 text-left ${
                    worn ? "nv-on shadow-[var(--e2)]" : ""
                  } ${unlocked ? "" : "cursor-default"}`}
                >
                  <FounderPortrait
                    gender={avatar.gender}
                    tier={t.tier as Tier}
                    size={64}
                    dimmed={!unlocked}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-extrabold">{t.label}</span>
                      {worn && (
                        <span className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                          WORN
                        </span>
                      )}
                    </span>

                    {unlocked ? (
                      <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-secondary)]">
                        {t.blurb}
                      </span>
                    ) : (
                      <>
                        <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-secondary)]">
                          Opens at {STAGE_NAME[t.unlocksAtStage]} — {STAGES_AWAY[p.stagesAway]}.
                        </span>

                        {p.measurable ? (
                          <>
                            <span
                              role="meter"
                              aria-label={`${t.label} unlock progress`}
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuetext={
                                cleared
                                  ? "Revenue floor met, promotes at the year-end review"
                                  : `${fmtMoney(revenueAnnual)} of the ${fmtMoney(p.need)} trailing revenue this tier needs`
                              }
                              className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]"
                            >
                              {/* Width is a plain inline style, not a Framer value, so
                                  the true fraction is in the DOM at first paint and the
                                  bar cannot read low if rAF is throttled. */}
                              <span
                                aria-hidden="true"
                                className="block h-full rounded-full transition-[width] duration-500"
                                style={{
                                  width: `${p.frac * 100}%`,
                                  // The tier you are actually climbing reads brighter
                                  // than the ones two stages out. Nothing else changes.
                                  background: p.stagesAway === 1 ? "var(--n-10)" : "var(--n-7)",
                                  transitionTimingFunction: "var(--ease-out)",
                                }}
                              />
                            </span>
                            <span className="mt-1 flex items-baseline justify-between gap-2">
                              <span className="text-2xs leading-snug text-[var(--text-secondary)]">
                                {cleared
                                  ? "Revenue floor met. It opens at the year-end review."
                                  : `${fmtMoney(p.remaining)} of trailing revenue to go.`}
                              </span>
                              <span className="tnum shrink-0 text-2xs text-[var(--text-tertiary)]">
                                {pctLabel}
                              </span>
                            </span>
                          </>
                        ) : (
                          <span className="mt-1 block text-2xs leading-snug text-[var(--text-secondary)]">
                            Needs {fmtMoney(p.need)} of trailing annual revenue.
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* The wardrobe track — Pro's long cosmetic ladder, earned by years played. */}
        <div className="mt-7 flex items-baseline justify-between gap-3">
          <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
            THE WARDROBE TRACK
          </h2>
          {/* The record itself, in the unit the demands are written in. It used
              to read "n runs finished", which was the whole of the old rule and
              is now one clause on two of the six fits. */}
          <span className="tnum text-2xs text-[var(--text-tertiary)]">
            {record.careerYears} {record.careerYears === 1 ? "year" : "years"} · best{" "}
            {record.bestYear}
          </span>
        </div>
        <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
          Six fits, earned by fiscal years survived — how deep you got, and how often. Pro
          wears them; the tiers above stay free and stay the default. Cosmetics never touch
          score, survival, or the leaderboard.
        </p>

        <ul className="mt-2 space-y-2">
          {SKINS.map((s) => {
            const p = skinProgress(s, record, ledger.includes(s.id));
            const wearable = proActive && p.earned;
            const worn = wornSkin === s.id;

            return (
              <li
                key={s.id}
                className={`flex items-start gap-3 rounded-[var(--radius-card)] p-3 ${
                  worn ? "bg-[var(--surface-elevated)] shadow-[var(--e2)]" : "bg-[var(--surface)]"
                }`}
              >
                {/* Locked fits go grey as well as quiet — unlike the ladder,
                    these CAN be locked forever (no Pro), and full-colour art
                    next to a lock would read as a broken button. */}
                <FounderPortrait
                  gender={avatar.gender}
                  tier={avatar.tier}
                  skin={s.id}
                  size={64}
                  dimmed={!wearable}
                  className={wearable ? "" : "grayscale"}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm font-extrabold">{s.label}</span>
                    {worn && (
                      <span className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                        WORN
                      </span>
                    )}
                  </span>

                  {p.earned ? (
                    <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-secondary)]">
                      {proActive
                        ? s.blurb
                        : "Earned — the years are on your record. Pro wears it."}
                    </span>
                  ) : (
                    /*
                     * ONE ROW PER CLAUSE, never one bar for the fit.
                     *
                     * Two of the six ask for two different things, and a single
                     * bar averaging them would tell a player who has done half
                     * of one and none of the other that they are a quarter of
                     * the way to a fit whose harder half they have not started.
                     * The demand is written as an instruction — "Reach fiscal
                     * year 6" — because that is a thing to go and do; the bar
                     * underneath is where they stand.
                     */
                    <>
                      {p.clauses.map((c, i) => (
                        <span key={i} className="mt-1.5 block">
                          <span className="flex items-baseline justify-between gap-2">
                            <span
                              className={`text-2xs leading-snug ${
                                c.met
                                  ? "text-[var(--text-tertiary)] line-through"
                                  : "text-[var(--text-secondary)]"
                              }`}
                            >
                              {demandText(c.demand)}
                            </span>
                            <span className="tnum shrink-0 text-2xs text-[var(--text-tertiary)]">
                              {c.done}/{c.need}
                            </span>
                          </span>
                          <span
                            role="meter"
                            aria-label={`${s.label}: ${demandText(c.demand)}`}
                            aria-valuenow={Math.round(c.frac * 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuetext={`${c.done} of ${c.need}`}
                            className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]"
                          >
                            {/* Plain inline width, same as the ladder: the true
                                fraction is in the DOM at first paint. */}
                            <span
                              aria-hidden="true"
                              className="block h-full rounded-full transition-[width] duration-500"
                              style={{
                                width: `${c.frac * 100}%`,
                                background: c.met ? "var(--n-10)" : "var(--n-7)",
                                transitionTimingFunction: "var(--ease-out)",
                              }}
                            />
                          </span>
                        </span>
                      ))}
                    </>
                  )}
                </span>

                {wearable ? (
                  <button
                    type="button"
                    onClick={() => wear(s.id)}
                    aria-pressed={worn}
                    className={`nv-gc shrink-0 rounded-[var(--radius-pill)] px-3 py-2 text-2xs font-bold tracking-[0.12em] ${
                      worn
                        ? "text-[var(--text-secondary)]"
                        : "nv-on text-[var(--text-primary)] shadow-[var(--e2)]"
                    }`}
                  >
                    {worn ? "EQUIPPED" : "EQUIP"}
                  </button>
                ) : p.earned ? (
                  /*
                   * The sharpest gate in the app, so it gets the one live
                   * control: this fit has been EARNED — the years are on the
                   * record — and the only thing between the founder and
                   * wearing it is the plan. A dead grey chip reading "PRO" was
                   * the answer to that, next to a portrait already greyscaled.
                   */
                  <button
                    type="button"
                    onClick={() => upgrade.open("wardrobe")}
                    aria-label={`${s.label} is earned. Pro wears it. See what Pro adds.`}
                    className="nv-gc shrink-0 rounded-[var(--radius-pill)] px-3 py-2 text-2xs font-bold tracking-[0.12em] text-[var(--color-prestige)]"
                  >
                    PRO
                  </button>
                ) : (
                  <span className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--chip)] px-3 py-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    LOCKED
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
          Tap EQUIPPED to take a fit off and wear your tier again.
        </p>

        {/*
         * The briefcase loop's corner of the Closet — the sealed-cases band
         * (or, signed out, a line saying briefcases need an account) and the
         * reward skin currently worn, with its TAKE OFF. The collection grid
         * itself lives on /rewards now; see the header essay in
         * components/rewards/ClosetRewards.tsx for why it left this screen.
         *
         * Sits inline rather than behind a conditional because the component
         * owns its own three outcomes: the Closet does not need to know
         * whether the player is signed in or whether the server has the
         * rewards schema, and on a deploy without either it renders nothing.
         */}
        <ClosetRewards base={avatar.gender === "female" ? "nova" : "novus"} />

        {/* Name + title. */}
        <h2 className="mt-7 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
          WHAT THEY CALL YOU
        </h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
          onBlur={() => set({ name: name.trim() })}
          placeholder={run.founderName || "Founder"}
          className="mt-2 w-full rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-3 text-base font-semibold outline-none ring-1 ring-[var(--hairline)] focus:ring-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)]"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TITLES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ title: t })}
              className={`nv-gc rounded-[var(--radius-pill)] px-3 py-2 text-2xs font-bold tracking-[0.04em] ${
                avatar.title === t
                  ? "nv-on text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)]"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
