#!/usr/bin/env node
/**
 * How long is it between the tap and the screen?
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Reported as: the six activity tabs in the iOS app stutter, then the screen
 * comes out. It was not the animation and it was not the network. Every
 * overlay on /play was `dynamic(…, { loading: () => null })` — `React.lazy`
 * inside a `Suspense` — and the first render of one commits a fallback, after
 * which React throttles replacing that fallback with the real content by about
 * 300ms so a boundary resolving a few frames later does not flash. It is
 * charged in full even when the module is already in memory.
 *
 * Measured here before the fix: 315ms unthrottled, 343ms at CPU ×6. A cost
 * that does not move when the CPU is six times slower is a timer, not work,
 * which is what named the cause. After: 8–24ms.
 *
 * ── What it measures, and why not "visible" ─────────────────────────────────
 *
 * `pointerdown` to the sheet EXISTING IN THE DOM, both timestamps taken inside
 * the page so no CDP round trip is charged to the number. Not "visible":
 * the entrance is a 280ms animation by design (`ENTER` in components/ui/
 * Motion.tsx), and measuring against it would fold a deliberate duration into
 * a latency budget and go red the day somebody slows the animation down.
 *
 * The split matters and is printed: React commits the state — the tab lights
 * up — long before the screen arrives, and it was the gap between those two
 * that was the bug. A run where "tab lit" is fast and "dialog" is slow is a
 * Suspense boundary that has come back.
 *
 * Run against `out/` (`npm run build:native:only`), which is the bundle the
 * app actually ships.
 */
import { chromium } from "playwright";
import http from "node:http";
import { register } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = join(REPO, "out");
const PORT = 4729;

/**
 * The ceiling, in milliseconds.
 *
 * Generous against the 8–24ms this measures on a developer machine, and still
 * an order of magnitude under the 315ms it is here to keep out. The point is
 * to catch a Suspense boundary coming back, not to police single-digit drift
 * on whatever hardware happens to run CI.
 */
const BUDGET = 120;

/** The tab bar's six, which is what was reported. */
const TABS = ["COMPANY", "TEAM", "PRODUCT", "ASSETS", "MARKET", "CLOSET"];

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4", ".glb": "model/gltf-binary", ".txt": "text/plain",
  ".wasm": "application/wasm", ".mjs": "text/javascript",
};

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const candidates = /\.[a-z0-9]+$/i.test(path)
    ? [join(ROOT, path)]
    : [join(ROOT, path, "index.html"), join(ROOT, `${path}.html`)];
  for (const file of candidates) {
    try {
      await stat(file);
      res.writeHead(200, {
        "content-type": TYPES[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream",
      });
      res.end(await readFile(file));
      return;
    } catch {}
  }
  res.writeHead(404).end("not found");
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

register(join(REPO, "scripts/ts-loader.mjs"), import.meta.url);
const { createRun, advanceMonth } = await import(join(REPO, "lib/engine/run.ts"));
const events = JSON.parse(await readFile(join(REPO, "data/events.json"), "utf8"));

let run = createRun({
  founderName: "Zach", playerAge: 17, companyName: "GlorpCo",
  industry: "FOOD", rookieMode: true, tutorial: false, gender: "male",
});
for (let i = 0; i < 5; i++) {
  const step = advanceMonth(run, events);
  run = step.run ?? run;
  if (step.card) break;
}
const seed = {
  run,
  profile: { founderName: "Zach", playerAge: 17, rookieMode: true, onboarded: true, micCalibration: null },
};

const browser = await chromium.launch({
  ...(process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {}),
  args: ["--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
await page.addInitScript((s) => {
  localStorage.setItem("novus:run:v1", JSON.stringify(s.run));
  localStorage.setItem("novus:profile:v1", JSON.stringify(s.profile));
  localStorage.setItem("novus:theme:v1", "dark");
}, seed);

await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
// The term note rides inside the fixed bar and is not the steady state.
const coach = page.locator("button", { hasText: /tap to dismiss/i }).first();
if (await coach.count()) await coach.click().catch(() => {});
/*
 * Let the warm queue finish. This measures the state a player is in for all but
 * the first seconds of a run — every module already fetched — because that is
 * the state the 300ms was being paid in. A cold first tap is a different and
 * much rarer number, and lib/warm.tsx is what shrinks the window it lives in.
 */
await page.waitForTimeout(12000);

/** Both timestamps are taken in the page, either side of one tap. */
const ARM = () => {
  window.__tap = {};
  const seen = new MutationObserver(() => {
    if (!window.__tap.lit && document.querySelector('[data-coach="tabs"] button[aria-current="page"]'))
      window.__tap.lit = performance.now();
    if (!window.__tap.dialog && document.querySelector('[role="dialog"]')) {
      window.__tap.dialog = performance.now();
      seen.disconnect();
    }
  });
  seen.observe(document.body, { childList: true, subtree: true, attributes: true });
  document.addEventListener("pointerdown", () => { window.__tap.down = performance.now(); },
    { once: true, capture: true });
};

/**
 * The scrim behind whatever opened — the one target never under the panel.
 *
 * Two labels, because MARKET does not open an activity screen at all: it opens
 * the in-game phone, whose way out is "Put the phone down". Matching only
 * "Close …" left the phone up and every tab after it unreachable.
 */
const CLOSE = () => {
  const scrim = [...document.querySelectorAll("button[aria-label]")].find((b) =>
    /^(Close |Put the phone down)/.test(b.getAttribute("aria-label") || ""));
  scrim?.click();
};

let worst = 0;
let failed = 0;
console.log(`\n── First open of each tab, everything warm (budget ${BUDGET}ms) ──\n`);

for (const tab of TABS) {
  await page.evaluate(ARM);
  await page.locator('[data-coach="tabs"] button', { hasText: new RegExp(`^${tab}$`) }).first().click();
  await page.locator('[role="dialog"]').first().waitFor({ state: "visible", timeout: 20000 });
  const t = await page.evaluate(() => window.__tap);

  const lit = Math.round(t.lit - t.down);
  const shown = Math.round(t.dialog - t.down);
  worst = Math.max(worst, shown);
  const ok = shown <= BUDGET;
  if (!ok) failed++;
  console.log(
    `  ${tab.padEnd(8)} tap → tab lit ${String(lit).padStart(4)}ms` +
      `   tap → screen in DOM ${String(shown).padStart(4)}ms   ${ok ? "✓" : "✗ over budget"}`,
  );

  await page.evaluate(CLOSE);
  await page.locator('[role="dialog"]').first().waitFor({ state: "detached", timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(700);
}

await browser.close();
server.close();

if (failed) {
  console.log(
    `\n✗ ${failed} tab(s) over ${BUDGET}ms — worst ${worst}ms.` +
      `\n  A number near 300 that barely moves under CPU throttling is a Suspense` +
      `\n  fallback being committed again: check that the overlays are warm() and` +
      `\n  not dynamic(…, { loading: () => null }). See lib/warm.tsx.`,
  );
  process.exit(1);
}
console.log(`\n✓ every tab opens within ${BUDGET}ms of the tap — worst ${worst}ms`);
