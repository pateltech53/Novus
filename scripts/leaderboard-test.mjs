#!/usr/bin/env node
/**
 * The leaderboard's contract, tested against the real engine.
 *
 *   npm run test:board
 *
 * docs/LEADERBOARD.md §10.4 states the acceptance test in one sentence: "a tape
 * produced by the sim must verify, and the same tape with one number edited
 * must not." That is what this file does, plus the cases that turned out to
 * matter once the tape had more than one kind of entry in it.
 *
 * ── Why the driver below looks like GameProvider ────────────────────────────
 *
 * Because it has to. `advanceMonth()` is one call out of five that a tap on
 * ADVANCE MONTH makes, and a verifier that made four of them would reject real
 * runs for a living. The driver therefore plays through the SAME shared
 * orchestration the app does — `advanceTurn`, `closeFiscalYear`, `buyStockAt`
 * — and records a tape at the same moments `lib/state/GameProvider.tsx` does.
 * If those two ever drift, this test still passes and the board still lies;
 * that residual risk is why the orchestration is shared rather than copied, and
 * why the imports below are the app's and not a headless rewrite of them.
 *
 * ── The clock ───────────────────────────────────────────────────────────────
 *
 * Frozen before the engine loads, exactly as scripts/simulate.mjs does and for
 * the same reason: Today's Market is seeded by the UTC date, so an unpinned
 * clock makes this suite pass on Tuesday and fail on Wednesday.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SIM_DATE = process.env.NOVUS_SIM_DATE ?? "2026-01-15";
const FROZEN_MS = new Date(`${SIM_DATE}T12:00:00.000Z`).getTime();
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FROZEN_MS);
    else super(...args);
  }
  static now() {
    return FROZEN_MS;
  }
}
globalThis.Date = FrozenDate;

register("./ts-loader.mjs", import.meta.url);

const { advanceTurn, closeFiscalYear, dealFor, buyStockAt, replayTape, runFromTape } =
  await import(join(root, "lib/leaderboard/replay.ts"));
const { canonicalJson } = await import(join(root, "lib/leaderboard/tape.ts"));
const { checkBounds } = await import(join(root, "lib/leaderboard/bounds.ts"));
const { moderateCompanyName } = await import(join(root, "lib/leaderboard/moderation.ts"));
const { handleShuffle, isPoolHandle, HANDLE_PATTERN } = await import(
  join(root, "lib/leaderboard/handles.ts")
);
const { visibleChoices, resolveChoice } = await import(join(root, "lib/engine/run.ts"));
const { candidatePool } = await import(join(root, "lib/engine/people.ts"));
const { assetById } = await import(join(root, "lib/engine/holdings.ts"));
const { deriveValuation } = await import(join(root, "lib/engine/sim.ts"));
const { syncPositioning } = await import(join(root, "lib/engine/positioning.ts"));
const { mulberry32, hashString } = await import(join(root, "lib/engine/rng.ts"));
const { minuteOf } = await import(join(root, "lib/engine/market.ts"));
const { scorePitchContent } = await import(join(root, "lib/ai/pitch-content.ts"));

const EVENTS = JSON.parse(readFileSync(join(root, "data", "events.json"), "utf8"));

// ── Assertions ──────────────────────────────────────────────────────────────

let passed = 0;
const failures = [];

function ok(condition, label, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const eq = (a, b, label) => ok(a === b, label, `expected ${b}, got ${a}`);

/** Money is floating point. Same to within a cent is the same number. */
const near = (a, b, label, tolerance = 0.01) =>
  ok(
    Math.abs(a - b) <= Math.max(tolerance, Math.abs(b) * 1e-9),
    label,
    `expected ~${b}, got ${a}`,
  );

// ── A player, driven the way the app drives one ─────────────────────────────

/**
 * A pitch with enough substance to score. Written once so every year of every
 * run in this suite pitches the same way — the scorer is deterministic, so the
 * words being fixed is what makes the year-end deal fixed too.
 */
const PITCH =
  "We sell a subscription box and we make money on every order after the first. " +
  "Revenue is growing, gross margin is about sixty percent, and our burn rate is " +
  "under control. We want the money for inventory and one more operations hire. " +
  "Our customers come back because the quality is better than anything at this price.";

/**
 * Plays a company and records the tape as it goes.
 *
 * Mirrors GameProvider: every append happens inside the mutation that changed
 * the run, before anything is committed. The policy — which choice, which
 * candidate, when to trade — is seeded off the run so the whole suite is
 * reproducible from one integer.
 */
function playAndRecord({ seed, years, industry, companyName, pro = false }) {
  const tape = {
    seed,
    founderName: "",
    companyName,
    industry,
    tutorial: false,
    entries: [],
  };
  const state = runFromTape(tape);
  state.pro = pro;
  if (pro) tape.entries.push({ t: "pro", on: true });

  const rng = mulberry32(hashString(`board-test:${seed}`));
  let peak = deriveValuation(state);
  const track = () => {
    const now = deriveValuation(state);
    if (now > peak) peak = now;
  };

  for (let y = 0; y < years && state.alive; y++) {
    while (state.month < 12 && state.alive) {
      const turn = advanceTurn(state, EVENTS);
      if (turn.gate) break;
      tape.entries.push({ t: "advance", atISO: state.lastPlayedISO });
      track();
      if (turn.died) break;

      for (const ev of turn.cards) {
        const choices = visibleChoices(state, ev);
        if (choices.length === 0) {
          tape.entries.push({ t: "dismiss", eventId: ev.id });
          continue;
        }
        const index = Math.floor(rng() * choices.length);
        if (choices[index]?.perform) {
          // The camera resolves it, not the tap — same as the app.
          const content = scorePitchContent(PITCH, state);
          resolveChoice(state, ev, index, content.empty ? 0 : content.score);
          syncPositioning(state);
          tape.entries.push({
            t: "perform",
            kind: "choice",
            performType: choices[index].perform.type,
            eventId: ev.id,
            choiceIndex: index,
            transcript: PITCH,
          });
        } else {
          resolveChoice(state, ev, index);
          syncPositioning(state);
          tape.entries.push({ t: "choice", eventId: ev.id, choice: index });
        }
        track();
      }

      // A few non-time actions, so the tape carries more than advances and
      // choices — the kinds that turned out to matter are the ones with an
      // index in them.
      if (state.month === 4) {
        const pool = candidatePool(state, 6);
        const pick = pool.findIndex((c) => !c.pro || state.pro);
        if (pick >= 0) {
          const { hire } = hireModule;
          hire(state, pool[pick]);
          tape.entries.push({ t: "hire", index: pick });
          track();
        }
      }
      if (state.month === 7 && state.holdings.length === 0) {
        const def = assetById("watch");
        if (def && state.stats.cash > def.priceS * 2000) {
          const { buyAsset } = holdingsModule;
          if (buyAsset(state, def)) {
            tape.entries.push({ t: "buy-asset", defId: "watch" });
            track();
          }
        }
      }
      if (state.month === 9 && state.stats.cash > 50_000) {
        const amount = 10_000;
        state.stats.cash -= amount;
        state.brokerageCash += amount;
        tape.entries.push({ t: "transfer", amountUsd: amount });
        const minute = minuteOf();
        if (buyStockAt(state, "NVSX", 5, minute)) {
          tape.entries.push({ t: "trade", side: "buy", symbol: "NVSX", qty: 5, minute });
        }
        track();
      }
    }
    if (!state.alive) break;

    const content = scorePitchContent(PITCH, state);
    const score = content.empty ? 0 : content.score;
    const deal = dealFor(state, score);
    closeFiscalYear(
      state,
      { type: "pitch", score, multiplier: 0.4 + 0.12 * score, year: state.year },
      deal.cashS,
      deal.equityPct,
    );
    tape.entries.push({
      t: "perform",
      kind: "yearEnd",
      performType: "pitch",
      transcript: PITCH,
    });
    track();

    const pick = ["marketing", "product", "save"][Math.floor(rng() * 3)];
    const flag = `alloc-y${state.year}`;
    if (!state.flags[flag]) {
      const { applyAllocation } = runModule;
      applyAllocation(state, pick);
      state.flags[flag] = true;
      tape.entries.push({ t: "allocation", pick });
      track();
    }
  }

  return { tape, state, peak, yearsClosed: tape.entries.filter(isYearClose).length };
}

const isYearClose = (e) => e.t === "perform" && e.kind === "yearEnd";

const hireModule = await import(join(root, "lib/engine/people.ts"));
const holdingsModule = await import(join(root, "lib/engine/holdings.ts"));
const runModule = await import(join(root, "lib/engine/run.ts"));

// ── 0 · Brand Law 4, as arithmetic ──────────────────────────────────────────

/*
 * docs/LEADERBOARD.md §8.3 asked for these and they were never written.
 *
 * "Cosmetics, run slots and scenario packs are purchasable. Score, survival,
 *  revives and leaderboard position NEVER are. This is a product for minors —
 *  a legal constraint, not a taste one."
 *
 * §8.2 documented two live violations of that law: the Pro talent pool rolled
 * performance 72–96 against free's 48–78, and `art` was a Pro-only asset with
 * the best appreciation in the catalogue. Both are fixed in the engine today.
 * Nothing stopped them coming back — a one-word edit to either file re-breaks
 * the promise `ProSheet.tsx` and `PlansSheet.tsx` make in writing, and the
 * failure is silent until somebody screenshots the top ten.
 *
 * They live in this suite because a valuation board is what makes them
 * observable: assets are sold back into cash, cash is survival, and survival is
 * the board.
 */
console.log("\n=== 0 · Brand Law 4: nothing purchasable moves a board ===");

{
  const { INDUSTRIES } = await import(join(root, "lib/engine/constants.ts"));
  const { ASSET_CATALOG } = await import(join(root, "lib/engine/holdings.ts"));

  const best = Math.max(...INDUSTRIES.map((i) => i.multiple));
  const bestFree = Math.max(...INDUSTRIES.filter((i) => i.free).map((i) => i.multiple));
  ok(
    bestFree >= best,
    "the best valuation multiple in the game is free",
    `best ${best}, best free ${bestFree}`,
  );

  const bestAsset = Math.max(...ASSET_CATALOG.map((a) => a.appreciation));
  const bestFreeAsset = Math.max(
    ...ASSET_CATALOG.filter((a) => !a.pro).map((a) => a.appreciation),
  );
  ok(
    bestFreeAsset >= bestAsset,
    "the best-compounding asset in the game is free",
    `best ${bestAsset}, best free ${bestFreeAsset}`,
  );

  // The pool rolls one curve. `pro` decides who can SEE a candidate, and the
  // check is that it decides nothing else — sampled across a year of months so
  // one lucky draw cannot hide a distribution that split again.
  const probe = runFromTape({
    seed: 4242,
    founderName: "",
    companyName: "Probe",
    industry: "TECH",
    tutorial: false,
    entries: [],
  });
  let freeBest = 0;
  let proBest = 0;
  let freeWorst = 100;
  let proWorst = 100;
  for (let month = 1; month <= 12; month++) {
    probe.month = month;
    for (const c of candidatePool(probe, 6)) {
      if (c.pro) {
        proBest = Math.max(proBest, c.performance);
        proWorst = Math.min(proWorst, c.performance);
      } else {
        freeBest = Math.max(freeBest, c.performance);
        freeWorst = Math.min(freeWorst, c.performance);
      }
    }
  }
  ok(
    freeBest >= proBest,
    "a free candidate can be as good as any Pro one",
    `free tops out at ${freeBest}, Pro at ${proBest}`,
  );
  ok(
    freeWorst <= proWorst,
    "…and Pro candidates are drawn from the same floor, not a raised one",
    `free floor ${freeWorst}, Pro floor ${proWorst}`,
  );
}

// ── 1 · A recorded run replays to itself ────────────────────────────────────

console.log("\n=== 1 · a tape replays to the run that produced it ===");

const CASES = [
  { seed: 12345, years: 6, industry: "TECH", companyName: "Sharkfin" },
  { seed: 777, years: 4, industry: "FOOD", companyName: "Bread & Butter" },
  { seed: 24680, years: 8, industry: "ECOM", companyName: "Parcel Post" },
];

for (const spec of CASES) {
  const played = playAndRecord(spec);
  const replayed = replayTape(played.tape, EVENTS);
  const label = `${spec.companyName} (${spec.industry}, seed ${spec.seed})`;

  eq(replayed.state.year, played.state.year, `${label}: same fiscal year`);
  eq(replayed.state.month, played.state.month, `${label}: same month`);
  eq(replayed.state.alive, played.state.alive, `${label}: same fate`);
  eq(replayed.state.stage, played.state.stage, `${label}: same stage`);
  near(replayed.state.stats.cash, played.state.stats.cash, `${label}: same cash`);
  near(
    replayed.state.stats.valuation,
    played.state.stats.valuation,
    `${label}: same valuation`,
  );
  near(replayed.peakValuation, played.peak, `${label}: same PEAK valuation`);
  eq(replayed.yearsSurvived, Math.max(1, played.yearsClosed), `${label}: same years`);
  eq(replayed.skipped.length, 0, `${label}: every entry applied`);
}

// ── 2 · An edited tape does not replay to the claim ─────────────────────────

console.log("\n=== 2 · one edited number, and the numbers no longer agree ===");

{
  const played = playAndRecord(CASES[0]);
  const honest = replayTape(played.tape, EVENTS);

  // The whole threat model in one test: a player edits localStorage. The tape
  // is inputs, so the only thing they CAN edit is an input — and an edited
  // input replays to a different company, which is the point.
  const forged = structuredCloneCompat(played.tape);
  const firstChoice = forged.entries.findIndex((e) => e.t === "choice");
  forged.entries[firstChoice] = { ...forged.entries[firstChoice], choice: 999 };
  const cheated = replayTape(forged, EVENTS);
  ok(
    cheated.skipped.length > 0,
    "an out-of-range choice is skipped rather than believed",
    `skipped ${cheated.skipped.length}`,
  );

  // A tape that claims a peak it did not earn. The replay does not read the
  // claim at all, which is why the claim cannot move the number.
  const bounds = checkBounds(
    played.tape,
    { peakValuation: 9.9e12, yearsSurvived: honest.yearsSurvived },
    SIM_DATE,
  );
  eq(bounds.verdict, "reject", "a trillion-dollar claim is rejected before any replay");

  // And the honest claim passes.
  const honestBounds = checkBounds(
    played.tape,
    { peakValuation: honest.peakValuation, yearsSurvived: honest.yearsSurvived },
    SIM_DATE,
  );
  ok(honestBounds.verdict !== "reject", "the run's own numbers pass its own bounds");

  // Swapping the seed is the cheapest possible forgery: same taps, better luck.
  const reseeded = { ...structuredCloneCompat(played.tape), seed: played.tape.seed + 1 };
  const other = replayTape(reseeded, EVENTS);
  ok(
    Math.abs(other.peakValuation - honest.peakValuation) > 0.01 ||
      other.state.year !== honest.state.year,
    "a different seed replays to a different company",
  );
}

// ── 3 · The peak is a peak ──────────────────────────────────────────────────

console.log("\n=== 3 · peak valuation ===");

{
  // The gap docs/LEADERBOARD.md §2 opens with: RunState stores the CURRENT
  // valuation, so a company that peaked high and died low remembers the low
  // number. The replay's peak must be the high one.
  const played = playAndRecord({ seed: 909, years: 10, industry: "TECH", companyName: "Icarus" });
  const replayed = replayTape(played.tape, EVENTS);
  ok(
    replayed.peakValuation >= replayed.state.stats.valuation - 0.01,
    "the peak is never below the final valuation",
    `peak ${Math.round(replayed.peakValuation)} vs final ${Math.round(replayed.state.stats.valuation)}`,
  );
  ok(replayed.peakValuation > 0, "the peak is a real number");
}

// ── 4 · Pro buys nothing a board can see ────────────────────────────────────

console.log("\n=== 4 · Brand Law 4: the same run, Pro and free ===");

{
  /*
   * The gate the whole board exists to keep honest.
   *
   * Same seed, same taps, `pro` on and off. Pro gates which candidates and
   * asset classes are VISIBLE, and this test's policy only ever hires a
   * candidate both tiers can see — so if the two runs diverge, something Pro
   * bought reached the books, and that is Brand Law 4 broken.
   */
  const free = playAndRecord({ seed: 31337, years: 6, industry: "TECH", companyName: "Level" });
  const paid = playAndRecord({
    seed: 31337,
    years: 6,
    industry: "TECH",
    companyName: "Level",
    pro: true,
  });
  near(paid.peak, free.peak, "Pro and free reach the same peak valuation");
  eq(paid.yearsClosed, free.yearsClosed, "Pro and free survive the same number of years");
  near(
    paid.state.stats.valuation,
    free.state.stats.valuation,
    "Pro and free finish on the same books",
  );
}

// ── 5 · Bounds ──────────────────────────────────────────────────────────────

console.log("\n=== 5 · plausibility bounds ===");

{
  const base = {
    seed: 1,
    founderName: "",
    companyName: "Bounds Co",
    industry: "TECH",
    tutorial: false,
    entries: [{ t: "advance", atISO: "2026-01-10" }],
  };
  const claim = { peakValuation: 1000, yearsSurvived: 1 };

  eq(checkBounds(base, claim, SIM_DATE).verdict, "pass", "a minimal honest tape passes");

  eq(
    checkBounds({ ...base, founderName: "Sam" }, claim, SIM_DATE).verdict,
    "reject",
    "a tape carrying a founder name is refused",
  );

  // industryByCode ends in `.find(...)!`, so an unknown code throws rather than
  // returning undefined. Refused before the ceiling reaches for its multiple.
  eq(
    checkBounds({ ...base, industry: "NOPE" }, claim, SIM_DATE).verdict,
    "reject",
    "an unknown industry is refused, not thrown on",
  );

  eq(
    checkBounds(base, { ...claim, yearsSurvived: 61 }, SIM_DATE).verdict,
    "reject",
    "61 years is out of range",
  );

  eq(
    checkBounds(base, { ...claim, yearsSurvived: 40 }, SIM_DATE).verdict,
    "reject",
    "a 40-year claim carried by one advance is refused",
  );

  eq(
    checkBounds(
      {
        ...base,
        entries: [
          { t: "advance", atISO: "2026-01-10" },
          { t: "advance", atISO: "2026-01-09" },
        ],
      },
      claim,
      SIM_DATE,
    ).verdict,
    "reject",
    "a run cannot go back in time",
  );

  eq(
    checkBounds(
      { ...base, entries: [{ t: "advance", atISO: "2030-01-01" }] },
      claim,
      SIM_DATE,
    ).verdict,
    "reject",
    "a run cannot come from the future",
  );

  const fourCalls = ["a", "b", "c", "d"].map(() => ({
    t: "coldcall",
    investorId: "x",
    transcript: "hello",
    atISO: "2026-01-10",
  }));
  eq(
    checkBounds({ ...base, entries: [...base.entries, ...fourCalls] }, claim, SIM_DATE).verdict,
    "reject",
    "four cold calls in one real day is a forged tape",
  );
}

// ── 6 · Moderation ──────────────────────────────────────────────────────────

console.log("\n=== 6 · nothing a child typed reaches a board unread ===");

{
  eq(moderateCompanyName("Sharkfin").verdict, "clean", "an ordinary name is clean");
  eq(moderateCompanyName("Bread & Butter Co.").verdict, "clean", "punctuation is allowed");
  eq(moderateCompanyName("Call me 555-0134").verdict, "reject", "a phone number is refused");
  eq(moderateCompanyName("me@school.edu").verdict, "reject", "an email is refused");
  eq(moderateCompanyName("visit www.example.com").verdict, "reject", "a URL is refused");
  eq(moderateCompanyName("@myhandle").verdict, "reject", "a social handle is refused");
  eq(moderateCompanyName("F.U.C.K Ltd").verdict, "review", "obfuscated profanity is caught");
  eq(moderateCompanyName("Sarah Mitchell").verdict, "review", "a personal name waits for a human");
  eq(moderateCompanyName("Marco Holdings").verdict, "review", "…and so does anything shaped like one");
  eq(moderateCompanyName("A").verdict, "reject", "one character is not a name");
  eq(moderateCompanyName("x".repeat(41)).verdict, "reject", "an over-long name is refused");
  eq(moderateCompanyName("​Hidden").verdict, "reject", "zero-width characters are refused");
}

// ── 7 · Handles ─────────────────────────────────────────────────────────────

console.log("\n=== 7 · the board's only name comes from a word list ===");

{
  const shuffle = handleShuffle(42, 6);
  eq(shuffle.length, 6, "the shuffle offers six");
  ok(
    shuffle.every((h) => HANDLE_PATTERN.test(h)),
    "every handle matches the shape both tables constrain",
  );
  ok(shuffle.every(isPoolHandle), "every handle is in the pool");
  ok(new Set(shuffle).size === shuffle.length, "the shuffle does not repeat itself");
  ok(
    JSON.stringify(handleShuffle(42, 6)) === JSON.stringify(shuffle),
    "the same seed offers the same six",
  );
  ok(!isPoolHandle("Zzzz Qqqq 0000"), "a shape-matching handle outside the pool is refused");
  ok(!isPoolHandle("Sarah Mitchell 1998"), "a real name in the right shape is refused");
}

// ── 8 · Canonical JSON ──────────────────────────────────────────────────────

console.log("\n=== 8 · the same tape hashes the same way ===");

{
  const a = { seed: 1, founderName: "", companyName: "A", industry: "TECH", tutorial: false, entries: [] };
  const b = { entries: [], industry: "TECH", companyName: "A", founderName: "", tutorial: false, seed: 1 };
  eq(canonicalJson(a), canonicalJson(b), "key order does not change the bytes");
  ok(
    canonicalJson({ e: [1, 2] }) !== canonicalJson({ e: [2, 1] }),
    "array order DOES change the bytes — in a tape, order is the data",
  );
}

// ── Result ──────────────────────────────────────────────────────────────────

function structuredCloneCompat(value) {
  return JSON.parse(JSON.stringify(value));
}

console.log(`\n${passed} passed, ${failures.length} failed · clock ${SIM_DATE}\n`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
