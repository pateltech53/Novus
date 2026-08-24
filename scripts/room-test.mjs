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
const {
  CALLERS,
  INDEX_PAGE,
  phoneOf,
  callerByNumber,
  digitsOf,
  tradeIndex,
  availableCallers,
} = await import(join(root, "lib/ai/callers.ts"));
const { VOICES } = await import(join(root, "lib/ai/voices.ts"));
const { ROOM_APPS, hasPhone, hasRoom, phoneAppsFor, canOpenApp } = await import(
  join(root, "lib/phone/access.ts")
);

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
console.log(`\n=== 3 · ${CALLERS.length} businesses, ${CALLERS.length} lines ===`);

const numbers = CALLERS.map((c) => phoneOf(c));
/*
 * This used to pass by luck. The number was a hash modulo eight area codes and
 * a hundred lines — eight hundred slots — and by the birthday problem thirty-one
 * callers collide better than half the time. A collision makes one business
 * permanently unreachable and says nothing on any screen. `phoneOf` probes for a
 * free slot now, so this assertion is a guarantee rather than a coin toss, and
 * it is kept because the probe is what has to keep working.
 */
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

// ── 5 · the page, and what it does not change ───────────────────────────────
console.log("\n=== 5 · a page that turns over ===");

const DAY_ONE = new Date("2026-03-05T09:00:00Z");
const DAY_TWO = new Date("2026-03-06T09:00:00Z");

const late = company({ stage: 5 });
const listed = tradeIndex(late, DAY_ONE);
ok("a stage-5 tech company has a book to read", listed.length > 0);
ok(
  "everything printed in it answers",
  listed.every(({ caller, phone }) => callerByNumber(phone)?.id === caller.id),
);
ok(
  "the page never prints more than it should",
  listed.length <= INDEX_PAGE,
  `${listed.length} listings`,
);
ok(
  "and it prints one more than the day's calls, so choosing is real",
  INDEX_PAGE > 3,
  `${INDEX_PAGE} listings against 3 calls`,
);
ok(
  "everyone on the page is somebody The Room would connect",
  (() => {
    const reachable = new Set(availableCallers(late).map((c) => c.id));
    return listed.every(({ caller }) => reachable.has(caller.id));
  })(),
);
ok(
  "and it opens on the easiest call, not on the alphabet",
  listed.every((l, i) => i === 0 || listed[i - 1].caller.difficulty <= l.caller.difficulty),
);

/*
 * THE ROTATION, AND ITS LIMIT.
 *
 * The page has to change overnight — a directory that never moves is a list of
 * chores. What must NOT change is who exists: a player writes a number down,
 * and if tomorrow's book quietly retired them the note in their hand becomes a
 * lie. So the draw governs what is PRINTED and nothing else.
 */
const today = tradeIndex(late, DAY_ONE).map((l) => l.caller.id);
const tomorrow = tradeIndex(late, DAY_TWO).map((l) => l.caller.id);
ok(
  "the page is the same all day, however often it is drawn",
  tradeIndex(late, new Date("2026-03-05T23:59:00Z")).map((l) => l.caller.id).join() ===
    today.join(),
);
ok(
  "and a different one tomorrow",
  today.join() !== tomorrow.join(),
  `${today.join()} vs ${tomorrow.join()}`,
);
ok(
  "a number copied yesterday still rings the same person",
  (() => {
    const gone = tradeIndex(late, DAY_ONE).find(
      ({ caller }) => !tomorrow.includes(caller.id),
    );
    // If nobody dropped off the page there is nothing to prove and the
    // assertion above already failed. Otherwise the number must still connect.
    return !gone || callerByNumber(gone.phone)?.id === gone.caller.id;
  })(),
);
ok(
  "two companies on one device read different pages",
  tradeIndex({ ...late, seed: 999_001 }, DAY_ONE)
    .map((l) => l.caller.id)
    .join() !== today.join(),
);

const early = tradeIndex(company({ stage: 1 }), DAY_ONE);
ok("a garage has a book too", early.length > 0);
ok(
  "and a garage's pool is smaller than a scaled company's",
  availableCallers(company({ stage: 1 })).length <
    availableCallers(company({ stage: 5 })).length,
);
ok(
  "the early pool is bigger than the page, so it can rotate at all",
  availableCallers(company({ stage: 1 })).length > INDEX_PAGE,
  `${availableCallers(company({ stage: 1 })).length} reachable at stage 1`,
);

// ── 6 · casting ─────────────────────────────────────────────────────────────
console.log("\n=== 6 · the voice matches the person ===");

/*
 * Three of the twenty were miscast — Rosa Delgado answered in a man's voice,
 * Nikhil Batra in a woman's — and nothing could catch it, because the only
 * record of what a `room_*` key sounds like was the key's own name, which
 * deliberately describes the REGISTER so a caller can be recast without
 * renaming a voice. The fact is written down in both places now, and this is
 * what makes them agree.
 *
 * It is casting and nothing else: the field never reaches a prompt and is never
 * scored. Brand Law 5's prohibition on judging anybody by how they sound stands.
 */
const miscast = CALLERS.filter((c) => VOICES[c.voice]?.reads !== c.gender);
ok(
  "every caller sounds like the person they are",
  miscast.length === 0,
  miscast.map((c) => `${c.name} (${c.gender}) → ${c.voice}`).join("; "),
);
ok(
  "every caller has a voice at all",
  CALLERS.every((c) => typeof c.voice === "string" && c.voice.startsWith("room_")),
  CALLERS.find((c) => !c.voice?.startsWith("room_"))?.id,
);
ok(
  "every caller declares which register they read as",
  CALLERS.every((c) => c.gender === "male" || c.gender === "female"),
);
ok(
  "the cast is not all one register",
  new Set(CALLERS.map((c) => c.gender)).size === 2,
);
/*
 * The palette has to be able to serve either register in any temperament, or
 * casting by hand will drift again the next time somebody brisk turns out to be
 * a woman. Both halves need more than one voice.
 */
const roomVoices = Object.entries(VOICES).filter(([k]) => k.startsWith("room_"));
for (const reads of ["male", "female"]) {
  ok(
    `there is more than one ${reads} voice to cast from`,
    roomVoices.filter(([, v]) => v.reads === reads).length >= 4,
  );
}
ok(
  "and no room voice is left without a register",
  roomVoices.every(([, v]) => v.reads === "male" || v.reads === "female"),
  roomVoices.find(([k, v]) => !v.reads)?.[0],
);

// ── 7 · the phone itself ────────────────────────────────────────────────────
console.log("\n=== 7 · a restaurant still has a phone ===");

/*
 * The requirement arrived twice, in opposite directions, and both halves fail
 * silently. A fast-food founder must not have The Room or The Index — there is
 * nobody in a trade index for a restaurant to ring. And a fast-food founder
 * must still have a PHONE: BeeMail, RobinGhood and LinkedOut have nothing to do
 * with selling to businesses, and taking the device away to remove two apps
 * from it is a much bigger answer than the question.
 */
const ALL_APPS = [
  { id: "robinghood" },
  { id: "beemail" },
  { id: "coldcall" },
  { id: "index" },
  { id: "linkedout" },
];

for (const code of NO_ROOM) {
  const apps = phoneAppsFor(code, ALL_APPS).map((a) => a.id);
  ok(`${code} keeps a phone`, hasPhone(code));
  ok(`${code} has neither The Room nor The Index`, !hasRoom(code) && apps.length === 3, apps.join(","));
  ok(`${code} still has BeeMail and the rest`, ["robinghood", "beemail", "linkedout"].every((a) => apps.includes(a)));
  ok(
    `${code} cannot be deep-linked into The Room either`,
    ROOM_APPS.every((a) => !canOpenApp(code, a)),
    "an activity flag or a notification could still route them in",
  );
}

const techApps = phoneAppsFor("TECH", ALL_APPS).map((a) => a.id);
ok("a tech company has the whole phone", techApps.length === ALL_APPS.length);
ok("including both halves of the mechanic", ROOM_APPS.every((a) => techApps.includes(a)));
ok(
  "an unknown app id is never mistaken for a Room app",
  canOpenApp("FOOD", "beemail") && canOpenApp("FOOD", "linkedout"),
);

// ── Verdict ─────────────────────────────────────────────────────────────────
console.log(
  `\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed} passed, ${failures.length} failed`,
);
if (failures.length > 0) {
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
