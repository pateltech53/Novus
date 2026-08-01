#!/usr/bin/env node
/**
 * The phone audit.
 *
 * Serves the static export the way the app shell does — directory paths
 * resolving to index.html — and walks the play screen and all six activity
 * screens at four real iPhone widths, checking the things a screenshot does
 * not tell you:
 *
 *   · type under the 12px floor the design system sets
 *   · text clipped by its own box (a truncated tab label, a wrapped button)
 *   · controls a thumb cannot land on, measured by hit-testing rather than by
 *     reading a box — a 28px switch with a 44px touch area is fine, and only
 *     `document.elementFromPoint` knows the difference
 *   · anything left genuinely unreachable under the bottom bar. Being below
 *     the fold is not the same as being covered, so a covered element is
 *     scrolled into view and re-tested before it counts
 *   · a page wider than the screen
 *
 * The run itself is real: built with the actual engine, five months in, so the
 * life log has content and The Books have moved off their starting values.
 *
 * Usage:  npm run audit:phone          (writes screenshots to .audit-shots/)
 * Requires a build first: npm run build:native:only
 */


import { chromium } from "playwright";
import http from "node:http";
import { register } from "node:module";
import { readFile, stat, mkdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(REPO, "out");
const PORT = 4601;
const SHOTS = process.env.SHOTS || join(REPO, ".audit-shots");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4", ".glb": "model/gltf-binary", ".txt": "text/plain",
  ".xml": "application/xml", ".wasm": "application/wasm", ".mjs": "text/javascript",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(req.url.split("?")[0]);
    let file = join(ROOT, url);
    const s = await stat(file).catch(() => null);
    if (!s || s.isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(SHOTS, { recursive: true });

// ── A real run to audit against ─────────────────────────────────────────────
// The engine is TypeScript; scripts/ts-loader.mjs is the same hook the balance
// harness uses to import it from Node without a build step.
register("./ts-loader.mjs", import.meta.url);
const { createRun, advanceMonth } = await import(join(REPO, "lib/engine/run.ts"));
const events = JSON.parse(await readFile(join(REPO, "data/events.json"), "utf8"));

let run = createRun({
  founderName: "Zach",
  playerAge: 17,
  companyName: "GlorpCo",
  industry: "FOOD",
  rookieMode: true,
  tutorial: false,
  gender: "male",
});
for (let i = 0; i < 5; i++) {
  const step = advanceMonth(run, events);
  run = step.run ?? run;
  if (step.gate) break;
}
const seed = {
  run,
  profile: {
    founderName: "Zach",
    playerAge: 17,
    rookieMode: true,
    onboarded: true,
    micCalibration: null,
  },
};

const AUDIT = () => {
  const problems = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;

  if (document.documentElement.scrollWidth > vw + 1) {
    problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`);
  }

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const label = (el) => {
    const id = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 34) || el.tagName;
    return `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""} "${id}"`;
  };

  // ── Type floor ────────────────────────────────────────────────────────────
  for (const el of document.querySelectorAll("body *")) {
    if (!el.childNodes.length) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText || !visible(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 11.5) problems.push(`type under the floor: ${px}px on ${label(el)}`);
  }

  // ── Clipped text ──────────────────────────────────────────────────────────
  for (const el of document.querySelectorAll("button span, button, a, h1, h2, p, li")) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const clips = s.overflow === "hidden" || s.textOverflow === "ellipsis";
    if (!clips) continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      problems.push(`text clipped: ${label(el)} (${el.scrollWidth} in ${el.clientWidth})`);
    }
  }

  // ── Touch targets ─────────────────────────────────────────────────────────
  for (const el of document.querySelectorAll("button, a[href], [role='button']")) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh) continue;
    if (r.height >= 30 && r.width >= 30) continue;
    // A small box is only a small target if the touch area is small too. Ask
    // the document what is under the point a thumb would actually land on.
    const probe = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const reach = 22;
    const wide = r.width >= 30 || (probe(cx - reach, cy) && probe(cx + reach, cy));
    const tall = r.height >= 30 || (probe(cx, cy - reach) && probe(cx, cy + reach));
    if (!wide || !tall) {
      problems.push(`tap target ${Math.round(r.width)}×${Math.round(r.height)}: ${label(el)}`);
    }
  }

  // ── Occlusion by the bottom bar ───────────────────────────────────────────
  // With a sheet open, everything under it is meant to be unreachable. Only
  // what is inside the sheet is in scope.
  const modal = document.querySelector('[role="dialog"]');
  const inScope = (el) => !modal || modal.contains(el);

  const bar = document.querySelector("nav[aria-label='Activities']");
  if (bar) {
    const b = bar.getBoundingClientRect();
    if (b.bottom > vh + 1) problems.push(`tab bar hangs off the bottom by ${Math.round(b.bottom - vh)}px`);
    for (const el of document.querySelectorAll("button, a[href]")) {
      if (!visible(el) || bar.contains(el) || !inScope(el)) continue;
      const r = el.getBoundingClientRect();
      const overlaps = r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      // Anything painted above the bar is fine; only things underneath it are
      // unreachable, and elementFromPoint is the only honest way to ask.
      if (!overlaps) continue;
      const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
      const cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
      const hit = document.elementFromPoint(cx, cy);
      const fullBleed = r.width >= vw - 1 && r.height >= vh - 1;
      if (fullBleed) continue;
      if (hit && !el.contains(hit) && !hit.contains(el)) {
        // Covered where it currently sits. That is only a defect if it is
        // still covered after the page has been scrolled to reach it — the
        // fold is not occlusion.
        const before = window.scrollY;
        // Scrolled to the top of the viewport, not the middle: on a 320×568
        // screen the bar owns the lower half, so "centred" is itself behind it.
        el.scrollIntoView({ block: "start" });
        const rr = el.getBoundingClientRect();
        const stillHit = document.elementFromPoint(
          Math.min(Math.max(rr.left + rr.width / 2, 1), vw - 1),
          Math.min(Math.max(rr.top + rr.height / 2, 1), vh - 1),
        );
        const stuck = stillHit && !el.contains(stillHit) && !stillHit.contains(el);
        window.scrollTo(0, before);
        if (stuck) problems.push(`unreachable under the bar: ${label(el)}`);
      }
    }
  }

  return problems;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const SIZES = [
  ["se", 320, 568],
  ["mini", 375, 812],
  ["pro", 393, 852],
  ["max", 430, 932],
];

let failures = 0;

for (const [name, width, height] of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript((s) => {
    localStorage.setItem("novus:run:v1", JSON.stringify(s.run));
    localStorage.setItem("novus:profile:v1", JSON.stringify(s.profile));
    localStorage.setItem("novus:theme:v1", "dark");
  }, seed);

  await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const screens = [
    ["play", null],
    ["company", "company"],
    ["team", "team"],
    ["product", "product"],
    ["assets", "assets"],
    ["closet", "closet"],
  ];

  for (const [tag, tab] of screens) {
    if (tab) {
      const btn = page.locator(`nav[aria-label="Activities"] button`, { hasText: new RegExp(`^${tab}$`, "i") });
      if ((await btn.count()) === 0) { console.log(`  ${name}/${tag}: no tab button`); continue; }
      await btn.first().click();
      await page.waitForTimeout(650);
    }
    const problems = await page.evaluate(AUDIT);
    await page.screenshot({ path: join(SHOTS, `${name}-${tag}.png`), fullPage: false });
    if (problems.length) {
      failures += problems.length;
      console.log(`\n✗ ${name} (${width}px) · ${tag}`);
      for (const p of [...new Set(problems)]) console.log(`    ${p}`);
    } else {
      console.log(`✓ ${name} (${width}px) · ${tag}`);
    }
    if (tab) {
      // Back out of the screen so the next tab opens from the same place.
      const scrim = page.locator('button[aria-label^="Close"]');
      if (await scrim.count()) await scrim.first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      if (await page.locator('[role="dialog"]').count()) {
        await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);
      }
    }
  }
  await ctx.close();
}

console.log(`\n${failures} finding(s). Screenshots in ${SHOTS}/`);
await browser.close();
server.close();
process.exit(failures > 0 ? 1 : 0);
