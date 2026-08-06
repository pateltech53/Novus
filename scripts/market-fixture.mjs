#!/usr/bin/env node
/**
 * Writes the fixture that keeps `ios/App/Shared/MarketMath.swift` honest.
 *
 * The RobinGhood Live Activity prices positions itself, in the widget process,
 * because the tape is a pure function of (symbol, minute) and that is the only
 * reason a lock screen can show a live number without the app running. The
 * cost of that is a second implementation of the price maths in Swift, and the
 * risk of a second implementation is that it stops agreeing with the first.
 *
 * So this runs the REAL `priceAt` from lib/engine/market.ts over a fixed
 * spread of symbols and minutes and writes the answers into a Swift literal.
 * `MarketMath.verifyAgainstFixture()` replays them on every debug launch. A
 * port that drifts fails there instead of on a stranger's phone.
 *
 * Deterministic by construction: the minutes below are absolute and the
 * tickers come from the engine's own table, so re-running this on an untouched
 * tree rewrites the file byte for byte. A diff means the maths moved.
 *
 *   npm run market:fixture
 *
 * Usage: node scripts/market-fixture.mjs [--check]
 *   --check  writes nothing; exits non-zero if the committed file is stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "ios", "App", "Shared", "MarketFixture.swift");
const check = process.argv.includes("--check");

register("./ts-loader.mjs", import.meta.url);
const { TICKERS, priceAt } = await import(join(root, "lib/engine/market.ts"));
const { fmtMoney, fmtDelta, fmtPct } = await import(join(root, "lib/engine/format.ts"));

/**
 * The minutes to price at, chosen to exercise every layer of the model rather
 * than to be many.
 *
 * Absolute rather than relative to today, so the fixture does not churn: a
 * file regenerated tomorrow must be identical to the one committed today, or
 * the check below is noise and gets deleted.
 */
const MINUTE = 60_000;
const at = (iso) => Math.floor(Date.parse(iso) / MINUTE);

const MINUTES = [
  // The origin, where dayIndex is 0 and the trend term is exactly 1.
  0,
  // Four points across one ordinary day — the session wave is the only thing
  // moving between them, which is what makes a broken sin() term visible.
  at("2026-01-15T00:00:00Z"),
  at("2026-01-15T06:31:00Z"),
  at("2026-01-15T13:07:00Z"),
  at("2026-01-15T23:59:00Z"),
  // Consecutive days: the seeded daily gap changes and nothing else does.
  at("2026-01-16T09:00:00Z"),
  at("2026-01-17T09:00:00Z"),
  // A year out and a decade out, where the compounded trend term is doing the
  // most work and `pow` has the most room to disagree.
  at("2027-06-30T15:45:00Z"),
  at("2035-11-02T04:12:00Z"),
  // Past the 3650-day modulus, where dayIndex wraps and the trend resets.
  at("2038-03-01T12:00:00Z"),
];

const samples = [];
for (const ticker of TICKERS) {
  for (const minute of MINUTES) {
    samples.push({
      symbol: ticker.symbol,
      base: ticker.base,
      drift: ticker.drift,
      vol: ticker.vol,
      minute,
      price: priceAt(ticker, minute),
    });
  }
}

/**
 * A Swift literal that is the SAME double, not a rounded one.
 *
 * `Number.prototype.toString` emits the shortest decimal that round-trips a
 * binary64 exactly, and Swift parses a floating literal to the nearest double
 * — so the two land on the identical bit pattern. Writing six decimal places
 * instead would compare a Swift double against a rounded one and pass a port
 * that had genuinely drifted; writing `toPrecision(17)` would be equally exact
 * and would fill the file with `148.19999999999999` where the table says 148.2.
 */
const lit = (n) => {
  const s = String(Number(n));
  return /[.e]/.test(s) ? s : `${s}.0`;
};

const rows = samples
  .map(
    (s) =>
      `        Sample(symbol: "${s.symbol}", base: ${lit(s.base)}, drift: ${lit(s.drift)}, ` +
      `vol: ${lit(s.vol)}, minute: ${s.minute}, price: ${lit(s.price)}),`,
  )
  .join("\n");

/**
 * The display rules, checked the same way the maths is.
 *
 * `ios/App/Shared/NvFormat.swift` is a port of `fmtMoney`, `fmtDelta` and
 * `fmtPct`, and it exists for one reason: a price the extension computed for a
 * minute the app never saw has no app-authored string attached to it. A port
 * of a display rule is exactly the kind of thing that drifts silently, so the
 * values below are chosen to sit ON the boundaries rather than near them —
 * every threshold in format.ts, both signs, and the ties where JavaScript's
 * `toFixed` and C's `printf` genuinely disagree about which way to round.
 */
const MONEY = [
  0, 1, 999, 1000, 9999, 9999.5, 10_000, 12_400, 99_999, 100_000, 999_999,
  1_000_000, 1_240_000, 3_100_000, 999_999_999, 1_000_000_000, 1_200_000_000,
  // The rounding ties. 3.25 and 12.25 are exactly representable, and they are
  // where `%.1f` rounds to even and `toFixed(1)` rounds away from zero.
  3_250_000, 12_250_000, 1_050, 10_500, 105_000,
  // Negatives, which is where the U+2212 minus lives. A profitable company
  // reports a negative burn, so this is a real state and not an edge case.
  -1, -9_999, -12_400, -3_100_000, -1_200_000_000,
];

const PERCENTS = [0, 0.04, 0.05, 1, 1.25, 2.4, 17, 17.05, 99.95, -0.04, -2.4, -17.5, -100];

const formats = [
  ...MONEY.map((n) => ({ rule: "money", input: n, output: fmtMoney(n) })),
  ...MONEY.map((n) => ({ rule: "delta", input: n, output: fmtDelta(n) })),
  ...PERCENTS.map((n) => ({ rule: "percent", input: n, output: fmtPct(n, true) })),
];

const formatRows = formats
  .map((f) => `        Format(rule: "${f.rule}", input: ${lit(f.input)}, output: "${f.output}"),`)
  .join("\n");

const file = `// GENERATED by scripts/market-fixture.mjs — do not edit by hand.
//
// The engine's own answers, so the two Swift ports that had to exist can be
// checked against them:
//
//   · MarketMath.swift — the tape, because RobinGhood is priced from the real
//     clock and the extension must price minutes the app never saw.
//   · NvFormat.swift   — the display rules, because a price computed here
//     arrives with no app-authored string attached to it.
//
// Regenerate with \`npm run market:fixture\` whenever lib/engine/market.ts or
// lib/engine/format.ts changes. A diff here that nobody asked for is the
// fixture reporting that the maths — or the way money is written — moved.
//
// ${samples.length} price samples · ${TICKERS.length} tickers × ${MINUTES.length} minutes
// ${formats.length} format samples

enum MarketFixture {
    struct Sample {
        let symbol: String
        let base: Double
        let drift: Double
        let vol: Double
        let minute: Int
        let price: Double
    }

    struct Format {
        /// "money" | "delta" | "percent" — the function in lib/engine/format.ts.
        let rule: String
        let input: Double
        let output: String
    }

    static let samples: [Sample] = [
${rows}
    ]

    static let formats: [Format] = [
${formatRows}
    ]
}
`;

const previous = (() => {
  try {
    return readFileSync(OUT, "utf8");
  } catch {
    return null;
  }
})();

if (check) {
  if (previous === file) {
    console.log(`✓ MarketFixture.swift is current — ${samples.length} samples`);
    process.exit(0);
  }
  console.error(
    "✗ ios/App/Shared/MarketFixture.swift is stale.\n" +
      "  lib/engine/market.ts prices differently than the committed fixture says.\n" +
      "  Run `npm run market:fixture`, then read the diff before committing it:\n" +
      "  a change here means every position on every lock screen is repriced.",
  );
  process.exit(1);
}

writeFileSync(OUT, file);
console.log(
  `${previous === file ? "·" : "✓"} ios/App/Shared/MarketFixture.swift — ` +
    `${samples.length} samples (${TICKERS.length} tickers × ${MINUTES.length} minutes)` +
    `${previous === file ? " · unchanged" : ""}`,
);
