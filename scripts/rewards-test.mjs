#!/usr/bin/env node
/**
 * The reward system's acceptance criteria, as a runnable check.
 *
 *   npm run test:rewards
 *
 * Four of the build prompt's §11 criteria are statistical or structural and
 * would otherwise be verified by eye exactly once: the tier odds, the floor
 * rule, the determinism of the daily generator, and the anti-repeat window.
 * A drifting probability table is invisible in review and obvious here.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
register("./ts-loader.mjs", pathToFileURL("./scripts/"));

const { TIER_ODDS, rewardDate, nextResetAt } = await import("../lib/rewards/tables.ts");
const { rollTier, rngFor } = await import("../lib/rewards/roll.ts");
const { generateDaily } = await import("../lib/rewards/daily.ts");

let failed = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failed++;
};

// ── tier odds, per band ─────────────────────────────────────────────────────
console.log("\nTier roll — 10,000 claims per band, within ±15% of published odds");
for (const band of ["easy", "medium", "hard"]) {
  const N = 10_000;
  const seen = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let floorViolation = null;
  const floor = Math.min(...Object.entries(TIER_ODDS[band]).filter(([, w]) => w > 0).map(([t]) => +t));
  for (let i = 0; i < N; i++) {
    const { tier, path } = rollTier(band, `sim-${band}-${i}`);
    seen[tier]++;
    if (tier < floor) floorViolation ??= `tier ${tier} below floor ${floor}`;
    if (path[path.length - 1] !== tier) floorViolation ??= `path ends at ${path.at(-1)}, tier is ${tier}`;
    if (path.some((p) => p < floor)) floorViolation ??= `path dips below floor: ${path}`;
  }
  for (const [tier, pct] of Object.entries(TIER_ODDS[band])) {
    if (pct === 0) {
      check(seen[tier] === 0, `${band} T${tier} never paid (floor rule)`, `${seen[tier]}`);
      continue;
    }
    const actual = (seen[tier] / N) * 100;
    // Rare cells need an absolute floor: ±15% of 0.1% is noise at N=10,000.
    const tolerance = Math.max(pct * 0.15, 0.25);
    check(Math.abs(actual - pct) <= tolerance,
      `${band} T${tier} ≈ ${pct}%`, `got ${actual.toFixed(2)}%`);
  }
  check(!floorViolation, `${band} upgrade path stays legal`, floorViolation ?? "");
}

// ── determinism + anti-repeat ───────────────────────────────────────────────
console.log("\nDaily generator — determinism and the 2-day anti-repeat window");
const days = [];
for (let i = 0; i < 60; i++) {
  const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
  days.push({ date, config: generateDaily(date) });
}
check(days.every((d) => JSON.stringify(d.config) === JSON.stringify(generateDaily(d.date))),
  "same date → identical config on recompute");
check(days.every((d) => d.config.slots.length === 5), "every day has 5 slots");
check(days.every((d) => new Set(d.config.slots.map((s) => s.id)).size === 5),
  "no day repeats a template within itself");

let repeat = null;
for (let i = 2; i < days.length; i++) {
  const today = days[i].config.slots.map((s) => s.id);
  const window = [...days[i - 1].config.slots, ...days[i - 2].config.slots].map((s) => s.id);
  const clash = today.find((id) => window.includes(id));
  if (clash) { repeat ??= `${days[i].date} reuses ${clash}`; }
}
check(!repeat, "no template repeats within 2 days across 60 days", repeat ?? "");

const bands = days.flatMap((d) => d.config.slots.map((s) => s.band));
check(bands.filter((b) => b === "easy").length === days.length * 2, "2 easy slots a day");
check(bands.filter((b) => b === "medium").length === days.length * 2, "2 medium slots a day");
check(bands.filter((b) => b === "hard").length === days.length * 1, "1 hard slot a day");

// ── the reward day seam ─────────────────────────────────────────────────────
console.log("\nReset clock — the day boundary is 09:00 UTC, not midnight");
check(rewardDate(new Date("2026-03-05T08:59:59Z")) === "2026-03-04", "08:59 UTC still scores yesterday");
check(rewardDate(new Date("2026-03-05T09:00:01Z")) === "2026-03-05", "09:00 UTC starts today");
check(nextResetAt(new Date("2026-03-05T10:00:00Z")).toISOString() === "2026-03-06T09:00:00.000Z",
  "after reset, next is tomorrow");
check(nextResetAt(new Date("2026-03-05T08:00:00Z")).toISOString() === "2026-03-05T09:00:00.000Z",
  "before reset, next is today");

console.log(failed ? `\n✗ ${failed} failed\n` : "\n✓ all reward checks passed\n");
process.exit(failed ? 1 : 0);
