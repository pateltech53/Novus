#!/usr/bin/env node
/**
 * Headless balance harness. Plays N full runs against the real engine and
 * reports survival, economy shape, and event coverage. Catches the class of
 * bug you can't see by clicking one year in a browser.
 *
 * Usage: node scripts/simulate.mjs [runs] [years] [seed]
 *
 * DETERMINISTIC BY DEFAULT. Same (runs, years, seed) → identical numbers, so a
 * balance shift between two invocations is a real regression rather than noise.
 * Pass `random` as the seed to sample variance; the chosen seed is printed so
 * any interesting result can be replayed exactly.
 *
 * THREE independent sources of nondeterminism had to be pinned to get here.
 * Missing any one of them silently reintroduces noise:
 *
 *   1. This harness's own player policy — which choice it picks, the camera
 *      score it awards itself, the year-end allocation. Previously bare
 *      Math.random().
 *   2. The ENGINE's run seed. createRun() derives it from Date.now()
 *      (lib/engine/run.ts), so event draws and luck bands differed on every
 *      invocation no matter what this file did. The harness overrides
 *      run.seed immediately after construction — a change contained here
 *      rather than a new parameter on the protected createRun().
 *   3. THE WALL CLOCK. Today's Market is seeded by the real UTC date
 *      (rng.ts todaysMarketSeed) and run.lastPlayedISO uses today's date, so
 *      the whole balance table shifted at midnight UTC. This was caught the
 *      hard way: an untouched tree returned 53% survival one day and 50% the
 *      next. A gate that drifts by calendar is worse than no gate, because it
 *      reports a regression nobody caused.
 *
 * (3) is fixed by freezing the clock below, BEFORE the engine is imported.
 * Override with NOVUS_SIM_DATE=YYYY-MM-DD to replay a specific day's market.
 *
 * lib/engine/log.ts also uses Math.random() for cosmetic line ids; that cannot
 * affect a balance outcome and is left alone.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Freeze the clock ────────────────────────────────────────────────────────
// Must happen before the engine modules load. Only the no-argument forms are
// pinned: `new Date(x)` and date arithmetic keep working normally, so nothing
// that parses or formats a supplied date is affected.
const SIM_DATE = process.env.NOVUS_SIM_DATE ?? "2026-01-15";
const FROZEN_MS = new Date(`${SIM_DATE}T12:00:00.000Z`).getTime();
if (Number.isNaN(FROZEN_MS)) {
  console.error(`✗ NOVUS_SIM_DATE="${SIM_DATE}" is not a valid YYYY-MM-DD date`);
  process.exit(1);
}
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FROZEN_MS);
    else super(...args);
  }
  static now() {
    return FROZEN_MS;
  }
}
globalThis.Date = FrozenDate;

// Compile the TS engine on the fly via a tiny loader.
register("./ts-loader.mjs", import.meta.url);

const { createRun, advanceMonth, resolveChoice, resolveAuto, closeYear, visibleChoices, applyAllocation } =
  await import(join(root, "lib/engine/run.ts"));
const { buildAutopsy } = await import(join(root, "lib/engine/autopsy.ts"));
const { deriveRunwayMonths } = await import(join(root, "lib/engine/sim.ts"));
// The engine already ships a seeded PRNG — reuse it rather than inventing one.
const { mulberry32, hashString } = await import(join(root, "lib/engine/rng.ts"));

const EVENTS = JSON.parse(readFileSync(join(root, "data", "events.json"), "utf8"));

const RUNS = parseInt(process.argv[2] ?? "40", 10);
const YEARS = parseInt(process.argv[3] ?? "5", 10);

const SEED_ARG = process.argv[4] ?? "1";
const SEED = SEED_ARG === "random" ? (Math.random() * 0xffffffff) >>> 0 : parseInt(SEED_ARG, 10) >>> 0;

const INDUSTRIES = ["FOOD", "ECOM", "TECH", "CONTENT"];

let survived = 0;
let died = 0;
const deathYears = [];
const seenEvents = new Set();
const performCount = [];
const finalValuations = [];
const yearRevenues = [];
let errors = 0;

for (let r = 0; r < RUNS; r++) {
  try {
    const run = createRun({
      founderName: "Sim",
      playerAge: 16,
      companyName: `SimCo${r}`,
      industry: INDUSTRIES[r % INDUSTRIES.length],
      rookieMode: false,
      tutorial: false,
    });

    // Pin the engine's luck. createRun() seeds from Date.now(), so without
    // this every invocation draws different events and different luck bands.
    run.seed = hashString(`novus-sim:${SEED}:${r}`);

    // This harness's own player policy, seeded off the same root.
    const rng = mulberry32(hashString(`novus-sim-policy:${SEED}:${r}`));

    let performs = 0;
    for (let y = 0; y < YEARS && run.alive; y++) {
      // 11 taps to reach the gate
      while (run.month < 12 && run.alive) {
        const res = advanceMonth(run, EVENTS);
        if (res.died) break;
        for (const ev of res.surfaced) {
          seenEvents.add(ev.id);
          if (ev.auto) {
            resolveAuto(run, ev);
            continue;
          }
          if (ev.performOnly) {
            performs++;
            continue; // camera events resolve through the UI; skip in sim
          }
          const choices = visibleChoices(run, ev);
          if (choices.length === 0) continue;
          const idx = Math.floor(rng() * choices.length);
          const out = resolveChoice(run, ev, idx);
          if (out.perform) {
            // simulate a middling camera score
            resolveChoice(run, ev, idx, 6);
            performs++;
          }
        }
      }
      if (!run.alive) break;

      // The year closes only through a scored performance.
      const score = 4 + Math.floor(rng() * 5);
      performs++;
      // Mirrors SharkPanel: the ask buys a year of runway; a weak pitch gets
      // a fraction of it, and every deal costs ownership.
      const S = [0, 1e3, 1e4, 1e5, 1e6, 1e7][run.stage];
      const askS = Math.max(run.stats.valuation * 0.2, Math.max(0, run.stats.burnMonthly) * 12, 4 * S) / S;
      const takeS = score >= 8 ? askS : score >= 5 ? askS * 0.7 : askS * 0.35;
      const summary = closeYear(
        run,
        { type: "pitch", score, multiplier: 0.4 + 0.12 * score, year: run.year },
        takeS,
        score >= 8 ? 12 : 18,
      );
      yearRevenues.push(Math.round(summary.revenue));
      applyAllocation(run, ["marketing", "product", "save"][Math.floor(rng() * 3)]);
    }

    performCount.push(performs);
    if (run.alive) {
      survived++;
      finalValuations.push(Math.round(run.stats.valuation));
    } else {
      died++;
      deathYears.push(run.year);
      buildAutopsy(run); // must not throw
    }
  } catch (err) {
    errors++;
    if (errors <= 3) console.error(`run ${r} threw:`, err.message);
  }
}

const median = (a) => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const fmt = (n) =>
  n >= 1_000_000 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n}`;

console.log(`\n${RUNS} runs × up to ${YEARS} fiscal years · seed ${SEED} · clock ${SIM_DATE}\n`);
console.log(`  survived to year ${YEARS}: ${survived}/${RUNS}  (${Math.round((survived / RUNS) * 100)}%)`);
console.log(`  Chapter 7:               ${died}/${RUNS}`);
if (deathYears.length) console.log(`  median death year:       ${median(deathYears)}`);
console.log(`  median final valuation:  ${fmt(median(finalValuations))}`);
console.log(`  median year revenue:     ${fmt(median(yearRevenues))}`);
console.log(`  median performs/run:     ${median(performCount)}`);
console.log(`  distinct events seen:    ${seenEvents.size} / ${EVENTS.length}`);
console.log(`  runtime errors:          ${errors}`);

if (errors > 0) process.exit(1);
if (median(yearRevenues) === 0) {
  console.error("\n✗ revenue never leaves zero — the economy is dead");
  process.exit(1);
}
console.log("");
