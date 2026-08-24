#!/usr/bin/env node
/**
 * The Playbook — breadth, branches, and whether growth still adds doors.
 *
 *   npm run test:playbook
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * A player reported that after the first fiscal year the game was "boring and
 * repetitive to keep clicking options", and the measurement agreed: seventeen
 * shared verbs, every one a single tap with a single outcome, and the same list
 * in December as in January and in year five as in year one. docs/PROGRESSION.md
 * is the diagnosis; the Playbook is the answer; this file is what keeps it true.
 *
 * Four things it asserts, all of which fail silently:
 *
 *   1. **Escalation.** The four stage-gated activities had all opened by stage
 *      5, so a late company had strictly FEWER things available than an early
 *      one — progression closed doors. Nothing on any screen says so; you would
 *      have to have played both to notice.
 *
 *   2. **Branch integrity.** A two-level activity records which branch it took
 *      on the leaderboard tape. A duplicated or renamed branch id replays as a
 *      different company, or as none, and the run simply disappears off a board
 *      weeks later with no explanation anybody could give.
 *
 *   3. **Exactly one of `apply` or `options`.** Neither is a row that does
 *      nothing when pressed. Both is a row where one of the two is dead code
 *      nobody will find.
 *
 *   4. **Determinism.** Activities run through the same seeded RNG the events
 *      do. If the same branch from the same state gave two different answers,
 *      every tape containing it would be unverifiable.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

register("./ts-loader.mjs", import.meta.url);

const {
  ACTIVITIES,
  activitiesFor,
  activityById,
  applyActivity,
  canAfford,
  isAvailable,
  isOfferable,
  isSpentThisYear,
  optionsFor,
} = await import(join(root, "lib/engine/activities.ts"));
const { activitiesForIndustry } = await import(join(root, "lib/engine/industries/index.ts"));
const { INDUSTRIES } = await import(join(root, "lib/engine/constants.ts"));
const { createRun } = await import(join(root, "lib/engine/run.ts"));

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

const TABS = ["company", "team", "product", "assets", "market", "closet"];

/**
 * A company with money, people and a name somebody has heard of, so that the
 * only thing deciding what is on offer is the stage and the fiscal year. A test
 * about BREADTH must not accidentally be a test about cash.
 */
const company = (over = {}) => {
  const run = createRun({
    founderName: "Ana",
    playerAge: 16,
    companyName: "Loop",
    industry: over.industry ?? "TECH",
    rookieMode: true,
    tutorial: false,
  });
  const state = { ...run, seed: 8_675_309, pro: true, ...over };
  state.stats = {
    ...state.stats,
    cash: 5_000_000_000,
    brand: 60,
    employees: 12,
    energy: 90,
    morale: 70,
  };
  return state;
};

const offered = (state) => TABS.flatMap((t) => activitiesFor(t, state));

// ── 1 · breadth ─────────────────────────────────────────────────────────────
console.log("\n=== 1 · the list is not seventeen any more ===");

/*
 * The number the complaint was about, named rather than derived, so that
 * shrinking the list back is a decision somebody has to make twice.
 */
const BEFORE = 17;
ok(
  `the shared list is well past the ${BEFORE} it was`,
  ACTIVITIES.length >= BEFORE * 2.5,
  `${ACTIVITIES.length} shared activities`,
);

const byTab = {};
for (const a of ACTIVITIES) byTab[a.tab] = (byTab[a.tab] ?? 0) + 1;
for (const tab of TABS) {
  ok(`the ${tab} tab has shared content of its own`, (byTab[tab] ?? 0) > 0, `${byTab[tab] ?? 0}`);
}
/*
 * The product tab had NO shared activities at all — the twelve industry lenses
 * owned the whole of it — so a player who ran a restaurant and then a software
 * company learned nothing transferable about product.
 */
ok("including product, which used to have none", (byTab.product ?? 0) >= 3);

/*
 * Ids are the dispatcher's whole vocabulary and they are written onto the tape.
 * Two rows sharing one means `activityById` returns whichever comes first and
 * the other is unreachable — and a replay of the second runs the first.
 */
const seenIds = new Map();
const dupes = [];
for (const a of [
  ...ACTIVITIES,
  ...INDUSTRIES.flatMap((i) => activitiesForIndustry(company({ industry: i.code }))),
]) {
  if (seenIds.has(a.id) && seenIds.get(a.id) !== a) dupes.push(a.id);
  seenIds.set(a.id, a);
}
ok("no two activities anywhere share an id", dupes.length === 0, [...new Set(dupes)].join(", "));

// ── 2 · escalation ──────────────────────────────────────────────────────────
console.log("\n=== 2 · growing adds doors, it does not close them ===");

const garage = company({ stage: 1, year: 1 });
const growing = company({ stage: 3, year: 3 });
const scaled = company({ stage: 5, year: 6 });

const nGarage = offered(garage).length;
const nGrowing = offered(growing).length;
const nScaled = offered(scaled).length;

console.log(`      stage 1 → ${nGarage} · stage 3 → ${nGrowing} · stage 5 → ${nScaled}`);
ok("a growing company is offered more than a garage", nGrowing > nGarage);
ok("and a scaled one is offered more than a growing one", nScaled >= nGrowing);
ok(
  "the difference is a real one, not a rounding",
  nScaled >= nGarage * 1.5,
  `${nGarage} → ${nScaled}`,
);
ok(
  "a garage is still offered a full day's worth",
  nGarage >= 12,
  `${nGarage} — a first year that thin is its own problem`,
);
ok(
  "and roughly a third of the shared list is stage-gated",
  ACTIVITIES.filter((a) => a.minStage || (a.options ?? []).some((o) => o.minStage)).length >=
    ACTIVITIES.length / 3,
);

// ── 3 · once a year means once a year ───────────────────────────────────────
console.log("\n=== 3 · the December list is shorter than the January one ===");

const yearlies = ACTIVITIES.filter((a) => a.yearly);
ok("there are yearly activities at all", yearlies.length > 5, `${yearlies.length}`);

const spender = company({ stage: 5, year: 4 });
const oneYearly = yearlies.find((a) => isOfferable(a, spender));
ok("and a scaled company is offered one", !!oneYearly);
if (oneYearly) {
  const after = { ...spender, activityUses: { ...(spender.activityUses ?? {}), [oneYearly.id]: 4 } };
  ok("spending it takes it off this year's list", isSpentThisYear(oneYearly, after));
  ok("and it is gone from the tab", !activitiesFor(oneYearly.tab, after).some((a) => a.id === oneYearly.id));
  ok(
    "but it is back next year",
    isOfferable(oneYearly, { ...after, year: 5 }),
    "a yearly activity that never returns is a once-only one wearing the wrong flag",
  );
}

// ── 4 · exactly one of apply or options ─────────────────────────────────────
console.log("\n=== 4 · every row does something when pressed ===");

const all = [
  ...ACTIVITIES,
  ...INDUSTRIES.flatMap((i) => activitiesForIndustry(company({ industry: i.code }))),
];
const broken = all.filter((a) => !!a.apply === !!a.options);
ok(
  "no activity has both an outcome and a chooser, or neither",
  broken.length === 0,
  broken.map((a) => a.id).join(", "),
);

const twoLevel = ACTIVITIES.filter((a) => a.options?.length);
ok("there are two-level activities at all", twoLevel.length >= 6, `${twoLevel.length}`);
console.log(
  `      ${twoLevel.length} choosers, ${twoLevel.reduce((n, a) => n + a.options.length, 0)} branches`,
);
ok(
  "every chooser offers a real choice, not one branch",
  twoLevel.every((a) => a.options.length >= 2),
  twoLevel.find((a) => a.options.length < 2)?.id,
);
ok(
  "branch ids are unique inside their own activity",
  twoLevel.every((a) => new Set(a.options.map((o) => o.id)).size === a.options.length),
  twoLevel.find((a) => new Set(a.options.map((o) => o.id)).size !== a.options.length)?.id,
);
ok(
  "branch ids are tape-safe — plain ascii, no spaces",
  twoLevel.every((a) => a.options.every((o) => /^[a-z0-9-]+$/.test(o.id))),
  twoLevel.flatMap((a) => a.options).find((o) => !/^[a-z0-9-]+$/.test(o.id))?.id,
);
ok(
  "every branch says what it is",
  twoLevel.every((a) => a.options.every((o) => o.label && o.signal && o.apply)),
);
ok(
  "and no two branches of one activity read the same",
  twoLevel.every((a) => new Set(a.options.map((o) => o.signal)).size === a.options.length),
);

// ── 5 · the branch machinery ────────────────────────────────────────────────
console.log("\n=== 5 · taking a branch, and refusing one ===");

const chooser = twoLevel.find((a) => isOfferable(a, scaled) && optionsFor(a, scaled).length >= 2);
ok("a scaled company can reach a chooser", !!chooser, "nothing to test the machinery against");

if (chooser) {
  const branches = optionsFor(chooser, scaled);

  const missed = structuredClone(scaled);
  const before = JSON.stringify(missed);
  ok(
    "an unnamed branch runs nothing",
    applyActivity(chooser, missed, undefined) === false && JSON.stringify(missed) === before,
  );
  ok(
    "and a branch that does not exist runs nothing",
    (() => {
      const s2 = structuredClone(scaled);
      const b = JSON.stringify(s2);
      return applyActivity(chooser, s2, "no-such-branch") === false && JSON.stringify(s2) === b;
    })(),
    "a tape naming a renamed branch would silently take a different one",
  );

  const took = structuredClone(scaled);
  ok("a named branch runs", applyActivity(chooser, took, branches[0].id) === true);
  ok("and it changed the company", JSON.stringify(took) !== before);

  /*
   * DETERMINISM. Same state, same branch, same answer — or every tape carrying
   * it is unverifiable, because the replay would land somewhere the player
   * never stood.
   */
  const again = structuredClone(scaled);
  applyActivity(chooser, again, branches[0].id);
  ok(
    "the same branch from the same state gives the same answer",
    JSON.stringify(again.stats) === JSON.stringify(took.stats),
  );

  const other = structuredClone(scaled);
  applyActivity(chooser, other, branches[1].id);
  ok(
    "and a different branch gives a different one",
    JSON.stringify(other.stats) !== JSON.stringify(took.stats),
    `${chooser.id}: ${branches[0].id} and ${branches[1].id} are the same decision`,
  );

  /*
   * THE PARENT ID, not the branch's. `spend` records whatever id it is handed
   * and a branch hands it its own ("press:national") so the seeded RNG differs
   * per branch — which is right for the RNG and would silently break `yearly`,
   * because `isSpentThisYear` asks for the parent. Without it a player talks to
   * the local paper, the trade weekly, the podcast AND the national desk in one
   * fiscal year.
   */
  ok(
    "taking any branch spends the parent, not just the branch",
    took.activityUses?.[chooser.id] === took.year,
    `${JSON.stringify(took.activityUses)} — expected a ${chooser.id} entry`,
  );
  const yearlyChooser = twoLevel.find((a) => a.yearly && isOfferable(a, scaled));
  if (yearlyChooser) {
    const once = structuredClone(scaled);
    applyActivity(yearlyChooser, once, optionsFor(yearlyChooser, scaled)[0].id);
    ok(
      "so a yearly chooser cannot be run again through a different branch",
      isSpentThisYear(yearlyChooser, once) && !isOfferable(yearlyChooser, once),
    );
    ok("and it is back the following year", isOfferable(yearlyChooser, { ...once, year: once.year + 1 }));
  }
}

/*
 * A chooser whose every branch is still stage-gated is a door onto a wall. It
 * must be ABSENT rather than pressable-and-empty — a player who opens an empty
 * list learns nothing except that the app is broken.
 */
const gatedOnly = {
  id: "test-only",
  tab: "company",
  label: "x",
  signal: "x",
  detail: "x",
  options: [{ id: "a", label: "a", signal: "a", minStage: 5, apply: () => {} }],
};
ok(
  "a chooser with nothing reachable in it is not offered",
  !isAvailable(gatedOnly, garage) && isAvailable(gatedOnly, scaled),
);
ok(
  "a chooser is affordable when any branch is",
  (() => {
    const poor = company({ stage: 3 });
    poor.stats.cash = 0;
    const free = {
      ...gatedOnly,
      options: [
        { id: "free", label: "f", signal: "f", apply: () => {} },
        { id: "dear", label: "d", signal: "d", costS: 99, apply: () => {} },
      ],
    };
    const dearOnly = { ...free, options: [free.options[1]] };
    return canAfford(free, poor) && !canAfford(dearOnly, poor);
  })(),
);

// ── 6 · the money stays inside the range the game already used ─────────────
console.log("\n=== 6 · nothing here is bigger than what was already there ===");

/*
 * The ceiling is not chosen, it is measured: `real-estate` has cost 20S since
 * long before the Playbook and is the dearest thing the game has ever asked
 * for. The point of the assertion is that nothing ADDED here outgrew what was
 * already on the board — a Playbook entry that quietly became the biggest
 * financial event in the game would be a balance change made by an activity the
 * harness never fires, and nobody would attribute it correctly.
 */
const CEILING = 20;
const prices = [
  ...ACTIVITIES.map((a) => a.costS ?? 0),
  ...ACTIVITIES.flatMap((a) => (a.options ?? []).map((o) => o.costS ?? 0)),
];
const dearest = Math.max(...prices);
ok(
  "nothing costs more than the dearest thing the game already had",
  dearest <= CEILING,
  `dearest is ${dearest}S`,
);
ok(
  "and only one activity sits at that ceiling",
  prices.filter((p) => p === CEILING).length === 1,
  `${prices.filter((p) => p === CEILING).length} at ${CEILING}S`,
);
ok(
  "there is something to do at every price, including nothing",
  prices.filter((p) => p === 0).length > 5 && prices.filter((p) => p > 0).length > 15,
  `${prices.filter((p) => p === 0).length} free, ${prices.filter((p) => p > 0).length} priced`,
);

/*
 * ── Every single row, actually run ──────────────────────────────────────────
 *
 * The one assertion here that is worth more than all the structural ones: fire
 * every activity and every branch at a real company and see what happens. It
 * catches a typo'd stat name, a missing import inside a closure, a `buyAsset`
 * that returns false and leaves the log line claiming otherwise — none of which
 * TypeScript can see, because an effect is authored data and `spend` takes it
 * as such.
 *
 * And it measures the two scales the library caps. The IPO's own note sets
 * them: it is the largest financial event in the game at 18S and 25% of the
 * company, and nothing else may approach that. Two Playbook entries touch
 * ownership on purpose — an option pool and an advisory board — and both are
 * meant to be a fraction of an IPO, not a rival to one.
 */
const IPO_DILUTION = 25;
let fired = 0;
const crashed = [];
const overDiluted = [];

for (const activity of ACTIVITIES) {
  const runs = activity.options?.length
    ? activity.options.map((o) => o.id)
    : [undefined];
  for (const branch of runs) {
    // Stage 5 so nothing is gated out, and a fresh clone each time so one
    // activity's flags cannot suppress the next one's.
    const state = structuredClone(company({ stage: 5, year: 6 }));
    const equityBefore = state.founderEquityPct;
    try {
      if (!applyActivity(activity, state, branch)) continue;
      fired += 1;
    } catch (err) {
      crashed.push(`${activity.id}${branch ? `:${branch}` : ""} — ${err.message}`);
      continue;
    }
    const lost = equityBefore - state.founderEquityPct;
    // The IPO is the benchmark, not a candidate — it hands over a quarter of
    // the company by design, and the ±15% luck band puts the measured figure a
    // point either side of its authored 25.
    if (activity.id !== "ipo" && lost >= IPO_DILUTION) {
      overDiluted.push(`${activity.id}${branch ? `:${branch}` : ""} took ${lost.toFixed(1)}%`);
    }
  }
}

console.log(`      fired ${fired} outcomes without touching the clock`);
ok("every activity and every branch runs without throwing", crashed.length === 0, crashed.join("; "));
ok(
  "and the whole list actually fired, rather than being gated out",
  fired >= ACTIVITIES.length,
  `${fired} outcomes from ${ACTIVITIES.length} activities`,
);
ok(
  "nothing but the IPO dilutes the founder like an IPO",
  overDiluted.length === 0,
  overDiluted.join("; "),
);

// ── 7 · the dispatcher can still find everything ────────────────────────────
console.log("\n=== 7 · every offered row is reachable by id ===");

ok(
  "activityById finds every shared activity",
  ACTIVITIES.every((a) => activityById(a.id, scaled)?.id === a.id),
  ACTIVITIES.find((a) => activityById(a.id, scaled)?.id !== a.id)?.id,
);
for (const { code } of INDUSTRIES) {
  const state = company({ industry: code, stage: 5, year: 5 });
  const rows = offered(state);
  const lost = rows.find((a) => activityById(a.id, state)?.id !== a.id);
  ok(`${code} — everything it is offered can be run`, !lost, lost?.id);
}

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
