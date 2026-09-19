#!/usr/bin/env node
// Exercise account entitlement projection, protected saves, and billing entry points.
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
let shell = "web";
Capacitor.getPlatform = () => shell;
Capacitor.isNativePlatform = () => shell !== "web";
const m = await import("../lib/monetization.ts");
const save = await import("../lib/engine/save.ts");
const billing = await import("../lib/cloud/billing.ts");
const pending = await import("../lib/cloud/pending-pro.ts");
const chapters = await import("../lib/cloud/pending-chapter.ts");
const { ASSET_CATALOG } = await import("../lib/engine/holdings.ts");
const { INDUSTRIES } = await import("../lib/engine/constants.ts");
const premiumIndustry = INDUSTRIES.find((i) => !i.free).code;
const account = { ...m.NO_ENTITLEMENTS, pro: true, extraIslands: 3,
  extraYearCloses: 4, industryPacks: [premiumIndustry], intent: "pro_yearly", admin: true };
billing.adoptEntitlements(account);
const originalAccount = JSON.stringify(m.loadEntitlements());
const company = (id, fields = {}) => ({
  id, seed: 7, companyName: id, founderName: "Test", industry: "FOOD", pro: false,
  year: 1, month: 1, stage: 1, alive: true, flags: {}, log: [],
  stats: { valuation: 1000, cash: 1000, revenueAnnual: 0, employees: 0 }, ...fields,
});
for (const [slot, run] of [
  [0, company("Paid", { pro: true })], [1, company("Basic one")],
  [2, company("Basic two")], [3, company("Extra slot")],
  [4, company("Paid industry", { industry: premiumIndustry })],
  [5, company("Past purchase", { holdings: [{ defId: ASSET_CATALOG.find((a) => a.pro).id }] })],
  [6, company("Past hire", { roster: [{ id: "emp-0-cand-1-1-4" }] })],
]) { save.saveRun(run, slot); save.flushRun(); }
localStorage.setItem("novus:table:v1:0", JSON.stringify({ cards: ["pending"] }));
const protectedRun = localStorage.getItem("novus:run:v1:0");
const protectedTable = localStorage.getItem("novus:table:v1:0");

shell = "ios";
assert.equal(m.isPro(account), false);
assert.deepEqual(m.limitsFor(account), m.FREE_LIMITS);
assert.equal(m.islandCapFor(account), 2);
assert.equal(m.yearClosesFor(account), 1);
assert.equal(m.industryUnlocked(premiumIndustry, account), false);
assert.equal(m.industryUnlocked("FOOD", account), true);
for (const slot of [0, 3, 4, 5, 6]) assert.equal(save.islandAvailableHere(slot), false, `protected slot ${slot}`);
for (const slot of [1, 2]) assert.equal(save.islandAvailableHere(slot), true, `basic slot ${slot}`);
assert.equal(save.listIslands().length, 7, "all saves remain in the library");
assert.equal(save.slotForNewCompany(2), null, "existing companies count without deletion");
save.saveRun(company("Paid", { month: 9 }), 0);
save.saveTable(null, 0);
save.flushRun();
assert.equal(localStorage.getItem("novus:run:v1:0"), protectedRun);
assert.equal(localStorage.getItem("novus:table:v1:0"), protectedTable);
const basic = save.loadRun(1);
save.saveRun({ ...basic, month: 2 }, 1);
save.flushRun();
assert.equal(save.loadRun(1).month, 2, "basic gameplay can still save");
m.recordPlanIntent("pro_monthly");
m.grantProLocally("pro_monthly");
assert.equal(JSON.stringify(m.loadEntitlements()), originalAccount, "purchased account data is unchanged");

let requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  return { ok: true, json: async () => ({ url: "https://checkout.stripe.test/session" }) };
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
shell = "ios";
assert.equal((await billing.restorePurchases()).reason, "not-supported");
assert.equal(requests.length, 0, "native entry points make no billing request");
assert.equal(window.location.href, "/play");
assert.equal(sessionStorage.getItem("novus:pending-pro"), null);
assert.equal(sessionStorage.getItem("novus.pending-chapter"), null);

shell = "web";
assert.equal(m.isPro(m.loadEntitlements()), true);
assert.equal(save.islandAvailableHere(0), true);
assert.equal(save.islandAvailableHere(3), true);
assert.equal(m.industryUnlocked(premiumIndustry, m.loadEntitlements()), true);
assert.equal(JSON.stringify(m.loadEntitlements()), originalAccount);
assert.equal((await billing.goToCheckout("pro_monthly")).ok, true);
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "/api/billing/checkout");
assert.equal(window.location.href, "https://checkout.stripe.test/session");
console.log("✓ iOS basic access, protected saves, native payment refusal, and web checkout");
