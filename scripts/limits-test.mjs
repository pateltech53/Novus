#!/usr/bin/env node
/**
 * The daily rations, tested against the real module.
 *
 *   npm run test:limits
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Two numbers decide what a free account may do in a day — how many companies
 * it may found (`runsPerDay`) and how many fiscal years it may close
 * (`yearClosesPerDay`) — and until now nothing in the repo asserted either.
 * `scripts/pricing-test.mjs` is about in-game product pricing despite the
 * name; `scripts/rules-test.mjs` is the nudge and the age gate;
 * `scripts/islands-test.mjs` passes island caps in as literals rather than
 * reading them. The only daily-cap assertions anywhere were SQL, against
 * `claim_run_slot()` — a function the client never calls.
 *
 * That gap is how the pace limit came to be enforced on one of its two paths.
 * `skipYearGate` checked the ration; `submitPerform`'s year-end branch did
 * not, and the only thing standing between a free player and unlimited closes
 * was a render branch hiding a button. A screen is not a gate. This file
 * covers the arithmetic underneath both — the ledger, the day boundary, the
 * tier selection and the operator grant — so the next time one of those
 * numbers moves, something says so.
 *
 * The two rations are asserted TOGETHER on purpose. They have been confused
 * before: `runsPerDay` is a rate of foundings and `yearClosesPerDay` is a rate
 * of progress, they now happen to both be 1 on free, and a test that only knew
 * about one of them would let a change to the other pass silently.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── A browser, as far as the ledgers are concerned ──────────────────────────
// Same shim scripts/islands-test.mjs uses. `canStore()` has to answer true or
// every ration below fails open and the file asserts nothing.
class MemoryStorage {
  #map = new Map();
  getItem(k) {
    return this.#map.has(String(k)) ? this.#map.get(String(k)) : null;
  }
  setItem(k, v) {
    this.#map.set(String(k), String(v));
  }
  removeItem(k) {
    this.#map.delete(String(k));
  }
  clear() {
    this.#map.clear();
  }
}

const storage = new MemoryStorage();
globalThis.localStorage = storage;
globalThis.sessionStorage = new MemoryStorage();
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.window = {
  localStorage: storage,
  sessionStorage: globalThis.sessionStorage,
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  location: { pathname: "/play" },
};

register("./ts-loader.mjs", import.meta.url);

const {
  FREE_LIMITS,
  PRO_LIMITS,
  ADMIN_LIMITS,
  NO_ENTITLEMENTS,
  isPro,
  limitsFor,
  runsPerDayFor,
  yearClosesFor,
  yearClosesRemainingToday,
  recordYearClose,
  runsRemainingToday,
  recordRunStart,
} = await import(join(root, "lib/monetization.ts"));

// ── Harness ─────────────────────────────────────────────────────────────────
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

/** A fresh device. Both ledgers live in localStorage and nothing else does. */
const reset = () => storage.clear();

const free = { ...NO_ENTITLEMENTS };
const pro = { ...NO_ENTITLEMENTS, pro: true };
const seat = { ...NO_ENTITLEMENTS, chapter: "chapter_35" };
const admin = { ...NO_ENTITLEMENTS, admin: true };

// ── 1 · the numbers themselves ──────────────────────────────────────────────
console.log("\nThe tiers");

ok(
  "free closes one fiscal year a day",
  FREE_LIMITS.yearClosesPerDay === 1,
  `got ${FREE_LIMITS.yearClosesPerDay}`,
);
ok("free founds one company a day", FREE_LIMITS.runsPerDay === 1, `got ${FREE_LIMITS.runsPerDay}`);
ok(
  "pro's pace is far above free's",
  PRO_LIMITS.yearClosesPerDay > FREE_LIMITS.yearClosesPerDay * 10,
  `${PRO_LIMITS.yearClosesPerDay} vs ${FREE_LIMITS.yearClosesPerDay}`,
);
ok(
  "an operator is never capped below pro",
  ADMIN_LIMITS.yearClosesPerDay >= PRO_LIMITS.yearClosesPerDay,
);

// ── 2 · which tier an account is on ─────────────────────────────────────────
console.log("\nWho gets which");

ok("a free account is not pro", !isPro(free));
ok("a subscriber is pro", isPro(pro));
ok("a chapter seat is pro", isPro(seat));
ok("free lands on FREE_LIMITS", limitsFor(free) === FREE_LIMITS);
ok("a seat lands on PRO_LIMITS", limitsFor(seat) === PRO_LIMITS);
ok("an operator lands on ADMIN_LIMITS", limitsFor(admin) === ADMIN_LIMITS);
ok("nothing sold raises the founding rate", runsPerDayFor({ ...free, extraIslands: 8 }) === 1);

// ── 3 · the year-close ledger ───────────────────────────────────────────────
console.log("\nThe year a day");

reset();
ok("a fresh day gives free its one close", yearClosesRemainingToday(free) === 1);

recordYearClose();
ok("closing it spends the day", yearClosesRemainingToday(free) === 0);

ok("the same close does not touch pro", yearClosesRemainingToday(pro) > 0);
ok("nor a chapter seat", yearClosesRemainingToday(seat) > 0);

// The ledger is device-wide by design: counting per company would make
// founding a second one the workaround.
recordYearClose();
recordYearClose();
ok(
  "the ration cannot go negative however many close",
  yearClosesRemainingToday(free) === 0,
  `got ${yearClosesRemainingToday(free)}`,
);

// ── 4 · the day boundary ────────────────────────────────────────────────────
console.log("\nTomorrow");

reset();
storage.setItem("novus:yearcloses:v1", JSON.stringify({ day: "1999-01-01", closed: 99 }));
ok(
  "yesterday's count does not follow the player into today",
  yearClosesRemainingToday(free) === 1,
  `got ${yearClosesRemainingToday(free)}`,
);

reset();
storage.setItem("novus:yearcloses:v1", "{not json");
ok(
  "a corrupt ledger fails OPEN, never locking a player out",
  yearClosesRemainingToday(free) === 1,
);

// ── 5 · the operator's grant stacks ─────────────────────────────────────────
console.log("\nThe grant");

reset();
const granted = { ...free, extraYearCloses: 4 };
ok(
  "a grant adds to the tier rather than replacing it",
  yearClosesFor(granted) === FREE_LIMITS.yearClosesPerDay + 4,
  `got ${yearClosesFor(granted)}`,
);
recordYearClose();
ok("and it is spent from the same ledger", yearClosesRemainingToday(granted) === 4);
ok("while free itself is already out", yearClosesRemainingToday(free) === 0);

// ── 6 · the founding ration, beside it ──────────────────────────────────────
console.log("\nThe company a day");

reset();
ok("a fresh day gives free its one founding", runsRemainingToday(free) === 1);
recordRunStart();
ok("founding one spends the day", runsRemainingToday(free) === 0);
ok(
  "and it did NOT spend a year close — the two rations are separate",
  yearClosesRemainingToday(free) === 1,
);

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
