#!/usr/bin/env node
// Run against `npm run start -- --port 4103`. All APIs are mocked; no live accounts or payments.
import assert from "node:assert/strict";
import { register } from "node:module";
import { chromium } from "playwright";
register("./ts-loader.mjs", import.meta.url);
const { createRun } = await import("../lib/engine/run.ts");
const { NO_ENTITLEMENTS } = await import("../lib/monetization.ts");
const { INDUSTRIES } = await import("../lib/engine/constants.ts");
const origin = process.env.EDITION_TEST_ORIGIN ?? "http://127.0.0.1:4103";
const profile = { founderName: "Test", playerAge: 20, rookieMode: true, onboarded: true, micCalibration: null };
const run = createRun({ founderName: "Test", playerAge: 20, companyName: "Basic Company",
  industry: "FOOD", rookieMode: true, tutorial: false, gender: "male" });
const entitlements = { ...NO_ENTITLEMENTS, pro: true, intent: "pro_yearly", extraIslands: 3 };
const browser = await chromium.launch({ headless: true, ...(process.env.EDITION_TEST_CHANNEL ? { channel: process.env.EDITION_TEST_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, reducedMotion: "reduce" });
const errors = [];
const billingRequests = [];
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.startsWith("/api/")) {
    if (/\/billing\/(checkout|portal)/.test(url.pathname)) billingRequests.push(url.pathname);
    return route.fulfill({ json: { configured: false, signedIn: false, entitlements: null, admin: false, isAdmin: false } });
  }
  if (url.origin !== origin) return route.abort();
  return route.continue();
});
await context.addInitScript(({ profile, run, entitlements }) => {
  window.webkit = { messageHandlers: { bridge: {} } };
  // Seed once: reloads must prove the application preserved the same saved data.
  if (localStorage.getItem("edition-fixture")) return;
  localStorage.setItem("edition-fixture", "1");
  localStorage.setItem("novus:account:v1", JSON.stringify({ displayName: "Test", createdAtISO: "2026-09-19" }));
  localStorage.setItem("novus:profile:v1", JSON.stringify(profile));
  localStorage.setItem("novus:run:v1:0", JSON.stringify(run));
  localStorage.setItem("novus:island:v1", "0");
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
  for (const industry of INDUSTRIES.filter((i) => !i.free)) {
    assert.equal(await page.getByRole("button", { name: new RegExp(industry.name, "i") }).count(), 0, industry.name);
  }
  assert.match(text, /food/i, "basic industries remain available");
  text = await visit("/play");
  assert.match(text, /Basic Company/i);
  await page.getByRole("button", { name: /^(FREE|PRO)$/ }).first().click();
  await page.getByRole("dialog").waitFor();
  text = await page.getByRole("dialog").innerText();
  assert.match(text, /basic game/);
  assert.match(text, /does not cancel an existing subscription/);
  assert.doesNotMatch(text, /\$6\.99|\$39\.99|RESTORE PURCHASES|CHOOSE PRO|SEE PRO/i);
  await page.screenshot({ path: "../ios-basic-edition.png" });
  await page.getByRole("dialog").getByRole("button", { name: /CONTINUE|BACK TO THE GAME/ }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(400);
  text = await page.locator("body").innerText();
  assert.match(text, /BASIC EDITION/);
  assert.doesNotMatch(text, /RESTORE PURCHASE|MANAGE SUBSCRIPTION|NOVUS PRO/);


  for (const path of ["/", "/product", "/product/you", "/terms", "/privacy", "/chapter/new"]) {
    text = await visit(path);
    assert.doesNotMatch(text, /\$6\.99|\$39\.99|(?:^|\n)\s*(?:CHOOSE PRO|BUY PRO|RESTORE PURCHASES)\s*(?:$|\n)/i, path);
  }
  // A synced Pro save must be visible as preserved data, never opened or rewritten.
  const paidRun = { ...run, companyName: "Protected Company", pro: true, month: 7 };
  await page.evaluate((paid) => {
    localStorage.setItem("novus:run:v1:0", JSON.stringify(paid));
    localStorage.removeItem("novus:islands:v1");
    localStorage.setItem("novus:table:v1:0", '{"preserved":true}');
  }, paidRun);
  text = await visit("/play");
  assert.ok(page.url().includes("/islands"), "paid save returns to its library");
  assert.match(text, /Protected Company/i);
  await page.getByText("Protected Company", { exact: true }).first().click();
  await page.getByRole("button", { name: "EDITION DETAILS", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /saved progress is kept unchanged/);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("novus:run:v1:0")).pro), true);
  assert.equal(await page.evaluate(() => localStorage.getItem("novus:table:v1:0")), '{"preserved":true}');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("novus:entitlements:v1")));
  assert.equal(stored.pro, true);
  assert.equal(stored.intent, "pro_yearly");
  assert.equal(billingRequests.length, 0);
  // Chromium emulates platform detection, not the native App/Keyboard plugins.
  const unexpectedErrors = errors.filter((error) => !/^"(App|Keyboard)" plugin is not implemented on ios$/.test(error));
  assert.deepEqual(unexpectedErrors, [], "no unexpected browser errors");
  console.log("✓ iOS pages, edition dialog, legal copy, Pro save redirect, and data preservation");
} catch (error) {
  console.error("Page:", page.url(), "\n", (await page.locator("body").innerText()).slice(0, 2500));
  throw error;
} finally {
  await browser.close();
}
