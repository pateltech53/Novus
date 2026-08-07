#!/usr/bin/env node
/**
 * Does anything land under the Dynamic Island on the app's FIRST paint?
 *
 * ── The state this reproduces ───────────────────────────────────────────────
 *
 * `env(safe-area-inset-top)` answers 0 on WKWebView's first load, before the
 * web view has been laid out inside its safe area. Everything derived from it
 * collapses to its 0.75rem gap, so ~59pt of hardware becomes 12pt of padding —
 * once, on the screen a player opens the app to. Reported as the islands title
 * under the status bar and the mascot's head behind the island, "only the first
 * time; go into a company and back and it is fine".
 *
 * So this run sets NO insets at all, and stamps `data-platform="ios"` and
 * `data-notch="true"` the way the pre-paint script does on a notched iPhone.
 * That is the broken state exactly, and the floor in globals.css is what has to
 * survive it.
 *
 * The island's own box on a 393pt phone: 125 wide, 37 tall, 11 from the top —
 * so its chin is at 48. Anything the app draws above 48 is under hardware.
 */
import { chromium } from "playwright";
import http from "node:http";
import { register } from "node:module";
import { readFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = join(REPO, "out");
const PORT = 4733;
const SHOTS = process.env.NV_SHOTS ?? "/tmp/safe-area";

const W = 393;
const H = 852;
const ISLAND = { w: 125, h: 37, top: 11 };
const ISLAND_BOTTOM = ISLAND.top + ISLAND.h; // 48

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

const fresh = () =>
  createRun({
    founderName: "Zach", playerAge: 17, companyName: "GlorpCo",
    industry: "FOOD", rookieMode: true, tutorial: false, gender: "male",
  });

let mid = fresh();
for (let i = 0; i < 5; i++) {
  const step = advanceMonth(mid, events);
  mid = step.run ?? mid;
  if (step.card) break;
}
/** Parked at month twelve, where the camera gate is. */
let gate = fresh();
for (let i = 0; i < 24; i++) {
  const step = advanceMonth(gate, events);
  gate = step.run ?? gate;
  if (step.gate) break;
}

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {}),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--enable-unsafe-swiftshader",
  ],
});

/** Everything painted above the island's chin, ignoring what is meant to be
 *  behind it — the page background, the water, the stage. */
const UNDER_ISLAND = (bottom) => {
  const skip = new Set(["HTML", "BODY", "MAIN", "SVG", "CANVAS"]);
  const hits = [];
  const seen = new Set();
  for (const el of document.querySelectorAll("h1,h2,p,span,button,img,a")) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.top >= bottom) continue;
    // Only what actually sits under the island's horizontal footprint.
    const left = (393 - 125) / 2;
    if (r.right < left || r.left > left + 125) continue;
    if (skip.has(el.tagName)) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    const label =
      (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 34) ||
      el.getAttribute("alt") ||
      el.tagName.toLowerCase();
    if (seen.has(label)) continue;
    seen.add(label);
    hits.push(`${el.tagName.toLowerCase()} "${label}" top ${Math.round(r.top)}`);
  }
  return hits;
};

const SCREENS = [
  { name: "islands", url: "/islands/", run: mid, slot: true },
  { name: "play", url: "/play/", run: mid },
  { name: "pitch-brief", url: "/play/", run: gate, openGate: true },
];

let failed = 0;
for (const s of SCREENS) {
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    permissions: ["camera", "microphone"],
  });
  const page = await ctx.newPage();
  await page.addInitScript((d) => {
    localStorage.setItem("novus:theme:v1", "dark");
    localStorage.setItem("novus:profile:v1", JSON.stringify({
      founderName: "Zach", playerAge: 17, rookieMode: true, onboarded: true, micCalibration: null,
    }));
    localStorage.setItem("novus:account:v1", JSON.stringify({
      displayName: "Zach", email: "zach@example.com", createdAtISO: "2026-01-01T00:00:00.000Z",
    }));
    if (d.slot) localStorage.setItem("novus:run:v1:0", JSON.stringify(d.run));
    else localStorage.setItem("novus:run:v1", JSON.stringify(d.run));
    localStorage.setItem("novus:island:v1", "0");
  }, { run: s.run, slot: !!s.slot });

  /*
   * The pre-paint script's own two attributes, and NO insets — which is what
   * a notched iPhone looks like on its first load. `env()` is left at its 0
   * default deliberately; that is the bug being reproduced.
   */
  await page.addInitScript(() => {
    const set = () => {
      try {
        document.documentElement.dataset.platform = "ios";
        document.documentElement.dataset.notch = "true";
      } catch {}
    };
    // At document-start `documentElement` may not exist yet, so try now and
    // again at every point the app itself could have overwritten it —
    // `markPlatformOnRoot` sets `data-platform` from the real Capacitor API on
    // mount, which is "web" here.
    set();
    document.addEventListener("readystatechange", set);
    document.addEventListener("DOMContentLoaded", set);
    window.addEventListener("load", set);
  });

  await page.goto(`http://127.0.0.1:${PORT}${s.url}`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.documentElement.dataset.platform = "ios";
    document.documentElement.dataset.notch = "true";
  });
  await page.waitForTimeout(1700);

  if (s.openGate) {
    const gateBtn = page.locator("button", { hasText: /CLOSE THE YEAR|PITCH|THE GATE/i }).first();
    if (await gateBtn.count()) { await gateBtn.click().catch(() => {}); await page.waitForTimeout(1600); }
  }

  const attrs = await page.evaluate(() => ({
    platform: document.documentElement.dataset.platform ?? null,
    notch: document.documentElement.dataset.notch ?? null,
  }));
  const safeTop = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--nv-safe-top").trim(),
  );
  const resolved = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.height = "var(--nv-safe-top)";
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return Math.round(h);
  });
  const hits = await page.evaluate(UNDER_ISLAND, ISLAND_BOTTOM);
  if (hits.length) failed++;

  console.log(`\n── ${s.name} ──`);
  console.log(`  <html> platform=${attrs.platform} notch=${attrs.notch}`);
  console.log(`  --nv-safe-top  ${safeTop}  → ${resolved}px`);
  if (!hits.length) console.log(`  ✓ nothing above the island's chin (${ISLAND_BOTTOM}px)`);
  else for (const h of hits) console.log(`  ✗ ${h}`);

  // Draw the island so the screenshot shows what the numbers say.
  await page.addStyleTag({
    content: `#nv-island{position:fixed;left:${(W - ISLAND.w) / 2}px;top:${ISLAND.top}px;
      width:${ISLAND.w}px;height:${ISLAND.h}px;border-radius:20px;background:#000;
      outline:2px solid #ff3b30;z-index:2147483647;pointer-events:none;}`,
  });
  await page.evaluate(() => {
    if (!document.getElementById("nv-island")) {
      const a = document.createElement("div");
      a.id = "nv-island";
      document.body.appendChild(a);
    }
  });
  await page.screenshot({ path: join(SHOTS, `${s.name}.png`) });
  await ctx.close();
}

await browser.close();
server.close();

if (failed) {
  console.log(`\n✗ ${failed} screen(s) draw under the island on a first paint`);
  process.exit(1);
}
console.log("\n✓ nothing lands under the island, even with env() reporting zero");
