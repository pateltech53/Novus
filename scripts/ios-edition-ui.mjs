#!/usr/bin/env node
// Existing Pro must remain usable while native checkout stays absent.
// Run against `npm run start -- --port 4103`. APIs are mocked; no real payments.
import assert from "node:assert/strict";
import { register } from "node:module";
import { chromium } from "playwright";
register("./ts-loader.mjs", import.meta.url);
const { createRun } = await import("../lib/engine/run.ts");
const { NO_ENTITLEMENTS } = await import("../lib/monetization.ts");
const { INDUSTRIES } = await import("../lib/engine/constants.ts");
const origin = process.env.EDITION_TEST_ORIGIN ?? "http://127.0.0.1:4103";
const profile = { founderName: "Test", playerAge: 20, rookieMode: true, onboarded: true, micCalibration: null };
const run = createRun({ founderName: "Test", playerAge: 20, companyName: "Pro Company",
  industry: "FOOD", rookieMode: true, tutorial: false, gender: "male" });
run.pro = true;
const entitlements = { ...NO_ENTITLEMENTS, pro: true, intent: "pro_yearly", extraIslands: 3 };
const browser = await chromium.launch({ headless: true, ...(process.env.EDITION_TEST_CHANNEL ? { channel: process.env.EDITION_TEST_CHANNEL } : {}) });
// Native uses the production API origin. Localhost emulation needs mocked CORS
// and a CSP bypass; production serves the shell and these APIs on the same origin.
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, reducedMotion: "reduce", bypassCSP: true });
const apiHeaders = {
  "access-control-allow-origin": origin,
  "access-control-allow-credentials": "true",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};
const errors = [];
const billingRequests = [];
let refreshes = 0;
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/api/")) {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: apiHeaders });
    if (/\/billing\/(checkout|portal)/.test(url.pathname)) billingRequests.push(url.pathname);
    if (url.pathname === "/api/billing/entitlements") {
      refreshes++;
      return route.fulfill({ headers: apiHeaders, json: { configured: true, signedIn: true, entitlements } });
    }
    if (url.pathname === "/api/company/start") {
      return route.fulfill({ headers: apiHeaders, json: { start: { seed: 74291, pro: true, ticket_used: false, tickets: 0, tutorial: false } } });
    }
    return route.fulfill({ headers: apiHeaders, json: { configured: false, signedIn: false, entitlements: null, admin: false, isAdmin: false } });
  }
  if (url.origin !== origin) return route.abort();
  return route.continue();
});
await context.addInitScript(({ profile, run, entitlements }) => {
  window.webkit = { messageHandlers: { bridge: {} } };
  if (localStorage.getItem("purchase-fixture")) return;
  localStorage.setItem("purchase-fixture", "1");
  localStorage.setItem("novus:account:v1", JSON.stringify({ displayName: "Test", createdAtISO: "2026-09-19" }));
  localStorage.setItem("novus:profile:v1", JSON.stringify(profile));
  for (let slot = 0; slot < 3; slot++) {
    localStorage.setItem(`novus:run:v1:${slot}`, JSON.stringify({ ...run, id: `${run.id}-${slot}`, companyName: slot === 0 ? "Pro Company" : `Pro Company ${slot + 1}` }));
  }
  localStorage.setItem("novus:island:v1", "2");
  localStorage.setItem("novus:entitlements:v1", JSON.stringify(entitlements));
}, { profile, run, entitlements });
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
const visit = async (path) => {
  await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(450);
  return page.locator("body").innerText();
};
try {
  let text = await visit("/found");
  for (const industry of INDUSTRIES) {
    assert.ok(await page.getByRole("button", { name: new RegExp(industry.name, "i") }).count(), industry.name);
  }
  assert.doesNotMatch(text, /NO ISLANDS LEFT|NO ROOM/i);
  text = await visit("/play");
  assert.ok(page.url().includes("/play"), "third paid company remains playable");
  assert.match(text, /Pro Company 3/i);
  await page.getByRole("button", { name: "PRO", exact: true }).first().click();
  await page.getByRole("dialog").waitFor();
  text = await page.getByRole("dialog").innerText();
  assert.match(text, /NOVUS PRO/);
  assert.match(text, /12 industries.*13 islands/);
  assert.match(text, /Purchases are not available in this app/);
  assert.match(text, /existing Pro benefits.*available in this app/);
  assert.doesNotMatch(text, /\$6\.99|\$39\.99|RESTORE PURCHASES|CHOOSE PRO|SEE PRO/i);
  await page.getByRole("button", { name: "REFRESH ACCOUNT ACCESS", exact: true }).click();
  await page.getByText("Your account access is up to date.", { exact: true }).waitFor();
  assert.ok(refreshes > 0);
  await page.screenshot({ path: "../ios-pro-access.png" });
  await page.getByRole("button", { name: "CONTINUE PLAYING", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(400);
  text = await page.locator("body").innerText();
  assert.match(text, /ACCOUNT ACCESS/);
  assert.match(text, /NOVUS PRO/);
  assert.doesNotMatch(text, /RESTORE PURCHASE|MANAGE SUBSCRIPTION|BASIC EDITION/);

  for (const path of ["/", "/product", "/product/you", "/terms", "/privacy", "/chapter/new"]) {
    text = await visit(path);
    assert.doesNotMatch(text, /\$6\.99|\$39\.99|(?:^|\n)\s*(?:CHOOSE PRO|BUY PRO|RESTORE PURCHASES)\s*(?:$|\n)/i, path);
    assert.doesNotMatch(text, /cannot be played|paid content.*not.*available|basic edition/i, path);
  }
  text = await visit("/islands");
  assert.match(text, /13 at once/);
  await page.getByText("Pro Company 3", { exact: true }).first().click();
  await page.getByRole("button", { name: /CONTINUE/ }).last().click();
  await page.waitForURL("**/play*");
  await page.getByText(/Pro Company 3/).first().waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("novus:run:v1:2")).pro), true);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("novus:entitlements:v1")));
  assert.equal(stored.pro, true);
  assert.equal(stored.intent, "pro_yearly");
  // Exercise the merge with founding registration: server Pro must reach the
  // new run without overwriting any existing paid company.
  await visit("/found");
  const paidIndustry = INDUSTRIES.find((industry) => !industry.free);
  await page.getByPlaceholder("Company name", { exact: true }).fill("Fourth Pro Company");
  await page.getByRole("button", { name: new RegExp(paidIndustry.name, "i") }).click();
  await page.getByRole("checkbox", { name: /Skip the guided year/ }).check();
  await page.getByRole("button", { name: "FOUND IT ▸", exact: true }).click();
  await page.waitForURL("**/play*");
  await page.getByText(/Fourth Pro Company/).first().waitFor();
  const founded = await page.evaluate(() => JSON.parse(localStorage.getItem("novus:run:v1:3")));
  assert.equal(founded.pro, true);
  assert.equal(founded.industry, paidIndustry.code);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("novus:run:v1:2")).companyName), "Pro Company 3");
  assert.equal(billingRequests.length, 0);
  // Chromium emulates the platform, not the App/Keyboard native plugins.
  assert.deepEqual(errors.filter((e) => !/^"(App|Keyboard)" plugin is not implemented on ios$/.test(e)), []);
  console.log("✓ iOS Pro industries/third company/new founding, account refresh, settings, and no purchase actions");
} catch (error) {
  console.error("Page:", page.url(), "\n", (await page.locator("body").innerText()).slice(0, 2500));
  throw error;
} finally {
  await browser.close();
}
