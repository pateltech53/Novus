#!/usr/bin/env node
/**
 * The price a player is allowed to set, and what it costs them.
 *
 *   npm run test:pricing
 *
 * `scripts/simulate.mjs` never launches a product — its player policy plays
 * the year, not the portfolio — so nothing in the balance harness touches the
 * one number this screen exists to ask for. That gap is why this file exists:
 * the launch sheet stopped being two buttons walking a hardcoded band, and the
 * three rules that replaced it are exactly the kind that fail silently.
 *
 *   1. THE RANGE — every lens accepts four figures or more, a typed price is
 *      kept as typed rather than snapped onto the stepper's grid, and nothing
 *      illegal survives `clampPrice`.
 *   2. THE STEPPER — a tap is worth a sensible fraction of the price at every
 *      magnitude, it walks round numbers, and it strands nobody: every price
 *      between the floor and the ceiling is reachable in both directions.
 *   3. THE PUNISHMENT — this is the load-bearing one. The ceiling is only safe
 *      to raise because overpricing is self-defeating: past the greedy band,
 *      revenue has to FALL as the price climbs. If it ever stops falling,
 *      "type the maximum" becomes the dominant strategy and the pricing lesson
 *      is dead.
 */

import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register("./ts-loader.mjs", import.meta.url);

const { INDUSTRIES } = await import(join(root, "lib/engine/constants.ts"));
const { specFor } = await import(join(root, "lib/engine/industries/index.ts"));
const {
  clampPrice,
  priceCeiling,
  priceStepFor,
  nudgePrice,
  bandUnitsMult,
  GREEDY_RATIO,
} = await import(join(root, "lib/engine/portfolio.ts"));
const { fmtPrice } = await import(join(root, "lib/engine/format.ts"));

let passed = 0;
const failures = [];

function ok(condition, label, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const specs = INDUSTRIES.map((i) => specFor(i.code));

// ── 1 · what a lens will accept ─────────────────────────────────────────────
console.log("\n=== 1 · the range ===");

for (const spec of specs) {
  const ceiling = priceCeiling(spec);
  ok(
    ceiling >= 1000,
    `${spec.code} reaches four figures (${fmtPrice(ceiling)})`,
    `ceiling ${ceiling}`,
  );
  ok(
    ceiling > spec.priceMax,
    `${spec.code} can be priced past its band's top (${fmtPrice(spec.priceMax)})`,
  );
  ok(
    clampPrice(ceiling * 10, spec) === ceiling && clampPrice(-50, spec) === spec.priceMin,
    `${spec.code} refuses everything outside it`,
    `${clampPrice(ceiling * 10, spec)} / ${clampPrice(-50, spec)}`,
  );
}

// The old clampPrice snapped to priceStep, which is right for a button and
// wrong for a typed number. EDTECH steps in $25s and is the loudest case.
const edtech = specFor("EDTECH");
ok(
  clampPrice(1234, edtech) === 1234,
  "a typed price is not snapped onto the stepper's grid",
  `got ${clampPrice(1234, edtech)}`,
);
const food = specFor("FOOD");
ok(clampPrice(13.499, food) === 13.5, "and is rounded to whole cents", `${clampPrice(13.499, food)}`);
ok(clampPrice(Number.NaN, food) === food.baselinePrice, "nonsense falls back to the anchor");
// The bug that started this: fmtMoney rounds cents away, so a $0.50 step drew
// two different prices as the same number.
ok(fmtPrice(13.5) === "$13.50" && fmtPrice(14) === "$14", "half-dollar prices are visible");
ok(fmtPrice(12000) === "$12,000", "and four figures are not compressed to $12K");

// ── 2 · the stepper ─────────────────────────────────────────────────────────
console.log("\n=== 2 · the stepper ===");

const tech = specFor("TECH");
ok(priceStepFor(39, tech) === 1, "a dollar step at $39");
ok(priceStepFor(390, tech) === 10, "ten at $390");
ok(priceStepFor(3900, tech) === 100, "a hundred at $3,900");
ok(
  priceStepFor(50, edtech) === 25,
  "never finer than the lens's own step",
  `${priceStepFor(50, edtech)}`,
);
ok(nudgePrice(137, 1, tech) === 140, "up from an odd number lands on a round one");
ok(nudgePrice(137, -1, tech) === 130, "and down does too");
ok(nudgePrice(140, 1, tech) === 150 && nudgePrice(140, -1, tech) === 130, "on-grid still moves");

/*
 * The buttons are for the last few dollars, not for crossing the range — the
 * field crosses the range now. So what is checked is that they never strand a
 * player (every price is reachable in both directions, floor to ceiling) and
 * that one tap is always worth a sane fraction of the number it is moving: too
 * small and the thumb gives up, too large and the fine control is gone.
 */
for (const spec of specs) {
  const ceiling = priceCeiling(spec);
  let price = spec.priceMin;
  let taps = 0;
  let coarsest = 0;
  while (price < ceiling && taps < 2000) {
    const next = nudgePrice(price, 1, spec);
    if (next <= price) break;
    if (price >= spec.baselinePrice) coarsest = Math.max(coarsest, (next - price) / price);
    price = next;
    taps += 1;
  }
  ok(price === ceiling, `${spec.code} taps up to its ceiling (${taps} taps)`, `stalled at ${price}`);
  ok(
    coarsest <= 0.2,
    `${spec.code}'s tap never moves the price more than a fifth`,
    `worst ${(coarsest * 100).toFixed(0)}%`,
  );

  // Downward is where an off-by-one strands a player at the top of the range.
  let down = 0;
  while (price > spec.priceMin && down < 2000) {
    const next = nudgePrice(price, -1, spec);
    if (next >= price) break;
    price = next;
    down += 1;
  }
  ok(price === spec.priceMin, `${spec.code} taps back down to ${fmtPrice(spec.priceMin)}`, `stuck at ${price}`);
}

// ── 3 · greed has to cost more than it earns ────────────────────────────────
console.log("\n=== 3 · the punishment ===");

/*
 * Revenue per unit of demand at a given price ratio, read off the engine's own
 * multiplier rather than a copy of it: revenue is units × price, and everything
 * else in the yearly tick (base units, stage, lifecycle, season, luck) is
 * price-independent and cancels. So ratio × `bandUnitsMult` IS the pricing
 * curve, in the only shape that matters — what an extra dollar buys you.
 */
const revenueAt = (ratio) => ratio * bandUnitsMult(ratio);

let monotonic = true;
let worst = "";
for (let r = GREEDY_RATIO; r < 100; r += 0.05) {
  const here = revenueAt(r);
  const further = revenueAt(r + 0.05);
  if (further > here + 1e-9) {
    monotonic = false;
    worst = `${r.toFixed(2)}× → ${(r + 0.05).toFixed(2)}×: ${here.toFixed(3)} → ${further.toFixed(3)}`;
    break;
  }
}
ok(monotonic, "past the greedy band, every extra dollar of price loses revenue", worst);

const peak = (() => {
  let best = { ratio: 0, rev: 0 };
  for (let r = 0.1; r < 100; r += 0.01) {
    const rev = revenueAt(r);
    if (rev > best.rev) best = { ratio: r, rev };
  }
  return best;
})();
ok(
  peak.ratio <= GREEDY_RATIO + 0.01,
  `the best price is inside the bands, not at the ceiling (peaks at ${peak.ratio.toFixed(2)}×)`,
);
ok(
  revenueAt(40) < revenueAt(1) * 0.05,
  "pricing at forty times what it is worth sells next to nothing",
  `${revenueAt(40).toFixed(4)} vs ${revenueAt(1).toFixed(4)}`,
);
// The tail is additive, not a rebalance: the first greedy dollar costs exactly
// what it cost before this file existed, and everything cheaper is untouched.
ok(
  Math.abs(bandUnitsMult(GREEDY_RATIO + 0.0001) - 0.24) < 1e-3,
  "the band's own edge still sells the quarter it always did",
  `${bandUnitsMult(GREEDY_RATIO + 0.0001).toFixed(4)}`,
);
ok(
  bandUnitsMult(0.5) === 1.45 && bandUnitsMult(1) === 1 && bandUnitsMult(1.5) === 0.62,
  "and no reachable price below it moved",
);

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n  ${failures.join("\n  ")}\n` : "\n"),
);
process.exit(failures.length === 0 ? 0 : 1);
