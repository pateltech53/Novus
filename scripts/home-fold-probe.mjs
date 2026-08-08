#!/usr/bin/env node
/**
 * Two questions about the foot of the play screen.
 *
 * ── 1. Is THE STORY SO FAR reachable without scrolling? ─────────────────────
 *
 * The phone play screen is a scrolling document with a FIXED bar at the foot
 * of it, so "above the fold" means "above the top of that bar" — not above the
 * viewport, which is 174px further down and would pass a row nobody can see.
 *
 * ── 2. Can the nudge card be TAPPED, without scrolling? ────────────────────
 *
 * Not the same question, and it is the one that was answered wrong twice. The
 * nudge is the app's "one thing worth doing" and it lived in the flow, which on
 * a phone put it past the end of a document that is already taller than the
 * screen. First it was washed out by the dock's fade; then, with that fixed, it
 * was still simply down there — reported, exactly, as: I cannot tap it.
 *
 * Geometry could not catch that, and did not: the card measured as "clear of
 * the fade" while being off the bottom of the phone. So this asks the reported
 * question literally instead. Load the screen, DO NOT scroll, and hit-test the
 * card's body and its ✕ with `elementFromPoint` — the same call the browser
 * makes to decide what a finger landed on. Anything that leaves the card
 * unreachable from a standing start fails, on every device including the SE.
 *
 * The card is now fixed above the dock, so it deliberately covers the log row
 * measured in part 1 while it is up. That is the toast bargain design.md §3
 * allows, and the ✕ this asserts on is what gives the row back.
 *
 * Run against `out/` (`npm run build:native:only`) at real device geometry.
 * `env(safe-area-inset-*)` cannot be simulated headless, so the two variables
 * the layout derives from it are set to what each device actually reports.
 */
import { chromium } from "playwright";
import http from "node:http";
import { register } from "node:module";
import { readFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

const REPO = process.cwd();
const ROOT = join(REPO, "out");
const PORT = 4725;
const SHOTS = process.env.NV_SHOTS ?? "/tmp/home-fold";

const DEVICES = [
  { name: "iPhone 16 Pro Max", w: 440, h: 956, top: 62, bottom: 34, must: true },
  { name: "iPhone 15 Pro", w: 393, h: 852, top: 59, bottom: 34, must: true },
  /*
   * The SE is REPORTED, not required, and the reason is arithmetic rather than
   * indulgence: 667px of screen carries 527px of flow once the fixed bar has
   * its share, and the masthead and The Books are 563 of it between them. The
   * books do not fit on this phone and never have. Any layout that put a row
   * below them above its fold would have to cut the ledger to do it.
   */
  { name: "iPhone SE", w: 375, h: 667, top: 20, bottom: 0, must: false },
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

register(join(REPO, "scripts/ts-loader.mjs"), import.meta.url);
const { createRun, advanceMonth } = await import(join(REPO, "lib/engine/run.ts"));
const events = JSON.parse(await readFile(join(REPO, "data/events.json"), "utf8"));

// A few months in, so the books carry real figures and no gate is up.
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
  profile: {
    founderName: "Zach", playerAge: 17, rookieMode: true,
    onboarded: true, micCalibration: null,
  },
};

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {}),
  args: ["--enable-unsafe-swiftshader"],
});

const MEASURE = () => {
  const log = [...document.querySelectorAll("button")].find((b) =>
    (b.textContent || "").includes("THE STORY SO FAR"),
  );
  const bar = [...document.querySelectorAll("div")].find(
    (d) => getComputedStyle(d).position === "fixed" && d.querySelector('[data-coach="advance"]'),
  );
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  };
  return {
    masthead: box(document.querySelector(".nv-masthead")),
    books: box(document.querySelector('[data-coach="books"]')),
    log: box(log),
    fold: bar ? Math.round(bar.getBoundingClientRect().top) : window.innerHeight,
  };
};

/**
 * Is the nudge card actually reachable by a finger, right now?
 *
 * `elementFromPoint` is the whole point of this and not a stand-in for a
 * bounding box: a card can be inside the viewport and still not be what a tap
 * at its own coordinates hits, because the dock, the dock's fade or any other
 * fixed layer may be over it. Both the card's body — which opens the tab — and
 * the ✕ — which is now the only way to get the log row back — are tested,
 * because they are separate targets with separate failure modes.
 */
const REACH = () => {
  const card = document.querySelector('[data-nudge="next-step"]');
  if (!card) return { card: null };
  const r = card.getBoundingClientRect();
  const dismiss = card.querySelector('[aria-label="Dismiss this suggestion"]');
  const d = dismiss?.getBoundingClientRect() ?? null;
  const hits = (x, y, within) => {
    const el = document.elementFromPoint(Math.round(x), Math.round(y));
    return !!el && (within === el || within.contains(el));
  };
  return {
    box: { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) },
    // Fully on screen, before anything is scrolled.
    onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
    // The title line, which is inside the card's own full-surface button.
    body: hits(r.left + r.width / 2, r.top + 16, card),
    dismiss: !!d && hits(d.left + d.width / 2, d.top + d.height / 2, dismiss),
    scrollY: Math.round(window.scrollY),
  };
};

let failed = 0;
for (const dev of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: dev.w, height: dev.h },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript((s) => {
    localStorage.setItem("novus:run:v1", JSON.stringify(s.run));
    localStorage.setItem("novus:profile:v1", JSON.stringify(s.profile));
    localStorage.setItem("novus:theme:v1", "dark");
  }, seed);
  await page.addInitScript(({ top, bottom }) => {
    const style = document.createElement("style");
    style.textContent = `:root{--nv-safe-top:calc(${top}px + 0.75rem);--nv-safe-bottom:calc(${bottom}px + 0.5rem);}`;
    const attach = () => document.head.appendChild(style);
    if (document.head) attach();
    else document.addEventListener("DOMContentLoaded", attach);
  }, dev);

  await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);

  /*
   * Dismiss the term explainer, because it is not the steady state.
   *
   * TermCoach rides INSIDE the fixed bar and adds ~112px to it the first time
   * a player meets a word like "runway" — which moves the fold up by that much
   * for one tap. Measuring against it would be measuring the app's most
   * cramped possible moment and calling it the layout.
   */
  const coach = page.locator("button", { hasText: /tap to dismiss/i }).first();
  if (await coach.count()) {
    await coach.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  const m = await page.evaluate(MEASURE);
  const visible = !!m.log && m.log.bottom <= m.fold;
  if (dev.must && !visible) failed++;

  console.log(`\n── ${dev.name} (${dev.w}×${dev.h}, inset ${dev.top}) ──`);
  console.log(`  fold (top of the fixed bar)  ${m.fold}`);
  console.log(`  masthead   ${String(m.masthead?.h).padStart(4)}px`);
  console.log(`  books      ${String(m.books?.h).padStart(4)}px  ends ${m.books?.bottom}`);
  console.log(
    `  log row    ${m.log ? `${m.log.top}..${m.log.bottom}` : "—"}   ` +
      (visible
        ? "✓ above the fold"
        : `✗ ${m.log ? m.log.bottom - m.fold : "?"}px below it` + (dev.must ? "" : "  (reported only)")),
  );
  await page.screenshot({ path: join(SHOTS, `${dev.name.replace(/\s+/g, "-")}.png`) });

  /*
   * The nudge, from a standing start — nothing scrolled, which is the state a
   * player opens this screen in. The seeded run has nothing on the shelf, so
   * the card IS rendered; if it is missing the probe has stopped testing the
   * thing it is named after and says so rather than passing quietly.
   */
  const t = await page.evaluate(REACH);
  const reachable = !!t.box && t.onScreen && t.body && t.dismiss;
  if (!reachable) failed++;

  console.log(
    `  nudge card ${t.box ? `${t.box.top}..${t.box.bottom}` : "— not rendered"}   ` +
      (reachable
        ? `✓ tappable at scroll ${t.scrollY} — body and ✕ both hit`
        : t.box
          ? `✗ ${[
              t.onScreen ? null : "off screen",
              t.body ? null : "body not hit",
              t.dismiss ? null : "✕ not hit",
            ]
              .filter(Boolean)
              .join(", ")}`
          : "✗ nothing to test — this probe is not checking what it claims"),
  );
  await page.screenshot({ path: join(SHOTS, `${dev.name.replace(/\s+/g, "-")}-nudge.png`) });
  await ctx.close();
}

await browser.close();
server.close();

if (failed) {
  console.log(`\n✗ ${failed} failure(s) above — the fold, the nudge's reachability, or both`);
  process.exit(1);
}
console.log(
  "\n✓ THE STORY SO FAR is above the fold on every device that can hold it," +
    "\n✓ and the nudge can be tapped on all of them without scrolling",
);
