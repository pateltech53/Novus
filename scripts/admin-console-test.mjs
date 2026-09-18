#!/usr/bin/env node
/** HTTP-boundary regression checks for the operator workspaces. SQL suites
 * independently exercise the real views and client-role denial. These tests
 * run actual route bodies with only database/auth boundaries substituted. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const root = new URL("../", import.meta.url);
const load = (file, deps) => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(new URL(file, root), "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      console,
      URLSearchParams,
      Date,
      Map,
      require(id) {
        assert.ok(id in deps, `Unexpected dependency ${id}`);
        return deps[id];
      },
    },
  );
  return exports;
};
class NextResponse extends Response {
  static json(body, options) {
    return new NextResponse(JSON.stringify(body), options);
  }
}
let calls, allowed, handler;
const reset = () => {
  calls = [];
  allowed = true;
  handler = () => ({ data: [], count: 0, error: null });
};
const db = {
  from(table) {
    const log = { table, methods: [] };
    calls.push(log);
    const query = {
      then(yes, no) {
        return Promise.resolve(handler(log)).then(yes, no);
      },
    };
    for (const method of [
      "select",
      "eq",
      "or",
      "gt",
      "gte",
      "lt",
      "lte",
      "not",
      "in",
      "is",
      "ilike",
      "order",
      "range",
      "limit",
      "maybeSingle",
    ])
      query[method] = (...args) => {
        log.methods.push([method, ...args]);
        return query;
      };
    return query;
  },
};
const guard = {
  adminGate: async () =>
    allowed
      ? { ok: true, session: { id: "operator" } }
      : { ok: false, res: NextResponse.json({ ok: false }, { status: 404 }) },
  isUuid: (value) =>
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value),
  audit: async () => {},
};
const session = {
  withSession: (response) => {
    response.headers.set("x-session-refreshed", "true");
    return response;
  },
  crossSite: () => false,
};
const base = {
  "next/server": { NextResponse },
  "@/lib/admin/guard": guard,
  "@/lib/supabase/admin": { adminClient: () => db },
  "@/lib/supabase/route": session,
};
const directory = load("lib/admin/directory.ts", {
  "server-only": {},
  "@/lib/admin/guard": guard,
  "@/lib/supabase/admin": base["@/lib/supabase/admin"],
});
const users = load("app/api/admin/users/route.ts", {
  ...base,
  "@/lib/admin/directory": directory,
});
const audit = load("app/api/admin/audit/route.ts", {
  ...base,
  "@/lib/admin/directory": directory,
});
const roster = load("app/api/admin/chapters/[id]/route.ts", {
  ...base,
  "@/lib/admin/directory": directory,
});
const chapters = load("app/api/admin/chapters/route.ts", {
  ...base,
  "@/lib/admin/directory": directory,
  "@/lib/monetization": { CHAPTER_LICENCES: [] },
  "@/lib/chapter/profile": {},
});
const analytics = load("lib/admin/analytics.ts", {});
const request = (query = "") => ({
  nextUrl: new URL(`http://local.test/?${query}`),
});
const context = {
  params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000001" }),
};
let passed = 0;
const check = async (name, fn) => {
  reset();
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};
await check("all workspace GETs deny before reading data", async () => {
  allowed = false;
  for (const route of [users, audit, chapters, roster])
    assert.equal((await route.GET(request(), context)).status, 404);
  assert.equal(calls.length, 0);
});
await check(
  "directory combines filters before paging and uses a stable tie-break",
  async () => {
    const response = await users.GET(
      request("filters=paid,playing&sort=value&offset=100&limit=50"),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-session-refreshed"), "true");
    assert.equal(response.headers.get("cache-control"), "no-store");
    const m = calls[0].methods;
    assert.ok(m.some((x) => x[0] === "eq" && x[1] === "paid" && x[2] === true));
    assert.ok(m.some((x) => x[0] === "gt" && x[1] === "companies_alive"));
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(m.slice(-2).map((x) => Array.from(x).slice(0, 3))),
      ),
      [
        ["order", "id", { ascending: true }],
        ["range", 100, 149],
      ],
    );
  },
);
await check(
  "invalid filters, sorting and non-finite pages fail with session rotation",
  async () => {
    for (const q of [
      "filters=unknown",
      "sort=drop",
      "sort=toString",
      "sort=__proto__",
      "offset=Infinity",
      "offset=-1",
      "limit=NaN",
      "offset=1.5",
    ]) {
      const r = await users.GET(request(q));
      assert.equal(r.status, 400);
      assert.equal(r.headers.get("x-session-refreshed"), "true");
    }
  },
);
await check(
  "search punctuation remains inside quoted filter literals",
  async () => {
    await users.GET(
      request(new URLSearchParams({ q: 'x),role.eq.admin,"\\%_' }).toString()),
    );
    const pattern = calls[0].methods.find((x) => x[0] === "or")[1];
    assert.ok(pattern.includes('email.ilike."%x),role.eq.admin,\\"'));
    assert.ok(pattern.includes("\\%\\_"));
  },
);
const row = {
  id: "user",
  email: '=HYPERLINK("bad")',
  display_name: 'Comma, "name"',
  role: "player",
  industry_packs: [],
  total: 1103,
};
await check(
  "export includes subsequent pages and ignores the interactive offset",
  async () => {
    handler = (log) => {
      const [_, start, end] = log.methods.find((x) => x[0] === "range");
      return {
        data: Array.from(
          { length: Math.min(end + 1, 1103) - start },
          () => row,
        ),
        count: 1103,
        error: null,
      };
    };
    const response = await users.GET(
      request("format=csv&offset=100&filters=paid"),
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.equal(text.trim().split("\n").length, 1104);
    assert.ok(text.includes("\"'=HYPERLINK"));
    assert.ok(text.includes('Comma, ""name""'));
    assert.equal(calls.length, 2);
    assert.ok(
      calls.every((c) =>
        c.methods.some((m) => m[0] === "eq" && m[1] === "paid"),
      ),
    );
  },
);
await check(
  "exports respect a database row cap smaller than the requested batch",
  async () => {
    handler = (log) => {
      const [_, start, end] = log.methods.find((x) => x[0] === "range");
      return {
        data: Array.from(
          { length: Math.min(end + 1, start + 500, 1103) - start },
          () => row,
        ),
        count: 1103,
        error: null,
      };
    };
    const response = await users.GET(request("format=csv"));
    assert.equal(response.status, 200);
    assert.equal((await response.text()).trim().split("\n").length, 1104);
    assert.equal(calls.length, 3);
  },
);
await check(
  "oversized or interrupted exports return an error, never a partial CSV",
  async () => {
    handler = () => ({ data: [row], count: 10001, error: null });
    assert.equal((await users.GET(request("format=csv"))).status, 413);
    reset();
    handler = () =>
      calls.length === 1
        ? { data: Array(1000).fill(row), count: 1103, error: null }
        : { data: null, error: { message: "offline" } };
    const r = await users.GET(request("format=csv"));
    assert.equal(r.status, 503);
    assert.equal(r.headers.get("x-session-refreshed"), "true");
  },
);
await check(
  "directory and audit failures are not empty success states",
  async () => {
    handler = () => ({
      data: null,
      count: null,
      error: { message: "unavailable" },
    });
    for (const route of [users, audit, chapters])
      assert.equal((await route.GET(request())).status, 503);
  },
);
await check(
  "audit date filters include the whole end day in UTC and reject invalid dates",
  async () => {
    let r = await audit.GET(
      request("from=2026-09-01&to=2026-09-17&actor=operator&offset=50"),
    );
    assert.equal(r.status, 200);
    assert.ok(
      calls[0].methods.some(
        (m) => m[0] === "lt" && m[2] === "2026-09-18T00:00:00.000Z",
      ),
    );
    for (const q of [
      "from=2026-02-30",
      "from=nope",
      "from=2026-10-01&to=2026-09-01",
    ])
      assert.equal((await audit.GET(request(q))).status, 400);
  },
);
await check("enterprise status and source compose with paging", async () => {
  const r = await chapters.GET(
    request("status=expiring&source=comp&offset=50"),
  );
  assert.equal(r.status, 200);
  assert.ok(
    calls[0].methods.some(
      (m) => m[0] === "eq" && m[1] === "source" && m[2] === "comp",
    ),
  );
  assert.ok(
    calls[0].methods.some(
      (m) => m[0] === "gte" && m[1] === "current_period_end",
    ),
  );
});
await check(
  "roster excludes invite credentials and respects setup after re-invitation",
  async () => {
    handler = (log) =>
      log.table === "chapters"
        ? { data: { id: "chapter" }, error: null }
        : log.table === "chapter_seats"
          ? {
              data: [
                {
                  id: "seat",
                  profile_id: "member",
                  email: "member@example.test",
                  created_by_invite: false,
                  claimed_at: null,
                },
              ],
              error: null,
            }
          : {
              data: [{ profile_id: "member", completed_at: null }],
              error: null,
            };
    const r = await roster.GET(request(), context);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).rows[0].pending, true);
    assert.ok(
      !calls
        .find((c) => c.table === "chapter_seats")
        .methods.find((m) => m[0] === "select")[1]
        .includes("invite_token"),
    );
  },
);
await check(
  "missing enterprises and failed setup reads do not expose a roster",
  async () => {
    handler = () => ({ data: null, error: null });
    assert.equal((await roster.GET(request(), context)).status, 404);
    assert.equal(calls.length, 1);
    reset();
    handler = (log) =>
      log.table === "chapters"
        ? { data: { id: "chapter" }, error: null }
        : log.table === "chapter_seats"
          ? { data: [{ profile_id: "member" }], error: null }
          : { data: null, error: { message: "offline" } };
    assert.equal((await roster.GET(request(), context)).status, 503);
  },
);
await check(
  "retention windows distinguish ineligible cohorts, zero retention and UTC boundaries",
  async () => {
    const boundary = Date.parse("2026-09-15T00:00:00Z");
    assert.equal(
      analytics.cohortRate("2026-09-01", 10, 0, 7, boundary - 1),
      null,
    );
    assert.equal(analytics.cohortRate("2026-09-01", 10, 0, 7, boundary), 0);
    assert.equal(analytics.cohortRate("2026-09-01", 10, 4, 7, boundary), 40);
    assert.equal(analytics.cohortRate("2026-09-01", 0, 0, 7, boundary), null);
  },
);
console.log(`PASS — ${passed} admin workspace checks`);
