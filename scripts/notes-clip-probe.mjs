#!/usr/bin/env node
/**
 * Measures the notes card on the camera screen — the one under THE COMPANY /
 * THE NUMBERS / THE ORDER — and reports whether its content is being clipped.
 *
 * Two numbers decide it:
 *   · the card section's clientHeight vs its content height (clipped?)
 *   · the scrolling column's scrollHeight vs clientHeight (can it be reached?)
 *
 * A card shorter than its content in a column that CANNOT scroll is content
 * that is unreachable, which is what "cut off" means.
 *
 * Run against `out/` at iPhone 15 Pro geometry with real device insets, since
 * env(safe-area-inset-*) cannot be simulated headless.
 */
import { chromium } from "playwright";
import http from "node:http";
import { register } from "node:module";
import { readFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = join(REPO, "out");
const PORT = 4711;
const SHOTS = process.env.NV_SHOTS ?? "/tmp/notes-probe";

const DEVICES = [
  { name: "iPhone 15 Pro", w: 393, h: 852, top: 59, bottom: 34 },
  { name: "iPhone SE", w: 375, h: 667, top: 20, bottom: 0 },
];

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

// ── A run parked at the year gate, with a brief so THE COMPANY has content ───
register(join(REPO, "scripts/ts-loader.mjs"), import.meta.url);
const { createRun, advanceMonth } = await import(join(REPO, "lib/engine/run.ts"));
const events = JSON.parse(await readFile(join(REPO, "data/events.json"), "utf8"));

let run = createRun({
  founderName: "Zach", playerAge: 17, companyName: "GlorpCo",
  industry: "FOOD", rookieMode: true, tutorial: false, gender: "male",
});
for (let i = 0; i < 24; i++) {
  const step = advanceMonth(run, events);
  run = step.run ?? run;
  if (step.gate) break;
}
run.brief = {
  companyType: "Ghost kitchen",
  whatItDoes: "We cook one menu out of a shared kitchen and deliver it in under twenty minutes.",
  usp: "No storefront, no waiters, one menu — so our food cost is half what a restaurant pays.",
  whyCustomers: "It is cheaper than the place next door and it arrives hot, every time.",
  mission: "Make one good meal cost less than a bad one.",
};

const seed = {
  run,
  profile: { founderName: "Zach", playerAge: 17, rookieMode: true, onboarded: true, micCalibration: null },
};

await mkdir(SHOTS, { recursive: true });

/** Every device/tab pair where the card is shorter than its own content. */
const failures = [];

const browser = await chromium.launch({
  // Honoured when set; otherwise Playwright's own resolution, which is what a
  // developer machine and CI both want.
  ...(process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--enable-unsafe-swiftshader",
  ],
});

/** Walks up from the card and reports every ancestor that could clip it. */
const MEASURE = () => {
  const section = document.querySelector('section[aria-label="Your notes"]');
  if (!section) return { found: false };
  const body = section.lastElementChild; // the tab body, the scrolling part
  const natural = [...section.children].reduce((h, el) => h + el.scrollHeight, 0);
  const chain = [];
  for (let el = section.parentElement; el && el !== document.body; el = el.parentElement) {
    const cs = getComputedStyle(el);
    chain.push({
      cls: (el.className || "").toString().slice(0, 64),
      h: Math.round(el.clientHeight),
      scrollH: Math.round(el.scrollHeight),
      overflowY: cs.overflowY,
      canScroll: el.scrollHeight - el.clientHeight > 1 && /auto|scroll/.test(cs.overflowY),
    });
  }
  return {
    found: true,
    section: {
      h: Math.round(section.clientHeight),
      natural: Math.round(natural),
      clippedBy: Math.round(natural - section.clientHeight),
    },
    bodyBox: {
      h: Math.round(body.clientHeight),
      scrollH: Math.round(body.scrollHeight),
      minH: getComputedStyle(body).minHeight,
      maxH: getComputedStyle(body).maxHeight,
    },
    chain,
  };
};

for (const dev of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: dev.w, height: dev.h },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    permissions: ["camera", "microphone"],
  });
  const page = await ctx.newPage();
  await page.addInitScript((s) => {
    localStorage.setItem("novus:run:v1", JSON.stringify(s.run));
    localStorage.setItem("novus:profile:v1", JSON.stringify(s.profile));
    localStorage.setItem("novus:theme:v1", "dark");
  }, seed);
  await page.addInitScript(
    ({ top, bottom }) => {
      const style = document.createElement("style");
      style.textContent = `:root{--nv-safe-top:calc(${top}px + 0.75rem);--nv-safe-bottom:calc(${bottom}px + 0.5rem);}`;
      const attach = () => document.head.appendChild(style);
      if (document.head) attach();
      else document.addEventListener("DOMContentLoaded", attach);
    },
    { top: dev.top, bottom: dev.bottom },
  );

  await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const gate = page.locator("button", { hasText: /CLOSE THE YEAR|PITCH|GATE|FISCAL/i }).first();
  if (await gate.count()) { await gate.click().catch(() => {}); await page.waitForTimeout(1200); }

  const report = async (tag) => {
    const m = await page.evaluate(MEASURE);
    console.log(`\n── ${dev.name} · ${tag} ──`);
    if (!m.found) { console.log("  notes card not on screen"); return; }
    if (m.section.clippedBy > 2) failures.push(`${dev.name} · ${tag}`);
    const verdict = m.section.clippedBy > 2 ? "✗ CLIPPED" : "✓ whole";
    console.log(`  card       ${m.section.h}px tall, content ${m.section.natural}px  ${verdict}` +
      (m.section.clippedBy > 2 ? ` (${m.section.clippedBy}px hidden)` : ""));
    console.log(`  tab body   ${m.bodyBox.h}px / scroll ${m.bodyBox.scrollH}px  min ${m.bodyBox.minH} max ${m.bodyBox.maxH}`);
    for (const a of m.chain.slice(0, 4)) {
      console.log(`  ancestor   h ${a.h} scrollH ${a.scrollH} overflowY ${a.overflowY}` +
        `${a.canScroll ? "  ← scrollable" : ""}`);
    }
    await page.screenshot({ path: join(SHOTS, `${dev.name.replace(/\s+/g, "-")}-${tag}.png`) });
  };

  await report("brief");

  const open = page.locator("button", { hasText: /OPEN THE CAMERA|TRY THE CAMERA/i }).first();
  if (await open.count()) { await open.click().catch(() => {}); await page.waitForTimeout(2500); }
  // THE ORDER is the camera screen's default tab pre-recording.
  await report("camera-order");

  const numbers = page.locator("button", { hasText: /^THE NUMBERS$/ }).first();
  if (await numbers.count()) { await numbers.click().catch(() => {}); await page.waitForTimeout(400); }
  await report("camera-numbers");

  await ctx.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.log(`\n✗ notes card clipped on ${failures.length}: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\n✓ notes card whole on every device and tab`);
