import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";
function load(file, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../" + file, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      Date,
      Set,
      Map,
      Number,
      Error,
      console,
      ...globals,
      require(id) {
        assert.ok(id in deps, `Unexpected dependency ${id}`);
        return deps[id];
      },
    },
  );
  return exports;
}
const { parseCompetition } = load("lib/competitions/rules.ts");
const spec = {
  title: "Class challenge",
  description: "",
  startsAt: "2030-01-01T00:00:00Z",
  endsAt: "2030-01-03T00:00:00Z",
  enrollment: "automatic",
  audience: "all",
  students: [],
  prizes: [{ place: 1, kind: "runs", quantity: 3, tier: null }],
};
assert.equal(parseCompetition(spec, 0).prizes[0].quantity, 3);
for (const patch of [
  { startsAt: "invalid" },
  { endsAt: spec.startsAt },
  { prizes: [...spec.prizes, ...spec.prizes] },
  { prizes: [{ place: 1, kind: "chest", quantity: 1, tier: 6 }] },
  { audience: "selected", students: [] },
  { enrollment: "forced" },
  { prizes: [{ place: 1, kind: "runs", quantity: -1 }] },
])
  assert.throws(() => parseCompetition({ ...spec, ...patch }, 0));
let session = { userId: "student" },
  start,
  eligible,
  verification,
  writes,
  calls;
class NextResponse {
  constructor(body, status = 200) {
    this.body = body;
    this.status = status;
  }
}
const reset = () => {
  start = {
    industry: "FOOD",
    tutorial: false,
    pro: true,
    started_at: "2026-01-01T00:00:00Z",
  };
  eligible = 1;
  verification = {
    status: "verified",
    peakValuation: 12345,
    tapeHash: "server-hash",
  };
  writes = [];
  calls = 0;
};
const db = {
  from() {
    const q = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      async maybeSingle() {
        return { data: start };
      },
    };
    return q;
  },
  async rpc(name, args) {
    if (name === "company_competition_count") return { data: eligible };
    if (name === "claim_auth_attempt") return { data: true };
    writes.push({ name, args });
    return { data: 1 };
  },
};
const score = load("app/api/competitions/score/route.ts", {
  "next/server": { NextResponse },
  "@/lib/competitions/server": {
    account: async () => session,
    answer: (_s, b, status) => new NextResponse(b, status),
  },
  "@/lib/supabase/admin": { adminClient: () => db },
  "@/lib/leaderboard/verify": {
    parseTape: (t) => (t?.entries ? t : null),
    verifyTape: () => {
      calls++;
      return verification;
    },
  },
  "@/lib/leaderboard/moderation": {
    moderateCompanyName: () => ({ verdict: "allow" }),
  },
});
const tape = {
  seed: 123,
  industry: "FOOD",
  tutorial: false,
  companyName: "NewCo",
  entries: [{ t: "advance", atISO: "2026-01-01" }],
};
const req = (body = { tape, peak: 999999, years: 1 }) => ({
  headers: new Headers(),
  json: async () => body,
});
reset();
start = null;
assert.equal((await score.POST(req())).body.count, 0);
assert.equal(calls, 0);
reset();
eligible = 0;
assert.equal((await score.POST(req())).body.count, 0);
assert.equal(calls, 0);
reset();
start.industry = "TECH";
assert.equal((await score.POST(req())).status, 422);
assert.equal(calls, 0);
reset();
assert.equal(
  (
    await score.POST(
      req({
        tape: { ...tape, entries: [{ t: "advance", atISO: "2025-12-31" }] },
      }),
    )
  ).status,
  422,
);
reset();
start.pro = false;
assert.equal(
  (
    await score.POST(
      req({ tape: { ...tape, entries: [{ t: "pro", on: true }] } }),
    )
  ).status,
  422,
);
reset();
verification.status = "flagged";
assert.equal((await score.POST(req())).status, 422);
assert.equal(writes.length, 0);
reset();
assert.equal((await score.POST(req())).status, 200);
assert.equal(writes[0].args.p_peak, 12345);
assert.equal(writes[0].args.p_hash, "server-hash");
assert.equal(writes[0].args.p_profile, "student");
console.log(
  "PASS competition form validation and score authority (15 scenarios)",
);

// Navigation creates a fresh module queue. Each company must use its own saved
// tape, including when another island is active or a saved tape is missing.
const sent = [];
let responseStatus = 200;
const client = load(
  "lib/competitions/client.ts",
  {
    "@/lib/native/origin": { apiUrl: (p) => p, API_CREDENTIALS: "include" },
    "@/lib/monetization": {},
    "@/lib/engine/save": {
      listIslands: () => [{ slot: 0 }, { slot: 1 }, { slot: 2 }],
      activeIsland: () => 1,
      loadRun: (slot) => ({
        id: String(slot),
        seed: slot,
        stats: { valuation: 10 },
        year: 1,
        alive: true,
      }),
    },
    "@/lib/leaderboard/recorder": {
      buildTape: (run, slot) => {
        assert.equal(
          slot,
          run.seed,
          "Each saved company must read its own slot",
        );
        return slot === 2 ? null : { seed: slot, entries: [] };
      },
    },
  },
  {
    fetch: async (_url, options) => {
      sent.push(JSON.parse(options.body).tape.seed);
      return {
        ok: responseStatus === 200,
        status: responseStatus,
        json: async () =>
          responseStatus === 200
            ? { ok: true, count: 1 }
            : { error: "Invalid tape" },
      };
    },
    AbortSignal,
    CustomEvent,
    window: { addEventListener() {}, dispatchEvent() {} },
    document: { addEventListener() {} },
    setTimeout: () => 1,
  },
);
assert.equal(await client.syncSavedCompetitionScores(), 2);
await client.flushCompetitionScore();
assert.deepEqual(sent, [1, 0]);
assert.equal(await client.syncSavedCompetitionScores(), 0);
responseStatus = 422;
client.queueCompetitionScore(
  { id: "invalid", stats: { valuation: 10 }, year: 1, alive: true },
  { seed: 3, entries: [] },
);
await client.flushCompetitionScore();
await client.flushCompetitionScore();
assert.deepEqual(sent, [1, 0, 3], "Permanent rejection must not retry forever");
console.log(
  "PASS saved-island score sync, empty tapes, deduplication and permanent rejection",
);
