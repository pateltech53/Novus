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
 * ── 2. Does the END of the document clear that bar, scrolled all the way? ───
 *
 * Not the same question, and it is the one that was answered wrong. The nudge
 * card renders below the log row and is therefore the last element in the flow
 * whenever it renders at all — nothing to sell, nobody employed. Reported as a
 * card at the bottom of the home screen that is cut off, twice, and both
 * times the report was right: the flow reserved the bar's height but not the
 * 36px fade that hangs above it, so the last card was washed out at maximum
 * scroll with nothing below it to justify the wash.
 *
 * So this scrolls to the very end and asserts the last card clears the fade,
 * not just the bar. That is `must` on every device here including the SE: it
 * costs nothing but slack at the end of a document, so no screen is too short
 * for it.
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
 * The end of the document, once it has been scrolled to.
 *
 * The fade is found rather than assumed: it is the absolutely-positioned,
 * non-interactive child the dock hangs above itself, and its own top edge — not
 * the dock's — is the highest pixel that a card at the end of the flow is
 * allowed to reach. Hard-coding 36 here would keep passing if `h-9` changed.
 */
const TAIL = () => {
  const bar = [...document.querySelectorAll("div")].find(
    (d) => getComputedStyle(d).position === "fixed" && d.querySelector('[data-coach="advance"]'),
  );
  const fade = bar
    ? [...bar.children].find((c) => {
        const s = getComputedStyle(c);
        return s.position === "absolute" && s.pointerEvents === "none";
      })
    : null;
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  };
  return {
    nudge: box(document.querySelector('[data-nudge="next-step"]')),
    bar: box(bar),
    fade: box(fade),
    atEnd: Math.round(document.documentElement.scrollHeight - window.innerHeight - window.scrollY),
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
   * Now the other end. The seeded run has nothing on the shelf, so the nudge
   * IS rendered and IS the last element in the flow; if it is missing the
   * probe has stopped testing the thing it is named after and says so rather
   * than passing quietly.
   */
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  const t = await page.evaluate(TAIL);
  const ceiling = t.fade?.top ?? t.bar?.top ?? null;
  const clear = !!t.nudge && ceiling !== null && t.nudge.bottom <= ceiling;
  if (!clear) failed++;

  console.log(
    `  nudge card ${t.nudge ? `${t.nudge.top}..${t.nudge.bottom}` : "— not rendered"}   ` +
      (clear
        ? `✓ clears the fade at ${ceiling} (${ceiling - t.nudge.bottom}px of air, ${t.atEnd}px left to scroll)`
        : t.nudge
          ? `✗ ${t.nudge.bottom - ceiling}px under the fade/dock at maximum scroll`
          : "✗ nothing to measure — this probe is not testing what it claims"),
  );
  await page.screenshot({ path: join(SHOTS, `${dev.name.replace(/\s+/g, "-")}-end.png`) });
  await ctx.close();
}

await browser.close();
server.close();

if (failed) {
  console.log(`\n✗ ${failed} failure(s) above — the fold, the end of the flow, or both`);
  process.exit(1);
}
console.log(
  "\n✓ THE STORY SO FAR is above the fold on every device that can hold it," +
    "\n✓ and the end of the flow clears the dock and its fade on all of them",
);
