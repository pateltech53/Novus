#!/usr/bin/env node
// Existing Pro access must work in native apps; only payment actions are blocked.
import assert from "node:assert/strict";
import { register } from "node:module";
register("./ts-loader.mjs", import.meta.url);

class Storage {
  values = new Map();
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}
globalThis.localStorage = new Storage();
globalThis.sessionStorage = new Storage();
globalThis.document = { addEventListener() {}, removeEventListener() {} };
globalThis.window = {
  localStorage, sessionStorage, addEventListener() {}, removeEventListener() {},
  dispatchEvent() {}, setTimeout, clearTimeout,
  location: { pathname: "/play", href: "/play", assign(url) { this.href = url; } },
};
const { Capacitor } = await import("@capacitor/core");
let shell = "ios";
Capacitor.getPlatform = () => shell;
Capacitor.isNativePlatform = () => shell !== "web";
const m = await import("../lib/monetization.ts");
const save = await import("../lib/engine/save.ts");
const billing = await import("../lib/cloud/billing.ts");
const pending = await import("../lib/cloud/pending-pro.ts");
const chapters = await import("../lib/cloud/pending-chapter.ts");
const { INDUSTRIES } = await import("../lib/engine/constants.ts");
const paidIndustry = INDUSTRIES.find((i) => !i.free).code;
const account = { ...m.NO_ENTITLEMENTS, pro: true, extraIslands: 3,
  extraYearCloses: 4, industryPacks: [paidIndustry], intent: "pro_yearly" };
billing.adoptEntitlements(account);
const originalAccount = JSON.stringify(m.loadEntitlements());
assert.equal(m.isPro(account), true, "existing Pro works on iOS");
assert.deepEqual(m.limitsFor(account), m.PRO_LIMITS);
assert.equal(m.islandCapFor(account), m.PRO_LIMITS.islands + 3);
assert.equal(m.yearClosesFor(account), m.PRO_LIMITS.yearClosesPerDay + 4);
assert.equal(m.industryUnlocked(paidIndustry, account), true);
assert.equal(m.industryUnlocked(paidIndustry, { ...m.NO_ENTITLEMENTS, industryPacks: [paidIndustry] }), true);
assert.equal(m.isPro({ ...m.NO_ENTITLEMENTS, chapter: "existing-chapter" }), true);
assert.deepEqual(m.limitsFor({ ...m.NO_ENTITLEMENTS, admin: true }), m.ADMIN_LIMITS);

const company = (id, fields = {}) => ({
  id, seed: 7, companyName: id, founderName: "Test", industry: paidIndustry, pro: true,
  year: 1, month: 1, stage: 1, alive: true, flags: {}, log: [],
  stats: { valuation: 1000, cash: 1000, revenueAnnual: 0, employees: 0 }, ...fields,
});
for (let slot = 0; slot < 3; slot++) { save.saveRun(company(`Paid ${slot}`), slot); save.flushRun(); }
assert.equal(save.listIslands().length, 3, "more than two paid companies remain available");
assert.equal(save.slotForNewCompany(m.islandCapFor(account)), 3, "Pro can found beyond the free cap");
const state = save.loadRun(2);
save.saveRun({ ...state, month: 7 }, 2);
save.flushRun();
assert.equal(save.loadRun(2).month, 7, "paid gameplay can save");
assert.equal(save.loadRun(2).pro, true);
assert.equal(save.loadRun(2).industry, paidIndustry);
save.saveTable({ runId: state.id, year: 1, month: 7, cards: [], marketId: null, yearEnd: null }, 2);
assert.ok(localStorage.getItem("novus:table:v1:2"), "paid decision tables can persist");
save.saveTable(null, 2);
assert.equal(localStorage.getItem("novus:table:v1:2"), null, "completed decisions can clear");
m.recordPlanIntent("free");
assert.equal(JSON.stringify(m.loadEntitlements()), originalAccount, "onboarding cannot replace a subscriber's plan");

const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return { ok: true, json: async () => url.endsWith("/entitlements")
    ? { configured: true, signedIn: true, entitlements: account }
    : { url: "https://checkout.stripe.test/session" } };
};
for (const platform of ["ios", "android"]) {
  shell = platform;
  for (const sku of ["pro_monthly", "pro_yearly", "industry_pack", "extra_island", "chapter_35"]) {
    assert.equal((await billing.startCheckout(sku)).reason, "not-supported");
    assert.equal((await billing.goToCheckout(sku)).reason, "not-supported");
  }
  assert.equal(await billing.openBillingPortal(), false);
  pending.rememberPendingPro("pro_yearly");
  assert.equal(await pending.resumePendingPro(), false);
  chapters.rememberPendingChapter("chapter_35");
  assert.equal(chapters.resumePendingChapter(), false);
}
assert.equal(requests.length, 0, "native payments make no request");
assert.equal(window.location.href, "/play");
assert.equal(sessionStorage.getItem("novus:pending-pro"), null);
assert.equal(sessionStorage.getItem("novus.pending-chapter"), null);

shell = "ios";
billing.adoptEntitlements(m.NO_ENTITLEMENTS);
m.grantProLocally("pro_yearly");
assert.equal(m.isPro(m.loadEntitlements()), false, "blocked native checkout cannot grant Pro for free");
assert.deepEqual(m.limitsFor(m.loadEntitlements()), m.FREE_LIMITS);
assert.equal(m.industryUnlocked(paidIndustry, m.loadEntitlements()), false);
assert.equal((await billing.restorePurchases()).ok, true, "account refresh still works on iOS");
assert.equal(requests.at(-1).options.method ?? "GET", "GET");
assert.ok(requests.at(-1).url.endsWith("/api/billing/entitlements"));
assert.equal(JSON.stringify(m.loadEntitlements()), originalAccount);
assert.equal(m.isPro(m.loadEntitlements()), true);

shell = "web";
assert.equal((await billing.goToCheckout("pro_monthly")).ok, true);
assert.equal(requests.at(-1).url, "/api/billing/checkout");
assert.equal(window.location.href, "https://checkout.stripe.test/session");
console.log("✓ Native Pro/paid saves/extra slots, account refresh, payment refusal, and web checkout");
