#!/usr/bin/env node
/**
 * The archipelago's rules, tested against the real persistence layer.
 *
 *   npm run test:islands
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Islands are ten companies sharing one device, and every question about them
 * is answered by which localStorage keys exist: which island is open, which are
 * free, where a new company may go. That made the whole feature vulnerable to a
 * single ordering bug — `saveRun` holds its write for 120 ms, so for that
 * window a company exists in a buffer and not on disk, and every reader that
 * did not know about the buffer answered as if the company were not there.
 *
 * The cost was not subtle. A player founded a second company and was handed the
 * first one back, because the pointer at the new island read as stale and the
 * fallback opened the lowest occupied slot instead. From there /play had no run
 * for the island it thought was open, sent the player to the founding form, and
 * the form — reached without `?island=` — founded on top of island 0.
 *
 * None of that is reachable from the balance harness or the leaderboard suite,
 * because none of it is engine. So it is tested here, against the real module,
 * with a localStorage that behaves like the browser's.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── A browser, as far as the save layer is concerned ────────────────────────
// Enough of one that `canStore()` is true and the flush hooks install. The
// timers are real: the coalescing window is the thing under test, so it is
// never faked away.
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
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  location: { pathname: "/play" },
};

register("./ts-loader.mjs", import.meta.url);

const save = await import(join(root, "lib/engine/save.ts"));
const { adoptable } = await import(join(root, "lib/cloud/sync.ts"));

// ── Harness ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`);
  }
}

const eq = (label, actual, expected) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(`${label}${same ? "" : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`, same);
};

/** A run with the fields the listing cache reads, and nothing it does not. */
const company = (name, over = {}) => ({
  id: `run-${name}`,
  seed: 7,
  companyName: name,
  founderName: "Founder",
  industry: "FOOD",
  year: 1,
  month: 1,
  stage: 1,
  alive: true,
  flags: {},
  log: [],
  stats: { valuation: 0, cash: 1000, revenueAnnual: 0, employees: 0 },
  lastPlayedISO: "2026-01-15",
  ...over,
});

/** Start each case on a device with nothing on it. */
function fresh() {
  save.dropPendingRun();
  storage.clear();
}

console.log("\n=== 1 · a held write is a company that exists ===");
{
  fresh();
  save.saveRun(company("Novice"), 0);
  // Nothing has reached localStorage yet — that is the whole point of the
  // coalescing, and the assertion that makes the rest of this case meaningful.
  ok("the write is still in the buffer", storage.getItem("novus:run:v1:0") === null);
  ok("…and the device still knows it has a company", save.hasAnySavedRun());
  eq("…and it is not offered as a free island", save.firstFreeIsland(), 1);
  ok("…and the island reads as occupied", save.islandOccupied(0));
  save.flushRun();
  ok("flushing puts it where a reload can find it", storage.getItem("novus:run:v1:0") !== null);
}

console.log("\n=== 2 · founding a second company opens the second company ===");
{
  fresh();
  // Island 0 is settled: a company played for a while, written and flushed.
  save.saveRun(company("Novice", { year: 3, month: 5 }), 0);
  save.flushRun();

  // …and this is `startRun`: point the device at the new island, then save.
  // The navigation to /play happens inside the coalescing window, which is
  // where the bug lived.
  save.setActiveIsland(1);
  save.saveRun(company("Ice Cream"), 1);

  eq("the open island is the one just founded", save.activeIsland(), 1);
  eq("the run under it is the new company", save.loadRun().companyName, "Ice Cream");
  eq("…and the old one is untouched", save.loadRun(0).companyName, "Novice");
  eq("…at the year it was left on", save.loadRun(0).year, 3);
  eq("both islands are on the picker", save.listIslands().map((i) => i.companyName), [
    "Novice",
    "Ice Cream",
  ]);
}

console.log("\n=== 3 · a free island is never one that already has a company ===");
{
  fresh();
  save.saveRun(company("Novice"), 0);
  // Held, not flushed: the second founding of a fast double tap asks this
  // question before the first has reached disk.
  eq("the next founding goes to island 1", save.firstFreeIsland(), 1);
  eq("…and so does slotForNewCompany", save.slotForNewCompany(2), 1);
  save.saveRun(company("Ice Cream"), 1);
  eq("a third would go to island 2", save.firstFreeIsland(), 2);
  eq("…but the free tier's allowance refuses it", save.slotForNewCompany(2), null);
}

console.log("\n=== 4 · headstones keep their island and never spend the allowance ===");
{
  fresh();
  save.saveRun(company("Novice", { alive: false, endedBy: "chapter7" }), 0);
  save.flushRun();
  eq("a grave does not count against the two", save.slotForNewCompany(2), 1);
  eq("…and it keeps its own island", save.islandOccupied(0), true);
  eq("live companies are counted alone", save.liveIslandCount(), 0);
}

console.log("\n=== 5 · the pointer survives, and gives up honestly ===");
{
  fresh();
  save.saveRun(company("Novice"), 0);
  save.saveRun(company("Ice Cream"), 1);
  save.flushRun();
  save.setActiveIsland(1);
  eq("the island the player chose is the island they get", save.activeIsland(), 1);

  save.clearRun(1);
  eq("burying it falls back to a company that exists", save.activeIsland(), 0);
  eq("…and the buried island is free again", save.firstFreeIsland(), 1);
  eq("…and off the picker", save.listIslands().map((i) => i.slot), [0]);
}

console.log("\n=== 6 · a company adopted from the cloud lands on its own island ===");
{
  fresh();
  save.adoptFromCloud({
    runs: [
      { slot: 0, state: company("Novice", { year: 4 }) },
      { slot: 3, state: company("Ice Cream", { year: 2 }) },
    ],
  });
  eq("both islands are here", save.listIslands().map((i) => i.slot), [0, 3]);
  eq("…at the years the account left them on", save.listIslands().map((i) => i.year), [4, 2]);
  eq("the next founding fills the gap rather than the end", save.firstFreeIsland(), 1);
  eq("a device that has never opened one still opens something", save.activeIsland(), 0);
}

console.log("\n=== 7 · the other device wins only when it is genuinely ahead ===");
{
  fresh();
  save.saveRun(company("Novice", { year: 1, month: 4 }), 0);
  save.flushRun();
  const [here] = save.listIslands();

  ok(
    "an island this device has never seen is restored",
    adoptable(undefined, company("Ice Cream")),
  );
  ok(
    "the phone's year 3 replaces the tablet's year 1",
    adoptable(here, company("Novice", { year: 3, month: 1 })),
  );
  ok(
    "…and so does the same year, a month further on",
    adoptable(here, company("Novice", { year: 1, month: 5 })),
  );
  ok(
    "a copy level with this one does not — the in-month work is here",
    !adoptable(here, company("Novice", { year: 1, month: 4 })),
  );
  ok(
    "a copy behind this one never rolls the device back",
    !adoptable(here, company("Novice", { year: 1, month: 2 })),
  );
  ok(
    "and a DIFFERENT company in that slot is never overwritten",
    !adoptable(here, { ...company("Ice Cream", { year: 9 }), id: "run-other" }),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
