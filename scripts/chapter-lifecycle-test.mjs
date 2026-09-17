#!/usr/bin/env node
/**
 * Enterprise registration and deletion exercise real route/module code with
 * in-memory database and Stripe boundaries. No account, mail, or subscription
 * can be changed by this harness. SQL locking, RLS and tombstone behaviour
 * are checked separately by the database suite; these cases cover the HTTP
 * ownership/confirmation gate, payment-failure ordering and metadata contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function load(file, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports, console, process, URL, Date, ...globals,
    require(id) {
      if (id === "server-only") return {};
      assert.ok(id in dependencies, `unexpected external dependency ${id}`);
      return dependencies[id];
    },
  }, { filename: file });
  return exports;
}
let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const profile = load("lib/chapter/profile.ts");
const basic = {
  name: "School Enterprise", organizationType: "school",
  contactName: "School Owner", contactEmail: "owner@example.com",
};
await check("registration normalizes names and contact email", () => {
  assert.deepEqual(plain(profile.validateChapterProfile({ ...basic,
    name: " School Enterprise ", contactEmail: " OWNER@EXAMPLE.COM " })), { ok: true, profile: basic });
});
await check("missing, oversized and invalid basic fields are refused", () => {
  for (const invalid of [null, [], {}, { ...basic, name: " " }, { ...basic, name: "n".repeat(101) },
    { ...basic, name: "name\nother" }, { ...basic, organizationType: "unsupported" },
    { ...basic, contactName: "" }, { ...basic, contactEmail: "not-email" },
    { ...basic, contactEmail: "a".repeat(250) + "@test.com" }]) {
    assert.equal(profile.validateChapterProfile(invalid).ok, false);
  }
});
await check("checkout metadata round-trips and old subscriptions require setup", () => {
  assert.deepEqual(plain(profile.chapterProfileFromMetadata(profile.chapterProfileMetadata(basic))), basic);
  assert.equal(profile.chapterProfileFromMetadata({}), null);
  assert.equal(profile.chapterProfileFromMetadata({ chapter_name: "Only a name" }), null);
});

let processor;
const chapterModule = load("lib/stripe/chapter.ts", {
  "@/lib/monetization": { CHAPTER_CUSTOM_MAX_SEATS: 10000,
    CHAPTER_LICENCES: [{ id: "chapter_35", seats: 35 }, { id: "chapter_100", seats: 100 }] },
  "@/lib/chapter/profile": profile,
  "./catalogue": { CATALOGUE: { chapter_35: { id: "chapter_35" }, chapter_100: { id: "chapter_100" } },
    isChapterSku: (id) => id === "chapter_35" || id === "chapter_100",
    isSkuId: (id) => ["chapter_35", "chapter_100", "pro_yearly"].includes(id) },
  "./prices": { resolvePrice: async (sku) => ({ ok: true, priceId: `price_${sku.id}` }) },
  "./subscription": { grantsAccess: (status) => ["active", "trialing", "past_due"].includes(status),
    periodEnd: () => "2027-09-17T00:00:00.000Z" },
  "./client": { stripe: () => { assert.ok(processor, "processor must be configured"); return processor; } },
});
await check("custom subscriptions above retired 500-seat cap keep their purchased size", async () => {
  const sub = { id: "sub_custom", metadata: { novus_sku: "chapter_custom", seats: "10000" }, items: { data: [] } };
  assert.deepEqual(plain(await chapterModule.chapterFromSubscription(sub)), { licence: "chapter_custom", seats: 10000 });
  sub.metadata.seats = "10001";
  await assert.rejects(() => chapterModule.chapterFromSubscription(sub), /unusable seats/);
});
await check("portal plan changes use current prices instead of the original checkout tier", async () => {
  const sub = { id: "sub_switched", metadata: { sku: "chapter_35" },
    items: { data: [{ price: { id: "price_chapter_100" } }] } };
  assert.deepEqual(plain(await chapterModule.chapterFromSubscription(sub, { sku: "chapter_35" })),
    { licence: "chapter_100", seats: 100 });
  sub.metadata = { sku: "chapter_custom", seats: "800" };
  assert.deepEqual(plain(await chapterModule.chapterFromSubscription(sub, { sku: "chapter_custom", seats: "400" })),
    { licence: "chapter_custom", seats: 800 });
});
await check("webhook sync uses one atomic RPC with subscription profile", async () => {
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push([name, args]); return { data: "chapter", error: null }; } };
  await chapterModule.syncChapter(db, "owner", {
    id: "sub_1", status: "active", metadata: profile.chapterProfileMetadata(basic),
  }, { licence: "chapter_35", seats: 35 });
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(calls[0]), ["sync_chapter_subscription", {
    p_owner: "owner", p_subscription: "sub_1", p_licence: "chapter_35", p_seats: 35,
    p_active: true, p_period_end: "2027-09-17T00:00:00.000Z",
    p_name: basic.name, p_organization_type: basic.organizationType,
    p_contact_name: basic.contactName, p_contact_email: basic.contactEmail,
  }]);
});
await check("deleted webhook tombstones are acknowledged, failed writes retry", async () => {
  const sub = { id: "sub_1", status: "canceled", metadata: {} };
  await chapterModule.syncChapter({ rpc: async () => ({ data: null, error: null }) }, "owner", sub,
    { licence: "chapter_35", seats: 35 });
  await assert.rejects(() => chapterModule.syncChapter({ rpc: async () => ({ error: { message: "offline" } }) },
    "owner", sub, { licence: "chapter_35", seats: 35 }), /offline/);
});
await check("comp enterprises need no payment processor to delete", async () => {
  processor = null;
  await chapterModule.cancelChapterSubscription(null);
});
await check("paused enterprise subscriptions are cancelled immediately without proration", async () => {
  const calls = [];
  processor = { subscriptions: {
    retrieve: async (id) => { calls.push(["retrieve", id]); return { status: "paused" }; },
    cancel: async (id, options) => calls.push(["cancel", id, options]),
  } };
  await chapterModule.cancelChapterSubscription("sub_selected");
  assert.deepEqual(plain(calls), [["retrieve", "sub_selected"],
    ["cancel", "sub_selected", { invoice_now: false, prorate: false }]]);
});
await check("cancelled subscriptions make a repeated deletion safe", async () => {
  processor = { subscriptions: { retrieve: async () => ({ status: "canceled" }),
    cancel: async () => assert.fail("already cancelled") } };
  await chapterModule.cancelChapterSubscription("sub_selected");
});
await check("a lost cancellation response is safe only after Stripe confirms cancellation", async () => {
  let reads = 0;
  processor = { subscriptions: { retrieve: async () => ({ status: ++reads === 1 ? "active" : "canceled" }),
    cancel: async () => { throw new Error("network response lost"); } } };
  await chapterModule.cancelChapterSubscription("sub_selected");
  processor.subscriptions.retrieve = async () => ({ status: "active" });
  await assert.rejects(() => chapterModule.cancelChapterSubscription("sub_selected"), /network response lost/);
});

const chapterId = "10000000-0000-4000-8000-000000000001";
let state;
function reset() {
  state = { crossSite: false, configured: true, key: "test-service-role", signedIn: true,
    owner: true, deleted: false, readError: null, cancelError: false, rpcError: false, updated: true,
    calls: [], filters: [] };
}
const next = { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } };
const session = { userId: "owner", anonymous: false, supabase: { from(table) {
  assert.equal(table, "chapters");
  const query = {
    select: () => query,
    eq: (column, value) => { state.filters.push([column, value]); return query; },
    maybeSingle: async () => ({ data: state.owner ? { id: chapterId, owner_profile_id: "owner",
      source: "stripe", stripe_subscription_id: "sub_selected", deleted_at: state.deleted ? "now" : null } : null,
    error: state.readError }),
  };
  return query;
} } };
const routes = load("app/api/chapter/route.ts", {
  "next/server": next,
  "@/lib/supabase/config": { configured: () => state.configured },
  "@/lib/supabase/route": { crossSite: () => state.crossSite,
    sessionFromRequest: async () => { state.calls.push("session"); return state.signedIn ? session : null; },
    withSession: (response, current) => ({ ...response, session: current?.userId ?? null }) },
  "@/lib/chapter/admin": {},
  "@/lib/chapter/profile": profile,
  "@/lib/admin/guard": { isUuid: (id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id) },
  "@/lib/stripe/config": { get SUPABASE_SERVICE_ROLE_KEY() { return state.key; } },
  "@/lib/stripe/chapter": { cancelChapterSubscription: async (id) => {
    state.calls.push(["cancel", id]); if (state.cancelError) throw new Error("payment unavailable");
  } },
  "@/lib/supabase/admin": { adminClient: () => ({
    rpc: async (name, args) => { state.calls.push([name, args]);
      return { data: true, error: state.rpcError ? { message: "database unavailable" } : null }; },
    from: (table) => {
      assert.equal(table, "chapters");
      const query = {
        update: (value) => { state.calls.push(["update", value]); return query; },
        eq: (column, value) => { state.filters.push([column, value]); return query; },
        is: (column, value) => { state.filters.push([column, value]); return query; },
        select: () => query,
        maybeSingle: async () => ({ data: state.updated ? { id: chapterId } : null, error: null }),
      };
      return query;
    },
  }) },
});
const request = (body = { chapterId, confirmation: "DELETE" }) => ({ json: async () => body });
await check("cross-site writes are refused before reading a session", async () => {
  reset(); state.crossSite = true;
  assert.equal((await routes.DELETE(request())).status, 403);
  assert.deepEqual(state.calls, []);
});
await check("signed-out, missing ownership and absent confirmation cannot cancel billing", async () => {
  for (const setup of [() => { state.signedIn = false; }, () => { state.owner = false; }]) {
    reset(); setup();
    const response = await routes.DELETE(request());
    assert.equal(response.status, 404);
    assert.deepEqual(state.calls, ["session"]);
  }
  reset();
  assert.equal((await routes.DELETE(request({ chapterId, confirmation: "wrong" }))).status, 400);
  assert.deepEqual(state.calls, ["session"]);
});
await check("malformed JSON and null payload return a recoverable request error", async () => {
  reset();
  assert.equal((await routes.PATCH({ json: async () => { throw new Error("bad json"); } })).status, 400);
  assert.equal((await routes.PATCH(request(null))).status, 400);
});
await check("delete checks exact owner and chapter, cancels first, then atomically deletes", async () => {
  reset();
  const response = await routes.DELETE(request());
  assert.equal(response.status, 200);
  assert.equal(response.session, "owner");
  assert.deepEqual(plain(state.filters), [["id", chapterId], ["owner_profile_id", "owner"]]);
  assert.deepEqual(plain(state.calls), ["session", ["cancel", "sub_selected"], ["delete_chapter", { p_chapter: chapterId }]]);
});
await check("failed cancellation preserves enterprise and returns the refreshed session", async () => {
  reset(); state.cancelError = true;
  const response = await routes.DELETE(request());
  assert.equal(response.status, 502);
  assert.equal(response.session, "owner");
  assert.equal(state.calls.length, 2);
});
await check("a post-cancellation database error can be retried to completion", async () => {
  reset(); state.rpcError = true;
  assert.equal((await routes.DELETE(request())).status, 503);
  state.rpcError = false;
  assert.equal((await routes.DELETE(request())).status, 200);
});
await check("a deleted enterprise is idempotent and cannot be edited", async () => {
  reset(); state.deleted = true;
  assert.equal((await routes.DELETE(request())).status, 200);
  assert.equal((await routes.PATCH(request({ chapterId, profile: basic }))).status, 404);
  assert.deepEqual(state.calls, ["session", "session"]);
});
await check("profile edits are normalized and constrained to a live owned chapter", async () => {
  reset();
  const response = await routes.PATCH(request({ chapterId, profile: { ...basic, contactEmail: "OWNER@EXAMPLE.COM" } }));
  assert.equal(response.status, 200);
  assert.deepEqual(plain(state.calls[1]), ["update", { name: basic.name, organization_type: basic.organizationType,
    contact_name: basic.contactName, contact_email: basic.contactEmail }]);
  assert.ok(state.filters.some(([key, value]) => key === "deleted_at" && value === null));
  state.updated = false;
  assert.equal((await routes.PATCH(request({ chapterId, profile: basic }))).status, 404);
});
// Authentication handoffs carry a selected licence, never contact information
// or a user-provided return URL, and are consumed before they navigate.
const handoffStorage = new Map();
const navigations = [];
const handoff = load("lib/cloud/pending-chapter.ts", {}, {
  sessionStorage: { setItem: (key, value) => handoffStorage.set(key, value),
    getItem: (key) => handoffStorage.get(key) ?? null, removeItem: (key) => handoffStorage.delete(key) },
  window: { location: { assign: (url) => navigations.push(url) } },
});
const handoffKey = "novus.pending-chapter";
await check("registration handoff persists only the selected licence and its age", () => {
  handoff.rememberPendingChapter("chapter_100");
  const saved = JSON.parse(handoffStorage.get(handoffKey));
  assert.deepEqual(Object.keys(saved).sort(), ["at", "sku"]);
  assert.equal(saved.sku, "chapter_100");
  assert.equal(typeof saved.at, "number");
});
await check("sign-in resumes the chosen enterprise licence exactly once", () => {
  assert.equal(handoff.resumePendingChapter(), true);
  assert.equal(navigations.at(-1), "/chapter/new?sku=chapter_100");
  assert.equal(handoff.resumePendingChapter(), false);
});
await check("malformed, expired, future and external-URL handoffs never navigate", () => {
  const before = navigations.length;
  for (const raw of ["{", "null", "[]", JSON.stringify({ sku: "https://example.com", at: Date.now() }),
    JSON.stringify({ sku: "chapter_35", at: Date.now() - 3600001 }),
    JSON.stringify({ sku: "chapter_35", at: Date.now() + 100000 }),
    JSON.stringify({ sku: "chapter_35", at: "now" })]) {
    handoffStorage.set(handoffKey, raw);
    assert.equal(handoff.resumePendingChapter(), false);
    assert.equal(handoffStorage.has(handoffKey), false);
  }
  assert.equal(navigations.length, before);
});
await check("a cancelled registration clears the pending sign-in handoff", () => {
  handoff.rememberPendingChapter("chapter_35");
  handoff.clearPendingChapter();
  assert.equal(handoff.resumePendingChapter(), false);
});
await check("blocked browser storage leaves ordinary sign-in available", () => {
  const blocked = () => { throw new Error("storage blocked"); };
  const unavailable = load("lib/cloud/pending-chapter.ts", {}, {
    sessionStorage: { setItem: blocked, getItem: blocked, removeItem: blocked },
  });
  unavailable.rememberPendingChapter("chapter_35");
  unavailable.clearPendingChapter();
  assert.equal(unavailable.resumePendingChapter(), false);
});
console.log(`\n${passed} enterprise lifecycle checks passed.`);
