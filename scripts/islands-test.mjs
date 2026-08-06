/**
 * Does founding a company leave the others alone?
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

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n  ${failures.join("\n  ")}\n` : "\n"),
);
process.exit(failures.length === 0 ? 0 : 1);
