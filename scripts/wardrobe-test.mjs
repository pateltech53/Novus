#!/usr/bin/env node
/**
 * What a fit costs, and what it must never cost.
 *
 *   npm run test:wardrobe
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The wardrobe track used to ask for FINISHED RUNS — 1, 2, 4, 6, 9 and 12 — and
 * nothing else. A run counted the moment it ended, however it ended, so the
 * fastest route to the whole track was to found a company, let it die in March,
 * and repeat twelve times. A game about compounding was paying out for
 * abandoning things.
 *
 * The demands that replaced it are read from `LegacyState`, and three of the
 * four ways they can be wrong are silent:
 *
 *   1. **A demand that rewards the old behaviour.** If any fit is satisfiable
 *      by finishing runs alone, the incentive is back and no screen says so.
 *
 *   2. **A fit that un-earns.** `legacy.autopsies` holds ten companies, so a
 *      career total computed live FALLS on the eleventh founding. A player
 *      would watch a fit they had worn for a month grey out. The sticky ledger
 *      is the fix and this file is what proves it sticks.
 *
 *   3. **A migration that takes something away.** Every device already carries
 *      a wardrobe blob written under the run-count rule. Reading it under the
 *      new demands must not cost anybody a fit they had yesterday.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── A browser, as far as the ledgers are concerned ──────────────────────────
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
globalThis.Event = class {
  constructor(type) {
    this.type = type;
  }
};
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
  SKINS,
  demandProgress,
  demandText,
  founderRecord,
  currentRecord,
  meetsDemands,
  skinProgress,
  isSkinEarned,
  isSkinWearable,
  loadWardrobe,
  saveWardrobe,
  equipSkin,
  syncEarnedSkins,
  resolveEquippedSkin,
} = await import(join(root, "lib/engine/wardrobe.ts"));

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

const LEGACY_KEY = "novus:legacy:v1";
const WARDROBE_KEY = "novus:wardrobe:v1";

/** A founder's whole record, written straight into the store. */
function withRecord({ bestYear = 0, runsCompleted = 0, years = [] }) {
  storage.clear();
  storage.setItem(
    LEGACY_KEY,
    JSON.stringify({
      bestYear,
      runsCompleted,
      sharkRespect: 10,
      badges: [],
      autopsies: years.map((y, i) => ({
        runId: `r${i}`,
        companyName: `Co ${i}`,
        years: y,
        causes: [],
      })),
    }),
  );
}

const skin = (id) => SKINS.find((s) => s.id === id);

// ── 1 · the shape of the ladder ─────────────────────────────────────────────
console.log("\n=== 1 · six demands, four shapes ===");

ok("six fits, as the closet draws", SKINS.length === 6);
ok(
  "every fit asks for something",
  SKINS.every((s) => s.demands.length > 0),
  SKINS.find((s) => s.demands.length === 0)?.id,
);
ok(
  "the ladder uses more than one kind of demand",
  new Set(SKINS.flatMap((s) => s.demands.map((d) => d.kind))).size >= 3,
);
ok(
  "every demand reads as an instruction, not a score",
  SKINS.flatMap((s) => s.demands).every((d) => /\.$/.test(demandText(d)) && demandText(d).length > 12),
);

/*
 * THE CENTRAL ASSERTION OF THIS FILE.
 *
 * The old rule was finished runs and the old rule was the bug. No fit may be
 * bought with them alone — a founder who starts and abandons companies all day
 * must get nowhere. `runsFinished` survives only as a COMPANION clause, so a
 * record with a hundred abandoned runs and no years in any of them earns
 * nothing.
 */
const abandoner = founderRecord(
  { bestYear: 1, runsCompleted: 100, sharkRespect: 10, badges: [], autopsies: [] },
  0,
);
ok(
  "founding and abandoning a hundred companies earns no fit at all",
  SKINS.every((s) => !meetsDemands(s, abandoner)),
  SKINS.filter((s) => meetsDemands(s, abandoner))
    .map((s) => s.id)
    .join(", "),
);

// ── 2 · the founder's own two examples ──────────────────────────────────────
console.log("\n=== 2 · the demands from the brief ===");

/* "reach year 3" — one company, three fiscal years. */
const yearThree = founderRecord(
  { bestYear: 3, runsCompleted: 0, sharkRespect: 10, badges: [], autopsies: [] },
  0,
);
ok("reaching fiscal year 3 earns the first fit", meetsDemands(skin("chef"), yearThree));
ok(
  "and reaching year 2 does not",
  !meetsDemands(
    skin("chef"),
    founderRecord({ bestYear: 2, runsCompleted: 9, sharkRespect: 10, badges: [], autopsies: [] }),
  ),
);

/* "complete 5 fiscal years in two runs" — the second fit, verbatim. */
const twoRuns = founderRecord({
  bestYear: 3,
  runsCompleted: 2,
  sharkRespect: 10,
  badges: [],
  autopsies: [
    { runId: "a", companyName: "A", years: 3, causes: [] },
    { runId: "b", companyName: "B", years: 2, causes: [] },
  ],
});
ok("three years plus two across two companies earns the second", meetsDemands(skin("gamer"), twoRuns));
ok(
  "spread across five one-year companies, it does not",
  !meetsDemands(
    skin("gamer"),
    founderRecord({
      bestYear: 1,
      runsCompleted: 5,
      sharkRespect: 10,
      badges: [],
      autopsies: [1, 1, 1, 1, 1].map((y, i) => ({
        runId: `x${i}`,
        companyName: "X",
        years: y,
        causes: [],
      })),
    }),
  ),
  "topRuns is summing more companies than it is meant to",
);

// ── 3 · the record's arithmetic ─────────────────────────────────────────────
console.log("\n=== 3 · reading the record ===");

const mixed = founderRecord(
  {
    bestYear: 7,
    runsCompleted: 3,
    sharkRespect: 10,
    badges: [],
    autopsies: [
      { runId: "a", companyName: "A", years: 7, causes: [] },
      { runId: "b", companyName: "B", years: 2, causes: [] },
      { runId: "c", companyName: "C", years: 4, causes: [] },
    ],
  },
  5, // and a live company in fiscal year 6
);
ok("career years sum every company on the record, live one included", mixed.careerYears === 18);
ok("the years are ranked longest first", mixed.yearsByRun.join(",") === "7,5,4,2");
ok(
  "the best two are the best two, not the first two",
  demandProgress({ kind: "topRuns", across: 2, need: 99 }, mixed).have === 12,
);
ok("the live run counts toward best year when it is ahead", mixed.bestYear === 7);
ok(
  "a live run past the record raises the best year",
  founderRecord({ bestYear: 3, runsCompleted: 0, sharkRespect: 10, badges: [], autopsies: [] }, 9)
    .bestYear === 9,
);
ok(
  "progress never reads above the demand",
  demandProgress({ kind: "careerYears", need: 5 }, mixed).frac === 1,
);
ok(
  "and the headline fraction is the WEAKEST clause, never the average",
  // drippedout wants year 10 AND 40 career years. This record has neither, but
  // it is much closer to one than the other.
  Math.abs(skinProgress(skin("drippedout"), mixed).frac - 18 / 40) < 1e-9,
  `${skinProgress(skin("drippedout"), mixed).frac}`,
);

// ── 4 · nothing un-earns ────────────────────────────────────────────────────
console.log("\n=== 4 · the sticky ledger ===");

withRecord({ bestYear: 4, runsCompleted: 1, years: [4] });
storage.setItem(WARDROBE_KEY, JSON.stringify({ equipped: null, earned: [] }));
const banked = syncEarnedSkins();
ok("meeting a demand banks the fit", banked.includes("chef"), banked.join(","));
ok("and it is written to the store", (loadWardrobe().earned ?? []).includes("chef"));
ok("banking again banks nothing and writes nothing", syncEarnedSkins().length === 0);

/*
 * The eleventh company. `autopsies` holds ten, so the record a live computation
 * would read has genuinely lost years the founder really played — and the fit
 * has to survive that.
 */
storage.setItem(
  LEGACY_KEY,
  JSON.stringify({
    bestYear: 1,
    runsCompleted: 11,
    sharkRespect: 10,
    badges: [],
    autopsies: Array.from({ length: 10 }, (_, i) => ({
      runId: `n${i}`,
      companyName: "N",
      years: 1,
      causes: [],
    })),
  }),
);
ok(
  "a record that shrinks no longer meets the demand",
  !meetsDemands(skin("chef"), currentRecord()),
  "the premise of this section is wrong — rewrite it",
);
ok(
  "but the fit is still earned, because it was banked",
  isSkinEarned(skin("chef"), currentRecord(), loadWardrobe().earned ?? []),
);
ok(
  "and it is still what the founder is wearing",
  (() => {
    equipSkin("chef");
    storage.setItem(
      "novus:entitlements:v1",
      JSON.stringify({ pro: true, extraIslands: 0, extraYearCloses: 0 }),
    );
    return resolveEquippedSkin() === "chef";
  })(),
);

// ── 5 · the migration off the old rule ──────────────────────────────────────
console.log("\n=== 5 · nobody loses a fit they had ===");

/*
 * A device from before the demands existed: a wardrobe blob with an `equipped`
 * and no `earned`, beside a legacy that finished nine runs. Under the OLD rule
 * that bought five of the six fits, and every one of them has to survive the
 * first read.
 */
storage.clear();
storage.setItem(
  LEGACY_KEY,
  JSON.stringify({
    bestYear: 1,
    runsCompleted: 9,
    sharkRespect: 10,
    badges: [],
    autopsies: [],
  }),
);
storage.setItem(WARDROBE_KEY, JSON.stringify({ equipped: "mathgenius" }));

/*
 * `loadWardrobe` is PURE — it is the getSnapshot of a useSyncExternalStore and
 * must not write during render — so the grandfathered list is in memory the
 * moment it is read, and `syncEarnedSkins` is what commits it.
 */
const migrated = loadWardrobe();
const owedUnderOldRule = SKINS.filter((s) => s.legacyRuns <= 9).map((s) => s.id);
ok(
  "every fit the old rule had paid for is grandfathered in",
  owedUnderOldRule.every((id) => (migrated.earned ?? []).includes(id)),
  `${owedUnderOldRule.join(",")} vs ${(migrated.earned ?? []).join(",")}`,
);
ok(
  "and nothing the old rule had NOT paid for comes with it",
  !(migrated.earned ?? []).includes("drippedout"),
);
ok("the equipped fit survives the migration", migrated.equipped === "mathgenius");
ok(
  "reading it does NOT write during render",
  JSON.parse(storage.getItem(WARDROBE_KEY)).earned === undefined,
  "loadWardrobe wrote to storage — it is a getSnapshot and must stay pure",
);
syncEarnedSkins();
ok(
  "and syncEarnedSkins commits it, once",
  Array.isArray(JSON.parse(storage.getItem(WARDROBE_KEY)).earned) &&
    owedUnderOldRule.every((id) => JSON.parse(storage.getItem(WARDROBE_KEY)).earned.includes(id)),
);
ok(
  "a fit whose demands are unmet but which was earned still wears",
  isSkinWearable(skin("mathgenius"), currentRecord(), true, migrated.earned ?? []),
);

// A device that had earned NOTHING must still be marked as migrated, or the
// seed re-runs on every load — and would re-grant fits after a sign-out wipe.
storage.setItem(LEGACY_KEY, JSON.stringify({ bestYear: 0, runsCompleted: 0, sharkRespect: 10, badges: [], autopsies: [] }));
storage.removeItem(WARDROBE_KEY);
storage.setItem(WARDROBE_KEY, JSON.stringify({ equipped: null }));
syncEarnedSkins();
ok(
  "an empty grandfather list is still recorded as done",
  JSON.parse(storage.getItem(WARDROBE_KEY)).earned?.length === 0,
);

// ── 6 · Brand Law 4 ─────────────────────────────────────────────────────────
console.log("\n=== 6 · cosmetic, and provably so ===");

const src = await import("node:fs").then((fs) =>
  fs.readFileSync(join(root, "lib/engine/wardrobe.ts"), "utf8"),
);
ok(
  "the wardrobe imports nothing from the sim",
  !/from "\.\/(sim|run|effects|events|autopsy)"/.test(src),
);
ok(
  "and no demand is priced in anything but fiscal years and companies",
  SKINS.flatMap((s) => s.demands).every((d) =>
    ["bestYear", "topRuns", "careerYears", "runsFinished"].includes(d.kind),
  ),
);
/*
 * Behavioural, not a grep: buy everything and the earned set must not move by
 * one fit. Pro decides who may WEAR a fit and has never decided who has earned
 * one, and this is the assertion that keeps those two apart.
 */
ok(
  "buying every entitlement earns nothing",
  (() => {
    storage.clear();
    storage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        bestYear: 3,
        runsCompleted: 1,
        sharkRespect: 10,
        badges: [],
        autopsies: [{ runId: "a", companyName: "A", years: 3, causes: [] }],
      }),
    );
    storage.setItem(WARDROBE_KEY, JSON.stringify({ equipped: null, earned: [] }));
    const free = syncEarnedSkins().slice().sort().join(",");

    storage.setItem(WARDROBE_KEY, JSON.stringify({ equipped: null, earned: [] }));
    storage.setItem(
      "novus:entitlements:v1",
      JSON.stringify({
        pro: true,
        admin: true,
        chapter: "chapter_35",
        extraIslands: 50,
        extraYearCloses: 50,
        industryPacks: ["all"],
        cosmeticBundles: ["all"],
      }),
    );
    const bought = syncEarnedSkins().slice().sort().join(",");
    return free === bought;
  })(),
);

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
