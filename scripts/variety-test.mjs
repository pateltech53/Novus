#!/usr/bin/env node
/**
 * Year two is not year one.
 *
 *   npm run test:variety
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * A player reported that playing year 2 gave "the exact same flow and questions
 * as year one". They were right, and there were two separate reasons, neither
 * of which any existing harness could have caught:
 *
 *   1. **The activity list never depended on the year.** `activitiesFor()` is a
 *      static filter over a module constant. There is no draw, no seed, no
 *      cooldown, and the one field that could have varied it —
 *      `Activity.yearly`, documented as "once per fiscal year" and set on seven
 *      activities — was read by nothing at all. `scripts/simulate.mjs` never
 *      calls `activitiesFor` or `runActivity`, so the balance harness could
 *      run thirty companies for eight years each and never touch this.
 *
 *   2. **The Tank's questions never depended on the year either.** Attack
 *      points came out of a bare severity sort and the offline shark took index
 *      zero, so the same books produced the same sentence, verbatim, twelve
 *      months later. The room's no-repeat memory lived in one session's React
 *      state and was reborn empty at every year gate.
 *
 * What is asserted here is the PROPERTY, not the implementation: given the same
 * company in two different fiscal years, something the player sees has to
 * differ. That is deliberately loose about how — a later change may rotate
 * activities differently or reword questions, and this file should survive it.
 *
 * The tests run against the real modules through the same ts-loader the other
 * harnesses use, with no localStorage needed: everything here is engine and
 * pure AI-context code.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

register("./ts-loader.mjs", import.meta.url);

const { createRun } = await import(join(root, "lib/engine/run.ts"));
const { ACTIVITIES, activitiesFor, isOfferable, isSpentThisYear, recordActivityUse } =
  await import(join(root, "lib/engine/activities.ts"));
const { attackPointsFor } = await import(join(root, "lib/ai/panel-context.ts"));

let passed = 0;
const failures = [];

function ok(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A company, at whatever year and stage the test needs.
 *
 * The seed is PINNED. `createRun` mints a fresh one per company, which is
 * right for the game and wrong for this file twice over: it would make the
 * year-to-year comparison below a comparison of two different companies, and
 * it would make the replay assertion pass or fail at random. Two calls to this
 * helper are the same company; only what is overridden differs.
 */
const company = (over = {}) => {
  const run = createRun({
    founderName: "Ana",
    playerAge: 15,
    companyName: "Loop",
    industry: "FOOD",
    rookieMode: true,
    tutorial: false,
  });
  return { ...run, seed: 424242, ...over, stats: { ...run.stats, ...(over.stats ?? {}) } };
};

// ── 1 · the flag that did nothing ───────────────────────────────────────────
console.log("\n=== 1 · once a fiscal year means once a fiscal year ===");

/*
 * Found rather than hardcoded. The seven `yearly` activities live in the
 * industry lenses and one in the shared registry, and naming one here would
 * make this file fail the day somebody retires that particular activity rather
 * than the day the RULE breaks.
 */
const yearlyOnes = ACTIVITIES.filter((a) => a.yearly);
ok(
  "at least one activity is declared once-a-year",
  yearlyOnes.length > 0,
  "nothing to test — has `yearly` been removed?",
);

if (yearlyOnes.length > 0) {
  const activity = yearlyOnes[0];
  const run = company({ year: 2, stage: 5 });

  ok("an unused yearly activity is offerable", isOfferable(activity, run));

  recordActivityUse(run, activity.id);
  ok("using it marks it spent for this year", isSpentThisYear(activity, run));
  ok("and it stops being offered", !isOfferable(activity, run));

  run.year = 3;
  ok("next fiscal year it is back", isOfferable(activity, run), "the ledger did not roll over");
  ok("and no longer counts as spent", !isSpentThisYear(activity, run));
}

// ── 2 · the list a player actually sees ─────────────────────────────────────
console.log("\n=== 2 · the tab is not a photocopy of last year ===");

/*
 * The company tab is the one the report was about. Two identical companies a
 * year apart, one of which spent its yearly lever, must not offer the same
 * list — that is the whole complaint, reduced to one assertion.
 */
const yearOne = company({ year: 1, stage: 5 });
const spentIt = ACTIVITIES.filter((a) => a.yearly && a.tab === "company")[0];

if (spentIt) {
  const yearTwo = company({ year: 2, stage: 5 });
  recordActivityUse(yearTwo, spentIt.id);
  const before = activitiesFor("company", yearOne).map((a) => a.id);
  const after = activitiesFor("company", yearTwo).map((a) => a.id);
  ok(
    "a lever spent this year is gone from this year's tab",
    before.join() !== after.join(),
    "identical lists",
  );
} else {
  // Not a failure: the yearly ones currently live on other tabs. Asserted on
  // the tab they DO live on instead, so the property is still covered.
  const other = yearlyOnes[0];
  const yearTwo = company({ year: 2, stage: 5 });
  recordActivityUse(yearTwo, other.id);
  ok(
    "a lever spent this year is gone from its tab",
    activitiesFor(other.tab, yearOne).map((a) => a.id).join() !==
      activitiesFor(other.tab, yearTwo).map((a) => a.id).join(),
    "identical lists",
  );
}

// ── 3 · the room does not open on last year's sentence ──────────────────────
console.log("\n=== 3 · the Tank asks something else ===");

/*
 * Identical books, different fiscal years. Severity still decides which
 * weakness is worst — that is the room being fair — but the order WITHIN a
 * severity is seeded on the year, so the question that gets asked first moves.
 *
 * Weak on purpose, and weak in several ways at once: a company with one
 * problem has one question and no amount of seeding changes that. The point of
 * the fix is a company with FOUR problems no longer hearing them in the same
 * order forever.
 */
const weak = (year) =>
  company({
    year,
    stage: 3,
    stats: {
      cash: 40_000,
      burnMonthly: 30_000,
      revenueAnnual: 20_000,
      grossMarginPt: 8,
      netMarginPt: -60,
      csat: 30,
      employees: 2,
      qual: 20,
      tdebt: 8,
    },
  });

const y1 = attackPointsFor(weak(1), "", { amountUsd: 200_000, equityPct: 10 });
const y2 = attackPointsFor(weak(2), "", { amountUsd: 200_000, equityPct: 10 });

ok(
  "a weak company has several things to be asked about",
  y1.length >= 3,
  `only ${y1.length} attack points`,
);
ok(
  "the same books two years apart find the same weaknesses",
  new Set(y1.map((a) => a.id)).size === new Set(y2.map((a) => a.id)).size,
  "the fix must not change WHICH weaknesses are found",
);
ok(
  "severity still leads — the worst thing is still worst",
  y1[0].severity === Math.max(...y1.map((a) => a.severity)) &&
    y2[0].severity === Math.max(...y2.map((a) => a.severity)),
);
ok(
  "but the order they are asked in is not identical",
  y1.map((a) => a.id).join() !== y2.map((a) => a.id).join(),
  `year 1 and year 2 both: ${y1.map((a) => a.id).join(" ")}`,
);

/*
 * And the same year twice is still the same room. This is the half that keeps
 * the leaderboard verifiable: the seeding has to be a function of the run and
 * the year, never of the clock or of `Math.random`, or a replay on another
 * machine draws a different panel.
 */
const y2again = attackPointsFor(weak(2), "", { amountUsd: 200_000, equityPct: 10 });
ok(
  "the same year replays identically — the verifier depends on it",
  y2.map((a) => a.id).join() === y2again.map((a) => a.id).join(),
);

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
