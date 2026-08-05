"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import {
  ASSET_CATALOG,
  assetById,
  availableAssets,
  holdingsValue,
  type AssetDef,
  type AssetKind,
  type Holding,
} from "@/lib/engine/holdings";
import { S_UNIT, STAGE_NAME } from "@/lib/engine/constants";
import type { StageNum } from "@/lib/engine/types";
import { fmtMoney, fmtPct } from "@/lib/engine/format";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";
import { ScreenSheet } from "@/components/screens/ScreenSheet";

/**
 * Assets — the long game. Everything on this screen is revalued at the close of
 * each fiscal year and can be sold back to cash, which is the whole reason it
 * exists: the company is a machine for buying things that outlive the company.
 *
 * Buying and selling are props, not imports. This screen never mutates the run —
 * the provider owns that, and a screen that mutates state is a screen that
 * double-applies on a double tap.
 */

/**
 * Brand green and red are tuned to sit on navy. On the white card they go muddy,
 * so gains/losses use these darkened variants. Tailwind can't see a runtime
 * string, so these ride in via `style`.
 */
const UP = "var(--solvency)";
const DOWN = "var(--alert)";

const TABS: { kind: AssetKind; label: string }[] = [
  { kind: "company", label: "COMPANY" },
  { kind: "personal", label: "PERSONAL" },
];

const TAB_LINE: Record<AssetKind, string> = {
  company:
    "What the company owns instead of rents. Revalued every fiscal year, sellable whenever you need the cash more than the thing.",
  personal:
    "What you own, not the company. It survives the company — which, statistically, is the point.",
};

const STAT_LABEL: Record<NonNullable<AssetDef["effect"]>["stat"], string> = {
  qual: "Quality",
  brand: "Brand",
  gm_pt: "Gross margin",
  morale: "Morale",
};

export function AssetsScreen({
  onClose,
  onBuy,
  onSell,
}: {
  onClose: () => void;
  onBuy: (defId: string) => void;
  onSell: (holdingId: string) => void;
}) {
  const { run } = useGame();
  const [kind, setKind] = useState<AssetKind>("company");
  /** Selling is irreversible, so it takes two taps. Holding id mid-confirm. */
  const [confirmSell, setConfirmSell] = useState<string | null>(null);

  // Escape closes the sheet — the scrim isn't the only way out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // An armed SELL disarms itself. A confirm left sitting for a minute is not
  // a confirm, it's a misfire waiting to happen.
  useEffect(() => {
    if (!confirmSell) return;
    const t = setTimeout(() => setConfirmSell(null), 5000);
    return () => clearTimeout(t);
  }, [confirmSell]);

  const owned = useMemo<{ holding: Holding; def: AssetDef }[]>(() => {
    if (!run) return [];
    return run.holdings
      .map((holding) => ({ holding, def: assetById(holding.defId) }))
      .filter(
        (row): row is { holding: Holding; def: AssetDef } =>
          !!row.def && row.def.kind === kind,
      );
  }, [run, kind]);

  const forSale = useMemo<AssetDef[]>(() => {
    if (!run) return [];
    // One of each: a second identical warehouse is bookkeeping, not a decision.
    const ownedIds = new Set(run.holdings.map((h) => h.defId));
    return availableAssets(run, kind).filter((def) => !ownedIds.has(def.id));
  }, [run, kind]);

  // The Closet's aspiration pattern: the next few stage-locked assets render
  // quiet but whole, so a Stage-1 player can see the flagship from the garage.
  // Capped at three — a full preview of the catalogue is a spoiler, a glimpse
  // is a reason to grow.
  const horizon = useMemo<AssetDef[]>(() => {
    if (!run) return [];
    return ASSET_CATALOG.filter(
      (def) => def.kind === kind && def.minStage > run.stage,
    )
      .sort((a, b) => a.minStage - b.minStage || a.priceS - b.priceS)
      .slice(0, 3);
  }, [run, kind]);

  const sell = useCallback(
    (holdingId: string) => {
      if (confirmSell !== holdingId) {
        setConfirmSell(holdingId);
        return;
      }
      setConfirmSell(null);
      onSell(holdingId);
    },
    [confirmSell, onSell],
  );

  if (!run) return null;

  const S = S_UNIT[run.stage];
  const totalValue = holdingsValue(run, kind);
  const totalPaid = owned.reduce((sum, row) => sum + row.holding.paid, 0);
  const gain = totalValue - totalPaid;
  const gainPct = totalPaid > 0 ? (gain / totalPaid) * 100 : 0;

  return (
    <ScreenSheet
      label="Assets"
      closeLabel="Close assets"
      workspace
      onClose={onClose}
      title="Assets"
      blurb={TAB_LINE[kind]}
      /*
       * Pinned with the header rather than under it. It is the control that
       * decides which of the two ledgers below you are reading, and a control
       * that scrolls away is one you have to go back and find.
       */
      subnav={
        <div
          role="tablist"
          aria-label="Asset ledger"
          className="flex gap-1 rounded-full bg-[var(--chip)] p-1"
        >
          {TABS.map((tab) => {
            const active = tab.kind === kind;
            return (
              <button
                key={tab.kind}
                type="button"
                role="tab"
                id={`assets-tab-${tab.kind}`}
                aria-selected={active}
                aria-controls={`assets-panel-${tab.kind}`}
                onClick={() => {
                  setKind(tab.kind);
                  setConfirmSell(null);
                }}
                className={`min-w-0 flex-1 truncate rounded-full px-3 py-2 text-2xs font-extrabold tracking-[0.12em] transition-colors duration-150 ${
                  active
                    ? "bg-[var(--card)] text-[var(--text)] shadow-[var(--e1)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      }
    >
      <div
        role="tabpanel"
        id={`assets-panel-${kind}`}
        aria-labelledby={`assets-tab-${kind}`}
        className="px-3"
      >
        {/* ── Portfolio summary ─────────────────────────────────────────── */}
        <section className="nv-card mt-4 p-4" aria-label="Portfolio">
          <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            {kind === "company" ? "COMPANY HOLDINGS" : "PERSONAL HOLDINGS"}
          </p>
          <p className="tnum mt-1 truncate text-3xl font-extrabold leading-none tracking-[-0.02em]">
            {fmtMoney(totalValue)}
          </p>
          <p className="mt-1.5 text-xs leading-snug text-[var(--text-secondary)]">
            {owned.length === 0
              ? "Nothing owned yet. Everything below moves in value at the close of each fiscal year."
              : `${owned.length} ${owned.length === 1 ? "asset" : "assets"}, revalued at the close of every fiscal year.`}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[var(--hairline)] pt-3">
            <Figure label="PAID IN" value={fmtMoney(totalPaid)} />
            <Figure
              label="UNREALISED"
              value={
                totalPaid > 0
                  ? `${signed(gain)} · ${fmtPct(gainPct, true)}`
                  : "—"
              }
              color={totalPaid > 0 ? (gain >= 0 ? UP : DOWN) : undefined}
            />
          </div>
        </section>

        {/* ── Owned ─────────────────────────────────────────────────────── */}
        <SectionHeading
          title="OWNED"
          note="Sell any of it back to cash. The upkeep goes with it."
        />
        {owned.length === 0 ? (
          <EmptyLine
            text={
              kind === "company"
                ? "The company owns nothing. Every month you pay rent, you are buying someone else an asset."
                : "You own nothing. Everything you have is one bad quarter away from being nothing."
            }
          />
        ) : (
          <ul className="mt-2 space-y-2">
            {owned.map(({ holding, def }) => (
              <OwnedCard
                key={holding.id}
                holding={holding}
                def={def}
                arming={confirmSell === holding.id}
                onSell={() => sell(holding.id)}
              />
            ))}
          </ul>
        )}

        {/* ── For sale ──────────────────────────────────────────────────── */}
        <SectionHeading
          title="FOR SALE"
          note="Prices are set at this stage. Appreciation compounds; depreciation does too."
        />
        {forSale.length === 0 ? (
          <EmptyLine text="Nothing left to buy at this stage. Grow the company and the catalogue grows with it." />
        ) : (
          <ul className="mt-2 space-y-2">
            {forSale.map((def) => (
              <ForSaleCard
                key={def.id}
                def={def}
                sUnit={S}
                cash={run.stats.cash}
                pro={run.pro}
                onBuy={() => onBuy(def.id)}
              />
            ))}
          </ul>
        )}

        {/* ── Later ─────────────────────────────────────────────────────── */}
        {horizon.length > 0 && (
          <>
            <SectionHeading
              title="LATER"
              note="The catalogue grows with the company. Stage is the gate — no price skips it."
            />
            <ul className="mt-2 space-y-2">
              {horizon.map((def) => (
                <HorizonCard key={def.id} def={def} />
              ))}
            </ul>
          </>
        )}

        <p className="px-2 pt-5 text-2xs leading-[1.6] tracking-[0.08em] text-[var(--text-tertiary)]">
          HOLDINGS ARE REVALUED ONCE A FISCAL YEAR · SELLING RETURNS TODAY&rsquo;S VALUE, NOT WHAT YOU PAID
        </p>
      </div>
    </ScreenSheet>
  );
}

// ── Owned ──────────────────────────────────────────────────────────────────

function OwnedCard({
  holding,
  def,
  arming,
  onSell,
}: {
  holding: Holding;
  def: AssetDef;
  arming: boolean;
  onSell: () => void;
}) {
  const change = holding.value - holding.paid;
  const changePct = holding.paid > 0 ? (change / holding.paid) * 100 : 0;
  const up = change >= 0;

  return (
    <li className="nv-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-bold leading-snug">
            {def.name}
          </p>
          <p className="mt-0.5 truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            {def.category.toUpperCase()} · BOUGHT FY{holding.purchasedYear}
          </p>
        </div>
        <RateChip appreciation={def.appreciation} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--hairline)] pt-3">
        <Figure label="PAID" value={fmtMoney(holding.paid)} />
        <Figure label="WORTH NOW" value={fmtMoney(holding.value)} />
        <Figure
          label={up ? "GAIN" : "LOSS"}
          value={`${signed(change)}`}
          sub={fmtPct(changePct, true)}
          color={up ? UP : DOWN}
        />
      </div>

      <button
        type="button"
        onClick={onSell}
        aria-label={
          arming
            ? `Confirm sale of ${def.name} for ${fmtMoney(holding.value)}`
            : `Sell ${def.name} for ${fmtMoney(holding.value)}`
        }
        className={`nv-gc mt-3 h-11 w-full rounded-[var(--radius-card)] text-2xs font-extrabold tracking-[0.12em] ${
          arming
            ? "nv-t-action"
            :"border border-[var(--action)]/45 text-[var(--action)]"
        }`}
      >
        {arming
          ? `TAP AGAIN — SELL FOR ${fmtMoney(holding.value)}`
          : `SELL · ${fmtMoney(holding.value)}`}
      </button>
    </li>
  );
}

// ── For sale ───────────────────────────────────────────────────────────────

function ForSaleCard({
  def,
  sUnit,
  cash,
  pro,
  onBuy,
}: {
  def: AssetDef;
  /** Dollars per S unit at the current stage — prices scale as the company does. */
  sUnit: number;
  cash: number;
  pro: boolean;
  onBuy: () => void;
}) {
  const upgrade = useUpgrade();
  const price = def.priceS * sUnit;
  // Pro gates the catalogue, never the outcome (Brand Law 4). The card still
  // renders in full so the lock is honest about what it is withholding.
  const locked = !!def.pro && !pro;
  const short = price - cash;
  const broke = short > 0;
  const disabled = locked || broke;

  return (
    <li className={`nv-card p-4 ${locked ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-bold leading-snug">
            {def.name}
          </p>
          <p className="mt-0.5 truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            {def.category.toUpperCase()}
          </p>
        </div>
        {def.pro && (
          <span className="shrink-0 rounded-[var(--radius-chip)] bg-[var(--color-prestige)] px-1.5 py-0.5 text-2xs font-extrabold tracking-[0.12em] text-[var(--color-navy)]">
            PRO
          </span>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">{def.blurb}</p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <RateChip appreciation={def.appreciation} />
        <UpkeepChip upkeepS={def.upkeepS} sUnit={sUnit} />
        {def.effect && (
          <Chip>
            {STAT_LABEL[def.effect.stat]}{" "}
            {def.effect.amount >= 0 ? "+" : "−"}
            {Math.abs(def.effect.amount)}
            {def.effect.stat === "gm_pt" ? "pt" : ""}
          </Chip>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--hairline)] pt-3">
        <div className="min-w-0">
          <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            PRICE
          </p>
          <p className="tnum truncate text-lg font-extrabold leading-tight">
            {fmtMoney(price)}
          </p>
        </div>
        {/*
          "LOCKED", greyed out, was the whole answer here. It named the state
          and offered no way out of it, on a list where eight cards can be in
          that state at once.

          Now it is a live control — but a quiet one. A gold slab on every
          locked row would turn a catalogue into a pitch, so the lock keeps the
          neutral chip it always had and spends only the prestige INK, which is
          the colour the PRO badge on this same card is already wearing. Being
          short of cash still greys out: that one is answered by playing.
        */}
        {locked ? (
          <button
            type="button"
            onClick={() => upgrade.open("assets")}
            aria-label={`${def.name} is Pro. See what Pro adds.`}
            className="nv-gc h-11 shrink-0 rounded-[var(--radius-pill)] px-6 text-2xs font-extrabold tracking-[0.12em] text-[var(--color-prestige)]"
          >
            SEE PRO
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onBuy}
            aria-label={
              broke
                ? `${def.name}, ${fmtMoney(short)} short`
                : `Buy ${def.name} for ${fmtMoney(price)}`
            }
            className="nv-gc h-11 shrink-0 rounded-[var(--radius-pill)] nv-t-action px-6 text-2xs font-extrabold tracking-[0.12em] disabled:cursor-not-allowed disabled:bg-[var(--chip)] disabled:text-[var(--text-tertiary)]"
          >
            BUY
          </button>
        )}
      </div>

      {disabled && (
        <p className="mt-2 text-xs leading-snug text-[var(--text-secondary)]">
          {locked
            ? "Pro only. It buys you more things to own — never a better number, a longer life, or a higher rank."
            : `You are ${fmtMoney(short)} short. Cash first, then toys.`}
        </p>
      )}
    </li>
  );
}

// ── Later ──────────────────────────────────────────────────────────────────

/**
 * A stage-locked asset, dimmed but shown whole — the Closet's aspiration
 * pattern. No progress bar: stage is the only gate, so the card names the
 * stage and stops. No price or upkeep either — both are quoted in dollars at
 * TODAY'S S unit, and by the stage this unlocks the S unit has grown, so any
 * figure shown here would be a lie. Appreciation is a plain fraction and
 * survives the stage change, so that chip stays.
 */
function HorizonCard({ def }: { def: AssetDef }) {
  return (
    <li className="nv-card p-4 opacity-60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-bold leading-snug">
            {def.name}
          </p>
          <p className="mt-0.5 truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            {def.category.toUpperCase()}
          </p>
        </div>
        {def.pro && (
          <span className="shrink-0 rounded-[var(--radius-chip)] bg-[var(--color-prestige)] px-1.5 py-0.5 text-2xs font-extrabold tracking-[0.12em] text-[var(--color-navy)]">
            PRO
          </span>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
        {def.blurb}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <RateChip appreciation={def.appreciation} />
      </div>

      <p className="mt-3 border-t border-[var(--hairline)] pt-3 text-xs font-bold text-[var(--text-secondary)]">
        Opens at {STAGE_NAME[def.minStage as StageNum]}
      </p>
    </li>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="px-2 pt-6">
      <h3 className="text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
        {title}
      </h3>
      <p className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">{note}</p>
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <p className="mt-2 rounded-[var(--radius-row)] border border-dashed border-[var(--hairline)] px-4 py-4 text-xs leading-relaxed text-[var(--text-secondary)]">
      {text}
    </p>
  );
}

function Figure({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p
        className="tnum mt-0.5 truncate text-xs font-extrabold leading-tight"
        style={color ? { color } : undefined}
      >
        {value}
      </p>
      {sub && (
        <p
          className="tnum truncate text-2xs font-bold leading-tight"
          style={color ? { color } : undefined}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span
      className="tnum rounded-[var(--radius-chip)] bg-[var(--chip)] px-1.5 py-0.5 text-2xs font-bold text-[var(--text-secondary)]"
      style={color ? { color } : undefined}
    >
      {children}
    </span>
  );
}

/** The whole investing idea in six characters: what a year does to this thing. */
function RateChip({ appreciation }: { appreciation: number }) {
  const up = appreciation >= 0;
  return (
    <Chip color={up ? UP : DOWN}>{fmtPct(appreciation * 100, true)}/yr</Chip>
  );
}

/** Upkeep is a monthly burn delta, so a negative one is rent you stop paying. */
function UpkeepChip({ upkeepS, sUnit }: { upkeepS: number; sUnit: number }) {
  if (upkeepS === 0) return <Chip>No upkeep</Chip>;
  const perMonth = Math.abs(upkeepS) * sUnit;
  const heavier = upkeepS > 0;
  return (
    <Chip color={heavier ? DOWN : UP}>
      Burn {heavier ? "+" : "−"}
      {fmtMoney(perMonth)}/mo
    </Chip>
  );
}

/** Money with an explicit sign — a gain should never read like a balance. */
function signed(n: number): string {
  return n >= 0 ? `+${fmtMoney(n)}` : fmtMoney(n);
}
