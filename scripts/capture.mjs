#!/usr/bin/env node
/**
 * Visual gate harness. Screenshots every route across the responsive floor and
 * runs the §3.4 anti-slop gates as measurements, not assertions.
 *
 *   node scripts/capture.mjs                    → docs/baseline-shots/
 *   node scripts/capture.mjs docs/shots-p1      → anywhere else, to diff
 *   BASE=http://localhost:3100 node scripts/capture.mjs
 *
 * Writes <route>@<width>.png plus report.json (the gate table for every
 * route × width) and report.md (the same, readable).
 *
 * Exits non-zero if a CI-critical gate fails (§A.5): horizontal scroll at
 * 320px, or any text below 12px.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = join(root, process.argv[2] ?? "docs/baseline-shots");

const AUDIT = readFileSync(join(root, "docs/gate-audit.js"), "utf8");

/** Baseline PNGs at these two, per §4.1. */
const SHOT_WIDTHS = [
  { w: 375, h: 812 },
  { w: 1280, h: 800 },
];
/**
 * The responsive floor from §3.4, plus the two widths §4.2 names explicitly
 * (390 = iPhone 14/15 logical width, 1920 = the desktop case §5.4 cares about).
 */
const AUDIT_WIDTHS = process.env.WIDTHS
  ? process.env.WIDTHS.split(",").map(Number)
  : [320, 375, 390, 414, 768, 1280, 1920];

const ROUTES = [
  { path: "/welcome", name: "welcome", needsRun: false },
  { path: "/found", name: "found", needsRun: false },
  // The tutorial overlay is a real screen a new player sees, so it gets its own
  // baseline — but it must not be what /play is measured on. Its own CTA and
  // "STEP n OF 4" label are orange, which would inflate the accent count by two
  // and hide whether the steady-state screen is compliant.
  { path: "/play", name: "play-coachmarks", needsRun: true, keepCoachmarks: true },
  { path: "/play", name: "play", needsRun: true },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(
  // Same escape hatch as every probe: a machine whose Playwright build does
  // not match its installed browser points at the one it has.
  process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {},
);
const results = [];
let ciFailures = [];

/**
 * Walk the founding form so /play has a real run. No localStorage forgery.
 *
 * The fill has to survive hydration. `domcontentloaded` fires before React
 * attaches, so a fill that lands too early sets the DOM value without ever
 * firing onChange — the controlled input's state stays empty and FOUND IT
 * stays disabled. So: fill, then wait for the button to actually enable, and
 * retry the fill if it did not take.
 */
async function establishRun(page) {
  await page.goto(`${BASE}/found`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const input = page.locator('input[placeholder="Company name"]');
  const submit = page.locator("button", { hasText: "FOUND IT" }).first();
  await input.waitFor({ state: "visible", timeout: 30000 });

  // Generous budget: a cold `next dev` compiles this route on first request,
  // so hydration can be several seconds behind domcontentloaded. Re-filling is
  // cheap and idempotent; giving up early is what produced a false
  // "the form is not wired" failure.
  for (let attempt = 0; attempt < 40; attempt++) {
    await input.fill("Baseline Co");
    try {
      await submit.waitFor({ state: "visible", timeout: 2000 });
      if (await submit.isEnabled()) break;
    } catch {
      /* keep trying */
    }
    await page.waitForTimeout(750);
  }
  if (!(await submit.isEnabled())) {
    throw new Error("FOUND IT never enabled — the form did not hydrate, or the name field is not wired");
  }

  await submit.click();
  await page.waitForURL(/\/play/, { timeout: 20000 });
  await page.waitForTimeout(800);
}

/**
 * Clear the 4-step FIRST_RUN_STEPS tutorial by playing it, not by forging state.
 *
 * The two step modes need different handling, which is why a naive
 * "click every GOT IT" loop silently stalls on step 2:
 *
 *   mode "ack"  (books, tabs, phone) → a real GOT IT button, stopPropagation'd
 *   mode "tap"  (advance)            → NO button. The player must hit the
 *                                      spotlighted control itself. The overlay
 *                                      spans inset-0 and its onClick tests
 *                                      whether the pointer landed inside the
 *                                      hole, so the click has to go through the
 *                                      hole's coordinates — clicking the button
 *                                      node directly does not advance the step.
 *
 * Step 2 therefore has a real side effect: it advances the fiscal month.
 * Returns the number of steps cleared so a stall is visible rather than silent.
 */
async function dismissCoachmarks(page) {
  let cleared = 0;
  for (let i = 0; i < 10; i++) {
    const up = await page.evaluate(() => /STEP \d+ OF \d+/.test(document.body.innerText));
    if (!up) break;

    // The overlay mounts, then measures its target on a 200ms interval, so a
    // step can be on screen a beat before its button or spotlight ring exists.
    // Sampling once here reads as "no control found" and aborts the whole run.
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("button")].some((b) => /^GOT IT$/i.test(b.textContent.trim())) ||
          [...document.querySelectorAll("div")].some(
            (d) => /ring-4/.test(String(d.className)) && d.style.width && d.style.height,
          ),
        undefined,
        { timeout: 2500 },
      )
      .catch(() => {});

    const ack = page.getByRole("button", { name: /^GOT IT$/i }).first();
    if (await ack.count()) {
      // noWaitAfter: the click mutates React state without navigating, but
      // Playwright's default post-click "waiting for scheduled navigations"
      // intermittently times out here even though the click already landed.
      try {
        await ack.click({ timeout: 5000, noWaitAfter: true });
      } catch {
        await ack.dispatchEvent("click").catch(() => {});
      }
    } else {
      // "tap" step — click the centre of the spotlight ring.
      const hole = await page.evaluate(() => {
        const ring = [...document.querySelectorAll("div")].find(
          (d) => /ring-4/.test(d.className) && d.style.width && d.style.height,
        );
        if (!ring) return null;
        const r = ring.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!hole) break;
      await page.mouse.click(hole.x, hole.y);
    }
    cleared++;
    await page.waitForTimeout(450);
  }

  // Deliberately NO reload here. Tutorial completion is not persisted to the
  // saved run, so navigating to /play again restarts the coachmarks at step 1 —
  // a reload would undo the dismissal we just performed. Worth noting as a
  // save-state gap in its own right (cf. spec 12.1, resume mid-year/mid-card).
  await page.waitForTimeout(400);

  const stillUp = await page.evaluate(() => /STEP \d+ OF \d+/.test(document.body.innerText));
  // Reported, not thrown. The assertion earned its place — it caught a version
  // that silently measured /play on the tutorial overlay — but aborting kills
  // all 28 route×width audits over one screen that did not settle. The row
  // carries the flag instead, so a bad measurement is visible rather than
  // either hidden or fatal.
  return { cleared, tutorialStillUp: stillUp };
}

for (const { w, h } of [...SHOT_WIDTHS, ...AUDIT_WIDTHS.map((w) => ({ w, h: 900 }))]) {
  const isShotWidth = SHOT_WIDTHS.some((s) => s.w === w && s.h === h);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  const page = await ctx.newPage();
  await page.addInitScript(AUDIT);

  let runReady = false;
  let coachmarksCleared = null;
  let tutorialStillUp = false;
  for (const route of ROUTES) {
    if (route.needsRun) {
      if (!runReady) {
        await establishRun(page);
        runReady = true;
      } else {
        await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(400);
      }
      if (!route.keepCoachmarks) {
        let d = await dismissCoachmarks(page);
        // One retry from a fresh navigation: tutorial state is not persisted,
        // so a reload restarts it cleanly rather than resuming mid-step.
        if (d.tutorialStillUp && d.cleared === 0) {
          await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForTimeout(1200);
          d = await dismissCoachmarks(page);
        }
        coachmarksCleared = d.cleared;
        tutorialStillUp = d.tutorialStillUp;
      }
    } else {
      await page.goto(`${BASE}${route.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    }

    // In real headless, visibilityState is "visible", so Framer entrance
    // animations do run — unlike the in-app browser pane, where rAF is
    // throttled and they never finish. Verify rather than assume, and settle
    // only if several elements are genuinely stuck (one or two decorative
    // sub-opacity elements are normal and must not trigger a blanket override).
    await page.waitForSelector("main, body > div", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1400);
    const vis = await page.evaluate(() => document.visibilityState);
    const settled = await page.evaluate(() => {
      const stuck = [...document.querySelectorAll("[style]")].filter(
        (e) => e.style.opacity !== "" && parseFloat(e.style.opacity) < 0.98,
      ).length;
      const didSettle = stuck > 2;
      if (didSettle) __novusSettle();
      return { visibilityState: document.visibilityState, stuckBeforeSettle: stuck, didSettle };
    });

    if (isShotWidth) {
      await page.screenshot({ path: join(OUT, `${route.name}@${w}.png`), fullPage: false });
    }

    const audit = await page.evaluate(() => __novusGateAudit());
    results.push({ route: route.name, path: route.path, width: w, height: h, coachmarksCleared, tutorialStillUp, ...settled, audit });

    if (w === 320 && !audit.horizontalScroll.pass) {
      ciFailures.push(`${route.path} @320: horizontal scroll (${audit.horizontalScroll.scrollWidth}px)`);
    }
    if (!audit.textUnder12px.pass) {
      ciFailures.push(`${route.path} @${w}: ${audit.textUnder12px.count} elements under 12px (min ${audit.textUnder12px.min}px)`);
    }
  }
  await ctx.close();
}

await browser.close();

writeFileSync(join(OUT, "report.json"), JSON.stringify(results, null, 2));

// Readable table.
const g = (r, k) => (r.audit[k] ? (r.audit[k].pass === undefined ? "—" : r.audit[k].pass ? "pass" : `FAIL ${r.audit[k].count ?? ""}`.trim()) : "—");
let md = `# Gate report\n\nCaptured against ${BASE} · deviceScaleFactor 2 · colorScheme dark\n\n`;
md += `| route | w | h-scroll | <12px | accent | grads | wrap labels | italic h | glass | canvas |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  md += `| ${r.route} | ${r.width} | ${g(r, "horizontalScroll")} | ${g(r, "textUnder12px")} | ${g(r, "accentUses")} | ${g(r, "gradients")} | ${g(r, "wrappingLabels")} | ${g(r, "italicHeadings")} | ${r.audit.glass.count} | ${r.audit.canvases} |\n`;
}
md += `\n## Framer settle\n\n`;
md += `| route | w | visibilityState | stuck pre-settle | tutorial |\n|---|---|---|---|---|\n`;
for (const r of results) md += `| ${r.route} | ${r.width} | ${r.visibilityState} | ${r.stuckBeforeSettle} | ${r.tutorialStillUp ? "⚠️ overlay up" : "-"} |\n`;
writeFileSync(join(OUT, "report.md"), md);

console.log(`\n${results.length} route×width audits → ${OUT}`);
console.log(md.split("\n## Framer settle")[0]);

if (ciFailures.length) {
  console.error(`\n✗ ${ciFailures.length} CI-critical gate failures:`);
  for (const f of [...new Set(ciFailures)]) console.error(`   ${f}`);
  process.exit(1);
}
console.log("\n✓ CI-critical gates pass");
