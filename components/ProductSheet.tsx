"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { specForRun } from "@/lib/engine/industries/index";
import {
  clampPrice,
  earningItems,
  ensurePortfolio,
  liveItems,
  portfolioCap,
  priceHint,
  sanitizeName,
  type IndustrySpec,
  type LineItem,
  type Verdict,
} from "@/lib/engine/portfolio";
import { fmtMoney } from "@/lib/engine/format";
import { S_UNIT } from "@/lib/engine/constants";

/**
 * THE PRODUCT TAB — the things you made, ranked.
 *
 * This is the screen the whole addendum exists for: a player who runs a food
 * company can add a menu item, choose its name and its price, and then watch
 * across fiscal years which items carry the business and which ones are quietly
 * costing a slot.
 *
 * ── The complexity budget, honoured ────────────────────────────────────────
 *
 * Addendum A §2.2 is explicit and it is the hardest constraint here: ONE screen,
 * a ranked list, name + price + one performance number + one trend arrow, and
 * everything else behind a tap. No spreadsheet. If it ever needs a horizontal
 * scroll, features get cut rather than columns added.
 *
 * So: units is the rank (the honest popularity number, and what "top menu items"
 * actually means), a sparkline carries the year-by-year history in the width of a
 * word, and the trend glyph is monochrome because §3.2's accent budget does not
 * extend to data surfaces.
 *
 * ── What is NOT on this screen ─────────────────────────────────────────────
 *
 * No projected revenue. No estimated margin. No recommended price. The launch
 * flow shows the cash you are spending, because that is a fact, and one hedged
 * qualitative sentence about the price IF the player has earned market intuition.
 * Everything quantitative arrives after the year closes. Same rule as the
 * decisions — quantitative after, qualitative before.
 */

export function ProductSheet() {
  const { run } = useGame();
  const [launching, setLaunching] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  if (!run) return null;
  const spec = specForRun(run);
  const p = ensurePortfolio(run);
  const live = liveItems(p);
  const cap = portfolioCap(run);
  const archive = p.items.filter((i) => i.state === "retired" || i.state === "recalled");

  // The launch flow can also be opened by an industry activity, which sets a flag.
  const wantLaunch = launching || !!run.flags.launch_sheet_open;

  if (wantLaunch) {
    return (
      <LaunchFlow
        spec={spec}
        onDone={() => setLaunching(false)}
      />
    );
  }

  const item = detail ? p.items.find((i) => i.id === detail) : null;
  if (item) return <ItemDetail item={item} spec={spec} onBack={() => setDetail(null)} />;

  const ranked = [...earningItems(p)].sort(
    (a, b) => (b.history.at(-1)?.units ?? 0) - (a.history.at(-1)?.units ?? 0),
  );

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
          {spec.reportLabel}
        </h3>
        <span className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
          {live.length} / {cap}
        </span>
      </div>

      {/* The cap, stated as a capability rather than as a game limit. */}
      <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
        {live.length >= cap
          ? `Your team can support ${cap} ${cap === 1 ? spec.noun.toLowerCase() : spec.nounPlural.toLowerCase()} well. You have ${live.length}.`
          : `Room for ${cap - live.length} more before the team is stretched.`}
      </p>

      {ranked.length === 0 && live.length === 0 ? (
        <p className="mt-4 text-sm leading-snug text-[var(--text-secondary)]">
          You have not made anything yet. Nothing sells until you do.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {ranked.map((it) => (
            <ItemRow key={it.id} item={it} spec={spec} onOpen={() => setDetail(it.id)} />
          ))}
          {live
            .filter((i) => i.state === "development")
            .map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{it.name}</span>
                  <span className="block text-2xs text-[var(--text-tertiary)]">
                    {fmtMoney(it.price)} · starts earning next year
                  </span>
                </span>
              </li>
            ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setLaunching(true)}
        disabled={live.length >= cap}
        className="nv-gc mt-4 w-full rounded-[var(--radius-row)] nv-t-action px-4 py-3.5 text-sm font-extrabold tracking-[0.04em] disabled:bg-[var(--n-4)] disabled:text-[var(--n-7)]"
      >
        {live.length >= cap ? "AT CAPACITY — RETIRE SOMETHING FIRST" : `ADD A ${spec.noun.toUpperCase()}`}
      </button>

      {archive.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
            DISCONTINUED ({archive.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {archive.map((it) => {
              const best = it.history.reduce((m, h) => Math.max(m, h.units), 0);
              return (
                <li key={it.id} className="text-2xs leading-snug text-[var(--text-tertiary)]">
                  <span className="font-semibold text-[var(--text-secondary)]">{it.name}</span>
                  {" · "}
                  {it.launchedYear}
                  {it.retiredYear ? `–${it.retiredYear}` : ""}
                  {it.verdict ? ` · ${it.verdict}` : ""}
                  {best > 0 && ` · best year ${best.toLocaleString()} ${spec.demandUnit}`}
                  {it.state === "recalled" && " · recalled"}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── One row ─────────────────────────────────────────────────────────────────

function ItemRow({
  item,
  spec,
  onOpen,
}: {
  item: LineItem;
  spec: IndustrySpec;
  onOpen: () => void;
}) {
  const last = item.history.at(-1);
  const prev = item.history.at(-2);
  const trend =
    !last || !prev ? "flat" : last.units > prev.units * 1.03 ? "up" : last.units < prev.units * 0.97 ? "down" : "flat";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="nv-gc flex w-full items-center gap-2.5 rounded-[var(--radius-row)] px-3 py-2.5 text-left"
      >
        <TrendGlyph dir={trend} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{item.name}</span>
          <span className="tnum block text-2xs text-[var(--text-tertiary)]">
            {fmtMoney(item.price)}
            {last && ` · ${last.units.toLocaleString()} ${spec.demandUnit}`}
            {item.state === "declining" && " · past peak"}
          </span>
        </span>
        <Sparkline units={item.history.map((h) => h.units)} />
        {last && (
          <span className="tnum w-9 shrink-0 text-right text-2xs font-bold text-[var(--text-secondary)]">
            {last.grossMargin}%
          </span>
        )}
      </button>
    </li>
  );
}

/**
 * Year-by-year units, drawn in SVG. No chart library for five to ten numbers —
 * a polyline and a viewBox is the whole requirement.
 */
function Sparkline({ units }: { units: number[] }) {
  const pts = useMemo(() => {
    if (units.length < 2) return null;
    const max = Math.max(...units, 1);
    const w = 34;
    const h = 14;
    return units
      .map((u, i) => `${(i / (units.length - 1)) * w},${h - (u / max) * h}`)
      .join(" ");
  }, [units]);
  if (!pts) return <span className="w-[34px] shrink-0" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 34 14" className="w-[34px] shrink-0 text-[var(--text-tertiary)]" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function TrendGlyph({ dir }: { dir: "up" | "down" | "flat" }) {
  const d = dir === "up" ? "M2 8.5 6 4l4 4.5" : dir === "down" ? "M2 4.5 6 9l4-4.5" : "M2 6.5h8";
  return (
    <svg viewBox="0 0 12 13" className="h-3 w-3 shrink-0 text-[var(--text-secondary)]" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Item detail ─────────────────────────────────────────────────────────────

const VERDICT_COPY: Record<Verdict, string> = {
  hit: "Carrying the company.",
  solid: "Quietly doing its job.",
  quiet: "Costing a slot for very little.",
  flop: "Did not work.",
};

function ItemDetail({
  item,
  spec,
  onBack,
}: {
  item: LineItem;
  spec: IndustrySpec;
  onBack: () => void;
}) {
  const { retireLineItem } = useGame();
  const [confirming, setConfirming] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]"
      >
        ‹ {spec.reportLabel}
      </button>
      <h3 className="mt-2 text-lg font-extrabold tracking-[-0.01em]">{item.name}</h3>
      <p className="tnum mt-0.5 text-2xs text-[var(--text-tertiary)]">
        {fmtMoney(item.price)} · {item.tier} · launched FY{item.launchedYear}
        {item.refreshCount > 0 && ` · reworked ${item.refreshCount}×`}
      </p>
      {item.verdict && (
        <p className="mt-2 text-sm font-semibold">{VERDICT_COPY[item.verdict]}</p>
      )}

      {item.history.length === 0 ? (
        <p className="mt-4 text-sm leading-snug text-[var(--text-secondary)]">
          No numbers yet. It starts earning when the year closes.
        </p>
      ) : (
        <table className="mt-4 w-full text-2xs">
          <thead>
            <tr className="text-[var(--text-tertiary)]">
              <th className="py-1 text-left font-bold">FY</th>
              <th className="py-1 text-right font-bold">{spec.demandUnit.toUpperCase()}</th>
              <th className="py-1 text-right font-bold">REVENUE</th>
              <th className="py-1 text-right font-bold">GM</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {item.history.map((h) => (
              <tr key={h.year} className="border-t border-[var(--hairline)]">
                <td className="py-1.5 text-left font-semibold">{h.year}</td>
                <td className="py-1.5 text-right">{h.units.toLocaleString()}</td>
                <td className="py-1.5 text-right">{fmtMoney(h.revenue)}</td>
                <td className="py-1.5 text-right">{h.grossMargin}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Quantitative AFTER the fact — the sentence the addendum asks for. */}
      {item.history.length > 0 && (
        <p className="mt-3 text-2xs leading-relaxed text-[var(--text-secondary)]">
          {(() => {
            const h = item.history.at(-1)!;
            const bits = [
              `At ${fmtMoney(item.price)} you sold ${h.units.toLocaleString()} ${spec.demandUnit} in FY${h.year}.`,
            ];
            if (h.leakPct >= 5)
              bits.push(`${h.leakPct}% of it went to ${spec.leakLabel.toLowerCase()}.`);
            if (h.cannibalized > 0 && item.meta.lastCulprit)
              bits.push(`${item.meta.lastCulprit} took ${h.cannibalized.toLocaleString()} of them.`);
            return bits.join(" ");
          })()}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="nv-gc mt-5 w-full rounded-[var(--radius-row)] px-4 py-3 text-sm font-extrabold"
        >
          DISCONTINUE IT
        </button>
      ) : (
        <div className="mt-5 rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-3">
          <p className="text-xs leading-snug text-[var(--text-secondary)]">
            {item.name} comes off the list for good. It keeps its history in the
            archive.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                retireLineItem(item.id);
                onBack();
              }}
              className="nv-gc flex-1 rounded-[var(--radius-row)] nv-t-alert px-3 py-2.5 text-xs font-extrabold text-white"
            >
              DISCONTINUE
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="nv-gc flex-1 rounded-[var(--radius-row)] px-3 py-2.5 text-xs font-extrabold"
            >
              KEEP IT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── The three-tap launch flow ───────────────────────────────────────────────

function LaunchFlow({ spec, onDone }: { spec: IndustrySpec; onDone: () => void }) {
  const { run, launchLineItem } = useGame();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(spec.baselinePrice);
  const [investTier, setInvestTier] = useState<0 | 1 | 2>(1);
  const [tags, setTags] = useState<string[]>([]);
  /**
   * The lens's own commitment — run size, monetization model, cadence, delivery.
   * Held as an index so the spec stays the single source of truth for the values.
   */
  const [choiceIdx, setChoiceIdx] = useState<number>(spec.launchChoice?.defaultIndex ?? 0);

  if (!run) return null;
  const invest = spec.investTiers[investTier];
  const costDollars = invest.costS * S_UNIT[run.stage];
  const affordable = run.stats.cash >= costDollars;

  // The one pre-launch signal, and only once market intuition has been earned.
  const hint = priceHint(
    {
      price,
      investTier,
      tags,
      // Only the fields perceivedValue reads; this is a probe, not a real item.
    } as LineItem,
    run,
    spec,
  );

  const toggleTag = (t: string) =>
    setTags((cur) =>
      cur.includes(t) ? cur.filter((x) => x !== t) : cur.length >= 2 ? cur : [...cur, t],
    );

  return (
    <div>
      <button
        type="button"
        onClick={onDone}
        className="text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]"
      >
        ‹ CANCEL
      </button>

      <AnimatePresence mode="wait">
        {/* ── Tap one · name it ─────────────────────────────────────────── */}
        {step === 0 && (
          <motion.div key="name" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h3 className="mt-2 text-lg font-extrabold tracking-[-0.01em]">
              Name your {spec.noun.toLowerCase()}.
            </h3>
            <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
              This is going to outlive several fiscal years. Choose something you
              will not mind seeing again.
            </p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 28))}
              placeholder={spec.namePlaceholder}
              maxLength={28}
              className="mt-4 w-full border-0 border-b-2 border-[var(--n-5)] bg-transparent pb-2 text-[1.375rem] font-extrabold tracking-[-0.02em] outline-none transition-colors focus:border-[var(--n-11)] placeholder:font-bold placeholder:text-[var(--n-6)]"
            />
            <button
              type="button"
              disabled={sanitizeName(name).length === 0}
              onClick={() => setStep(1)}
              className="nv-gc mt-5 w-full rounded-[var(--radius-row)] nv-t-action px-4 py-3.5 text-sm font-extrabold tracking-[0.04em] disabled:bg-[var(--n-4)] disabled:text-[var(--n-7)]"
            >
              NEXT
            </button>
          </motion.div>
        )}

        {/* ── Tap two · price and build it ──────────────────────────────── */}
        {step === 1 && (
          <motion.div key="price" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h3 className="mt-2 text-lg font-extrabold tracking-[-0.01em]">
              What does it cost?
            </h3>

            {/* A stepper, not a slider: a slider invites hunting for a sweet spot
                that is deliberately not visible. */}
            <div className="mt-4 flex items-center justify-between rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-3">
              <button
                type="button"
                aria-label="Lower the price"
                onClick={() => setPrice((p) => clampPrice(p - spec.priceStep, spec))}
                className="nv-gc flex h-9 w-9 items-center justify-center rounded-full text-lg font-extrabold"
              >
                −
              </button>
              <span className="tnum text-[1.75rem] font-extrabold">{fmtMoney(price)}</span>
              <button
                type="button"
                aria-label="Raise the price"
                onClick={() => setPrice((p) => clampPrice(p + spec.priceStep, spec))}
                className="nv-gc flex h-9 w-9 items-center justify-center rounded-full text-lg font-extrabold"
              >
                +
              </button>
            </div>

            <h4 className="mt-5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
              HOW WELL DO YOU MAKE IT
            </h4>
            <div className="mt-2 space-y-1.5">
              {spec.investTiers.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setInvestTier(i as 0 | 1 | 2)}
                  className={`nv-gc flex w-full items-center justify-between rounded-[var(--radius-row)] px-3 py-2.5 text-left ${
                    investTier === i
                      ? "nv-on font-bold ring-1 ring-[var(--text-primary)]"
                      : ""
                  }`}
                >
                  <span className="text-sm">{t.label}</span>
                  {/* Cash leaving now is a fact, so it is shown. What it buys is not. */}
                  <span className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
                    {fmtMoney(t.costS * S_UNIT[run.stage])}
                  </span>
                </button>
              ))}
            </div>

            {/*
              The one decision only this business has to make. Qualitative
              options and no forecast, because it is a commitment signed before
              the information arrives — which is the whole lesson.
            */}
            {spec.launchChoice && (
              <>
                <h4 className="mt-5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
                  {spec.launchChoice.label.toUpperCase()}
                </h4>
                <div className="mt-2 space-y-1.5">
                  {spec.launchChoice.options.map((o, i) => (
                    <button
                      key={String(o.value)}
                      type="button"
                      onClick={() => setChoiceIdx(i)}
                      className={`nv-gc w-full rounded-[var(--radius-row)] px-3 py-2.5 text-left text-sm ${
                        choiceIdx === i
                          ? "nv-on font-bold ring-1 ring-[var(--text-primary)]"
                          : ""
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {spec.tags.length > 0 && (
              <>
                <h4 className="mt-5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
                  PICK UP TO TWO
                </h4>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {spec.tags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleTag(t)}
                      className={`nv-gc rounded-full px-2.5 py-1 text-2xs font-bold ${
                        tags.includes(t)
                          ?"bg-[var(--n-11)] text-[var(--n-0)]"
                          : "text-[var(--n-9)]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={() => setStep(2)}
              className="nv-gc mt-5 w-full rounded-[var(--radius-row)] nv-t-action px-4 py-3.5 text-sm font-extrabold tracking-[0.04em]"
            >
              NEXT
            </button>
          </motion.div>
        )}

        {/* ── Tap three · confirm ───────────────────────────────────────── */}
        {step === 2 && (
          <motion.div key="ok" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h3 className="mt-2 text-lg font-extrabold tracking-[-0.01em]">
              {sanitizeName(name)}
            </h3>
            <p className="tnum mt-1 text-sm text-[var(--text-secondary)]">
              {fmtMoney(price)} · {invest.label.toLowerCase()}
              {spec.launchChoice &&
                ` · ${spec.launchChoice.options[choiceIdx].label.toLowerCase()}`}
              {tags.length > 0 && ` · ${tags.join(", ")}`}
            </p>

            {hint && (
              <p className="mt-4 rounded-[var(--radius-row)] bg-[var(--n-3)] px-3 py-2.5 text-sm leading-snug">
                {hint}
              </p>
            )}
            {!hint && (
              <p className="mt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
                You do not have a feel for this market yet. Price it and find out.
              </p>
            )}

            <p className="tnum mt-4 text-2xs text-[var(--text-tertiary)]">
              {fmtMoney(costDollars)} leaves the account now.
            </p>

            <button
              type="button"
              disabled={!affordable}
              onClick={() => {
                launchLineItem({
                  name: sanitizeName(name),
                  price,
                  investTier,
                  tags,
                  // This line is the whole fix. Without it every lens read a
                  // meta key nothing wrote, and seven signature mechanics were
                  // unreachable branches.
                  meta: spec.launchChoice
                    ? { [spec.launchChoice.metaKey]: spec.launchChoice.options[choiceIdx].value }
                    : undefined,
                });
                onDone();
              }}
              className="nv-gc mt-4 w-full rounded-[var(--radius-row)] nv-t-action px-4 py-3.5 text-sm font-extrabold tracking-[0.04em] disabled:bg-[var(--n-4)] disabled:text-[var(--n-7)]"
            >
              {affordable ? "PUT IT OUT" : "NOT ENOUGH CASH"}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="nv-gc mt-2 w-full rounded-[var(--radius-row)] px-4 py-2.5 text-xs font-bold"
            >
              CHANGE THE PRICE
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
