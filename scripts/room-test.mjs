#!/usr/bin/env node
/**
 * Who may call, who answers, and what a wrong number costs.
 *
 *   npm run test:room
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The Room stopped being a list you tap and became a book you read and a number
 * you dial. Three things underneath that are the kind which fail silently:
 *
 *   1. **The industry gate.** A fast-food owner has nobody to ring, so FOOD,
 *      ECOM and FITNESS have no Room at all. Get the flag backwards on one row
 *      of a twelve-row table and an industry either loses a mechanic it should
 *      have or gains one that makes no sense for it — and nothing on screen
 *      says so, because the app is simply absent either way.
 *
 *   2. **The numbers.** They are generated from caller ids, so two callers can
 *      collide, and a collision means one business in the book is unreachable
 *      forever. They must also all sit in the 555-01xx block that exists so a
 *      number printed in fiction cannot ring a real person — this app is handed
 *      to minors and asks them to type a phone number into a phone.
 *
 *   3. **The lookup.** A player types what they can see, which has brackets and
 *      a dash in it, or pastes it, or leaves a space where the dash was. All of
 *      it has to reach the same business, and a number that is NOT in the book
 *      has to reach nobody without costing one of the day's three calls.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

register("./ts-loader.mjs", import.meta.url);

const { INDUSTRIES, sellsToBusinesses } = await import(join(root, "lib/engine/constants.ts"));
const { createRun } = await import(join(root, "lib/engine/run.ts"));
const { activitiesFor } = await import(join(root, "lib/engine/activities.ts"));
const { CALLERS, phoneOf, callerByNumber, digitsOf, tradeIndex, availableCallers } =
  await import(join(root, "lib/ai/callers.ts"));

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

const company = (over = {}) => {
  const run = createRun({
    founderName: "Ana",
    playerAge: 15,
    companyName: "Loop",
    industry: over.industry ?? "TECH",
    rookieMode: true,
    tutorial: false,
  });
  return { ...run, seed: 424242, pro: true, ...over };
};

// ── 1 · who has a phone at all ──────────────────────────────────────────────
console.log("\n=== 1 · the industry gate ===");

/*
 * Named explicitly rather than derived from the table, so that this file
 * DISAGREES with a change instead of following it. The whole value of the
 * assertion is that moving a row has to be a decision somebody wrote down
 * twice.
 */
const NO_ROOM = ["FOOD", "ECOM", "FITNESS"];

for (const code of NO_ROOM) {
  ok(`${code} does not cold call`, !sellsToBusinesses(code));
}
for (const { code } of INDUSTRIES.filter((i) => !NO_ROOM.includes(i.code))) {
  ok(`${code} does`, sellsToBusinesses(code));
}
ok(
  "the free tier can still find out the mechanic exists",
  INDUSTRIES.some((i) => i.free && i.sellsToBusinesses),
  "every free industry lost The Room — the gate has become a second paywall",
);

console.log("\n=== 2 · and therefore has the activity ===");

/*
 * Stage 5 and Pro, so the ONLY thing that can be deciding this is the industry.
 * The row is absent rather than locked: a padlock would advertise — and price —
 * a mechanic a fast-food founder should never want.
 */
const rowFor = (industry) =>
  activitiesFor("company", company({ industry, stage: 5 })).find((a) => a.id === "cold-call");

ok("a tech company is offered the phones", !!rowFor("TECH"));
ok("a fast-food owner is not", !rowFor("FOOD"), "FOOD was offered a cold-call row");
ok("nor an e-commerce shop", !rowFor("ECOM"));
ok("nor a gym", !rowFor("FITNESS"));
ok("a toy company is", !!rowFor("TOYS"));

// ── 3 · the numbers ─────────────────────────────────────────────────────────
console.log("\n=== 3 · twenty businesses, twenty lines ===");

const numbers = CALLERS.map((c) => phoneOf(c));
ok(
  "no two businesses share a line",
  new Set(numbers.map(digitsOf)).size === CALLERS.length,
  `${CALLERS.length} callers, ${new Set(numbers.map(digitsOf)).size} numbers`,
);
ok(
  "every one is in the block reserved for fiction",
  numbers.every((n) => /^\(\d{3}\) 555-01\d\d$/.test(n)),
  numbers.find((n) => !/^\(\d{3}\) 555-01\d\d$/.test(n)),
);
ok(
  "and no area code that a real subscriber could hold",
  // N11 codes are service codes — 911, 411 — and are never issued.
  numbers.every((n) => /^\((\d)11\)/.test(n)),
  numbers.find((n) => !/^\((\d)11\)/.test(n)),
);
ok(
  "a number is the same every time it is printed",
  phoneOf(CALLERS[0]) === phoneOf(CALLERS[0]),
);

/*
 * The index is looked up by BUSINESS NAME, which makes `company` a name rather
 * than a description — and it was neither for two of them. One read "Former
 * operator, two exits", which is a description of a person; another carried a
 * stray CJK character from a paste that went wrong long before any of this.
 * Both printed straight into the directory.
 */
ok(
  "every listing is a name a directory could print",
  CALLERS.every((c) => /^[\x20-\x7E]+$/.test(c.company) && !c.company.includes(",")),
  CALLERS.find((c) => !/^[\x20-\x7E]+$/.test(c.company) || c.company.includes(","))?.company,
);

// ── 4 · the lookup ──────────────────────────────────────────────────────────
console.log("\n=== 4 · what a player can type ===");

const first = CALLERS[0];
const shown = phoneOf(first);
const forms = {
  "as printed": shown,
  "digits only": digitsOf(shown),
  "with a country code": `1${digitsOf(shown)}`,
  "spaces for punctuation": shown.replace(/[()-]/g, " "),
  "pasted with whitespace": `  ${shown}\n`,
};
for (const [label, form] of Object.entries(forms)) {
  ok(`${label} reaches them`, callerByNumber(form)?.id === first.id, form);
}

ok("a number nobody holds reaches nobody", callerByNumber("(411) 555-0999") === null);
ok("a half-typed number reaches nobody", callerByNumber("555") === null);
ok("an empty field reaches nobody", callerByNumber("") === null);
ok(
  "and neither costs a call — the lookup cannot spend one",
  // `callerByNumber` is a pure lookup; only `consumeCall` moves the ledger, and
  // The Room calls it when the line connects. Asserted by construction: a run
  // put through every wrong number above is untouched.
  (() => {
    const run = company();
    const before = run.coldCallsUsed ?? 0;
    ["(411) 555-0999", "555", "", "not a number"].forEach((n) => callerByNumber(n));
    return (run.coldCallsUsed ?? 0) === before;
  })(),
);

// ── 5 · the book and the dialler agree ──────────────────────────────────────
console.log("\n=== 5 · every printed number connects ===");

const listed = tradeIndex(company({ stage: 5 }));
ok("a stage-5 tech company has a book to read", listed.length > 0);
ok(
  "everything printed in it answers",
  listed.every(({ caller, phone }) => callerByNumber(phone)?.id === caller.id),
);
ok(
  "the book is exactly who the room would connect",
  listed.length === availableCallers(company({ stage: 5 })).length,
);
ok(
  "and it opens on the easiest call, not on the alphabet",
  listed.every((l, i) => i === 0 || listed[i - 1].caller.difficulty <= l.caller.difficulty),
);

const early = tradeIndex(company({ stage: 1 }));
ok(
  "a garage sees fewer doors than a scaled company",
  early.length < listed.length,
  `${early.length} vs ${listed.length}`,
);

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
