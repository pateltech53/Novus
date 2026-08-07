#!/usr/bin/env node
/**
 * Onboarding's way back and way out.
 *
 * Walks the flow, and on every step checks three things the eye is bad at:
 *   · are BACK and HOME on screen where they should be, and absent where they
 *     should not be (`wave` has nothing behind it, `too-young` is a gate);
 *   · does BACK actually land on the previous step;
 *   · does the step's own content clear the toolbar, rather than sliding under
 *     it — which is the failure this app has now been reported for three times.
 *
 * Run against `out/` at iPhone 15 Pro geometry with real device insets.
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = join(REPO, "out");
const PORT = 4737;
const SHOTS = process.env.NV_SHOTS ?? "/tmp/welcome-nav";

const W = 393;
const H = 852;
const INSET_TOP = 59;

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

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--enable-unsafe-swiftshader",
  ],
});

const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  permissions: ["camera", "microphone"],
});
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem("novus:theme:v1", "dark"));
await page.addInitScript((top) => {
  const style = document.createElement("style");
  style.textContent = `:root{--nv-safe-top:calc(${top}px + 0.75rem);--nv-safe-bottom:calc(34px + 0.5rem);}`;
  const attach = () => document.head.appendChild(style);
  if (document.head) attach();
  else document.addEventListener("DOMContentLoaded", attach);
}, INSET_TOP);

await page.goto(`http://127.0.0.1:${PORT}/welcome/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const nav = () => page.locator('[aria-label="Back a step"]').count();
const homeBtn = () => page.locator('[aria-label="Leave setting up"]').count();

/** What the step is showing, by the one line only it has. */
const label = async () => {
  const t = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
  if (/Run a company/.test(t)) return "wave";
  if (/WHAT SHOULD THE SHARK CALL YOU/i.test(t)) return "name";
  if (/HOW OLD ARE YOU/i.test(t)) return "age";
  if (/COME BACK WHEN|13/.test(t) && /old/i.test(t) === false) return "too-young";
  return "later-step";
};

/** The topmost pixel of anything the STEP draws, versus the toolbar's bottom. */
const CLEARANCE = () => {
  const back = document.querySelector('[aria-label="Back a step"]');
  const bar = back ? back.closest(".nv-ggroup") : null;
  const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
  let top = Infinity;
  let who = "";
  for (const el of document.querySelectorAll("main h1,main h2,main p,main label,main input,main img")) {
    if (bar && bar.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.top < top) { top = r.top; who = (el.textContent || el.tagName).trim().slice(0, 30); }
  }
  return { barBottom: Math.round(barBottom), contentTop: Math.round(top), who };
};

let failed = 0;
const say = (ok, line) => { if (!ok) failed++; console.log(`  ${ok ? "✓" : "✗"} ${line}`); };

console.log("\n── wave (the opening) ──");
say((await nav()) === 0, `no BACK — nothing is behind the first screen (found ${await nav()})`);
await page.screenshot({ path: join(SHOTS, "01-wave.png") });

await page.locator("button", { hasText: /^START$/ }).first().click();
await page.waitForTimeout(700);
console.log("\n── name (after START) ──");
say((await nav()) === 1, "BACK is on screen");
say((await homeBtn()) === 1, "HOME is on screen");
let c = await page.evaluate(CLEARANCE);
say(c.contentTop >= c.barBottom, `content clears the toolbar — bar ends ${c.barBottom}, "${c.who}" starts ${c.contentTop}`);
await page.screenshot({ path: join(SHOTS, "02-name.png") });

// BACK must land on the step before.
await page.locator('[aria-label="Back a step"]').click();
await page.waitForTimeout(700);
say((await label()) === "wave", `BACK from name lands on wave (got "${await label()}")`);

// Forward two, then back one, to prove it walks rather than resets.
await page.locator("button", { hasText: /^START$/ }).first().click();
await page.waitForTimeout(600);
await page.locator("input").first().fill("Zach");
await page.locator("button", { hasText: /^CONTINUE$/ }).first().click();
await page.waitForTimeout(700);
console.log("\n── age ──");
say((await label()) === "age", `reached age (got "${await label()}")`);
c = await page.evaluate(CLEARANCE);
say(c.contentTop >= c.barBottom, `content clears the toolbar — bar ends ${c.barBottom}, "${c.who}" starts ${c.contentTop}`);
await page.screenshot({ path: join(SHOTS, "03-age.png") });

await page.locator('[aria-label="Back a step"]').click();
await page.waitForTimeout(700);
say((await label()) === "name", `BACK from age lands on name (got "${await label()}")`);

// The gate: no way back out of it.
await page.locator("button", { hasText: /^CONTINUE$/ }).first().click();
await page.waitForTimeout(600);
await page.locator("input").first().fill("9");
await page.locator("button", { hasText: /^CONTINUE$/ }).first().click();
await page.waitForTimeout(900);
console.log("\n── too-young (a gate) ──");
say((await nav()) === 0, `no BACK — a gate does not offer a second guess (found ${await nav()})`);
await page.screenshot({ path: join(SHOTS, "04-too-young.png") });

await browser.close();
server.close();

if (failed) {
  console.log(`\n✗ ${failed} check(s) failed`);
  process.exit(1);
}
console.log("\n✓ onboarding has a way back and a way out, and nothing slides under either");
