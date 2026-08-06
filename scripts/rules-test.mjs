#!/usr/bin/env node
/**
 * Two rules that are neither engine nor leaderboard.
 *
 *   npm run test:rules
 *
 * `scripts/simulate.mjs` covers balance and `scripts/leaderboard-test.mjs`
 * covers tapes; `scripts/islands-test.mjs` covers the persistence layer. These
 * two fall outside all three and are the kind that fail quietly:
 *
 *   1. WHAT THE RUN IS MISSING — the nudge that points a player at PRODUCT and
 *      TEAM, the two tabs they report never finding. Its one hard rule is that
 *      it must never fire for a company that is not missing anything, because a
 *      nudge that is wrong teaches players to stop reading nudges.
 *
 *   2. THE AGE GATE — nobody under 13 signs up. This is the rule with a legal
 *      consequence attached, and it is spread across an onboarding step, an
 *      account form and a stored refusal, so what is tested here is that they
 *      all read the same constant and that a "no" is remembered.
 *
 * localStorage is shimmed for the second one, which persists its answer.
 */

import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(String(k)),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, hidden: false };

register("./ts-loader.mjs", import.meta.url);

const { createRun } = await import(join(root, "lib/engine/run.ts"));
const { nextStep } = await import(join(root, "lib/engine/nudges.ts"));
const { portfolioCap } = await import(join(root, "lib/engine/portfolio.ts"));
const { MIN_AGE, isOldEnough, isPlausibleAge, isAgeBlocked, recordTooYoung, clearAgeBlock } =
  await import(join(root, "lib/auth/age.ts"));

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

// ── 1 · the one thing worth doing ───────────────────────────────────────────
console.log("\n=== 1 · what the run is still missing ===");

const company = (over = {}) => {
  const run = createRun({
    founderName: "Ana",
    playerAge: 15,
    companyName: "Loop",
    industry: "FOOD",
    rookieMode: true,
    tutorial: false,
  });
  return { ...run, ...over, stats: { ...run.stats, ...(over.stats ?? {}) } };
};
const item = (n) => ({ id: `i${n}`, name: `Item ${n}`, state: "live", history: [] });

const empty = company({ stats: { employees: 0 }, portfolio: { items: [], nextId: 1 } });
ok(nextStep(empty)?.id === "no-product", "an empty shelf is the first thing said", nextStep(empty)?.id);
ok(nextStep(empty)?.tab === "product", "and it points at PRODUCT");

const selling = company({ stats: { employees: 0 }, portfolio: { items: [item(1)], nextId: 2 } });
ok(nextStep(selling)?.id === "no-team", "something to sell and nobody to sell it comes second", nextStep(selling)?.id);
ok(nextStep(selling)?.tab === "team", "and it points at TEAM");

const dead = company({ alive: false, stats: { employees: 0 }, portfolio: { items: [], nextId: 1 } });
ok(nextStep(dead) === null, "a company that has ended is not nagged about hiring");

/*
 * The rule that matters most: silence when nothing is missing. `portfolioCap`
 * is read rather than hardcoded, so this stays true if the cap is retuned.
 */
const staffed = company({ stats: { employees: 3 } });
const cap = portfolioCap(staffed);
const full = company({
  stats: { employees: 3 },
  portfolio: { items: Array.from({ length: cap }, (_, i) => item(i)), nextId: cap + 1 },
});
ok(nextStep(full)?.id === "team-caps-products", "a full shelf is a hiring decision, not a wall", nextStep(full)?.id);

const oneShort = company({
  stats: { employees: 3 },
  portfolio: { items: Array.from({ length: cap - 1 }, (_, i) => item(i)), nextId: cap },
});
ok(nextStep(oneShort) === null, "one slot free is left alone — not every gap is a problem", nextStep(oneShort)?.id ?? "null");

// ── 2 · nobody under 13 ─────────────────────────────────────────────────────
// Novus is a product for minors, and under 13 an online service may not collect
// a child's personal information without verifiable parental consent — which
// this app has no way to obtain. This is an age SCREEN, not verification (see
// lib/auth/age.ts, which is candid about the difference).
console.log("\n=== 2 · nobody under 13 ===");

ok(MIN_AGE === 13, "the line is 13", String(MIN_AGE));
ok(isOldEnough(13) === true, "13 is old enough");
ok(isOldEnough(12) === false, "12 is not");
ok(isOldEnough(0) === false, "and neither is 0");
ok(isOldEnough(null) === false, "an unanswered age is not old enough");
ok(isOldEnough(undefined) === false, "nor an absent one");
ok(isOldEnough("") === false, "nor a blank string");
ok(isOldEnough("abc") === false, "nor a word");
ok(isOldEnough("14") === true, "a typed number still works");
// The field takes two characters, so this is about what that field can mean.
ok(isPlausibleAge(0) === false, "0 is not a plausible age to have typed");
ok(isPlausibleAge(100) === false, "nor is 100 in a two-character field");
ok(isPlausibleAge(14) === true, "14 is");

clearAgeBlock();
ok(isAgeBlocked() === false, "a fresh device is not blocked");
recordTooYoung();
ok(isAgeBlocked() === true, "a device that answered under 13 is remembered");
// The whole point: reloading, going back, or re-running onboarding must not
// clear it.
ok(isAgeBlocked() === true, "and stays blocked on a second read");
// The age itself is never kept — it is a data point about a child the app has
// just decided not to serve.
ok(
  ![...store.keys()].some((k) => k.includes("agegate") && /1[0-2]/.test(store.get(k))),
  "and the age itself is not stored",
  [...store.entries()].filter(([k]) => k.includes("agegate")).join(","),
);
clearAgeBlock();
ok(isAgeBlocked() === false, "the operator escape hatch clears it");

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n  ${failures.join("\n  ")}\n` : "\n"),
);
process.exit(failures.length === 0 ? 0 : 1);
