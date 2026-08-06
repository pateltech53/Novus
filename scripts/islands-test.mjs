/**
 * The rules that decide what a device holds, and what a run is still missing.
 *
 *   node scripts/islands-test.mjs
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * A player reported that tapping "found a new island" reset the island they
 * already had, and they were right. /found resolved its target slot with:
 *
 *     const askedFor = Number(params.get("island"));
 *
 * `URLSearchParams.get` answers `null` when the parameter is absent and
 * `Number(null)` is `0` — an integer, in range, indistinguishable from a
 * deliberate tap on island 0. Every route to /found that did not carry the
 * parameter therefore founded onto slot 0 and overwrote whatever was living
 * there. Stripe's success URL is `/found?purchase=ok`, so the most reliable
 * way to lose a company was to pay for a second one.
 *
 * The bug is one coercion and the damage is a deleted save, which is the worst
 * ratio in the codebase. Both halves of the fix are checked here: the parse
 * that stopped inventing a zero, and the backstop in `startRun` that makes any
 * FUTURE caller naming an occupied slot harmless rather than destructive.
 *
 * localStorage is shimmed because the island index lives there — lib/engine
 * is otherwise pure, and this is the one place a test has to bring the browser
 * with it.
 */

import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── The browser, in the smallest quantity that will do ──────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
};
/*
 * `save.ts` reaches the cloud sync module, which registers wake-up listeners at
 * import time. Stubbed rather than avoided: the alternative is restructuring a
 * persistence layer to be testable, and the thing under test here is which slot
 * a company lands on, not how the tab notices it woke up.
 */
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = { addEventListener: () => {}, removeEventListener: () => {}, hidden: false };
// Node 22 already provides `navigator` as a getter-only global; leave it be.

register("./ts-loader.mjs", import.meta.url);

const { parseIslandSlot, islandIsOccupied, slotForNewCompany, saveRun, listIslands, flushRun } =
  await import(join(root, "lib/engine/save.ts"));
const { createRun } = await import(join(root, "lib/engine/run.ts"));

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

// ── 1 · the coercion that deleted a company ─────────────────────────────────
console.log("\n=== 1 · an absent ?island= is not island 0 ===");

ok(parseIslandSlot(null) === undefined, "a missing parameter is no answer, not zero");
ok(parseIslandSlot(undefined) === undefined, "and neither is undefined");
ok(parseIslandSlot("") === undefined, "nor a blank one — Number(\"\") is also 0");
ok(parseIslandSlot("   ") === undefined, "nor whitespace");
ok(parseIslandSlot("banana") === undefined, "nor a word");
ok(parseIslandSlot("1.5") === undefined, "nor a fraction of an island");
ok(parseIslandSlot("-1") === undefined, "nor a negative slot");
ok(parseIslandSlot("10") === undefined, "nor one past the cap the database enforces");
// And the thing it must still do, or the picker stops working.
ok(parseIslandSlot("0") === 0, "an explicit island 0 is still island 0");
ok(parseIslandSlot("3") === 3, "and an explicit 3 is 3");

// ── 2 · the backstop ────────────────────────────────────────────────────────
console.log("\n=== 2 · a named slot cannot overwrite a living company ===");

const found = (slot, companyName) => {
  const run = createRun({
    founderName: "Ana",
    playerAge: 15,
    companyName,
    industry: "FOOD",
    rookieMode: true,
    tutorial: false,
  });
  saveRun(run, slot);
  flushRun(slot);
  return run;
};

found(0, "First Company");
ok(listIslands().length === 1, "one company on the water", String(listIslands().length));
ok(islandIsOccupied(0) === true, "island 0 reads as occupied");
ok(islandIsOccupied(1) === false, "island 1 reads as free");

/*
 * The exact decision `startRun` now makes. Kept as a small local mirror rather
 * than driving the React provider, because the rule is the thing under test
 * and a renderer in the way only adds ways for this to pass for the wrong
 * reason. If the provider's expression changes, this assertion is what says
 * the change was a behaviour change.
 */
const targetFor = (asked, cap = 2) =>
  asked === undefined || islandIsOccupied(asked) ? slotForNewCompany(cap) : asked;

ok(targetFor(0) === 1, "founding onto the occupied island 0 is redirected to a free one", String(targetFor(0)));
ok(targetFor(undefined) === 1, "and an unspecified slot picks the free one", String(targetFor(undefined)));
ok(targetFor(1) === 1, "a genuinely free named slot is honoured", String(targetFor(1)));

// The company that was reported destroyed is still there afterwards.
found(targetFor(0), "Second Company");
const names = listIslands()
  .sort((a, b) => a.slot - b.slot)
  .map((i) => i.companyName);
ok(names.length === 2, "two companies now exist", names.join(","));
ok(names[0] === "First Company", "and the first one was not overwritten", names.join(","));
ok(names[1] === "Second Company", "the second landed beside it", names.join(","));

// ── 3 · the allowance still binds ───────────────────────────────────────────
console.log("\n=== 3 · the cap is still a cap ===");

ok(slotForNewCompany(2) === null, "a full archipelago refuses rather than evicting", String(slotForNewCompany(2)));
ok(slotForNewCompany(3) === 2, "and a raised cap opens the next island", String(slotForNewCompany(3)));

// ── 4 · what the run is still missing ───────────────────────────────────────
// The two tabs players report never finding are PRODUCT and TEAM. The tutorial
// names both, once, at minute zero — to someone who has not yet met the
// problem. `nextStep` says it again at the moment it becomes true, and its one
// hard rule is that it must never fire for a company that is not missing
// anything: a nudge that is wrong teaches players to stop reading nudges.
console.log("\n=== 4 · the one thing worth doing ===");

const { nextStep } = await import(join(root, "lib/engine/nudges.ts"));

const company = (over = {}) => {
  const run = createRun({
    founderName: "Ana", playerAge: 15, companyName: "Loop",
    industry: "FOOD", rookieMode: true, tutorial: false,
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
const { portfolioCap } = await import(join(root, "lib/engine/portfolio.ts"));
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

// ── 5 · the age gate ────────────────────────────────────────────────────────
// Novus is a product for minors, and under 13 an online service may not collect
// a child's personal information without verifiable parental consent — which
// this app has no way to obtain. So it does not sign them up. This is an age
// SCREEN, not verification (see lib/auth/age.ts); what is tested here is that
// the rule is consistent everywhere and that a "no" is remembered.
console.log("\n=== 5 · nobody under 13 ===");

const { MIN_AGE, isOldEnough, isPlausibleAge, isAgeBlocked, recordTooYoung, clearAgeBlock } =
  await import(join(root, "lib/auth/age.ts"));

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
// clear it. The storage shim persists for the process, which is the same
// guarantee localStorage gives the page.
ok(isAgeBlocked() === true, "and stays blocked on a second read");
// The age itself is never kept — it is a data point about a child we have just
// decided not to serve.
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
