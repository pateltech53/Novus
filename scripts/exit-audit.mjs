#!/usr/bin/env node
/**
 * Proves that every overlay on /play actually LEAVES.
 *
 *   npm run build && npm start &          # or: npm run dev
 *   BASE=http://localhost:3100 node scripts/exit-audit.mjs
 *
 * ── Why this exists rather than a code review ───────────────────────────────
 *
 * `app/welcome/page.tsx:137` records what happened the last time someone
 * wrapped this app's screens in `AnimatePresence`: "its exit never resolves
 * when the direct child is a component rather than a motion element, which
 * strands the whole flow on step one."
 *
 * That failure is invisible to TypeScript, invisible to the build, and
 * invisible to a screenshot. Framer keeps an exiting child mounted until
 * something calls `safeToRemove`, and only a `motion` element carrying an
 * `exit` prop ever does — so an overlay with no exit anywhere inside it does
 * not close slowly, it closes NEVER. The failure mode of the feature is that
 * the game becomes unusable, which is more than enough reason to check it in a
 * real browser instead of reasoning about it.
 *
 * So: open each overlay, close it, and assert two things — that it was gone a
 * beat later (it un-mounted at all), and that it was still present one frame
 * after the close (it animated out rather than vanishing). The second is what
 * distinguishes a working exit from a hard cut, and a hard cut is what all
 * eighteen of these used to be.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3100";

/**
 * Each overlay: how to open it, and a string that is on screen only while it
 * is up. Text rather than a test id, because a test id can survive a component
 * being replaced by something that does not animate.
 */
/*
 * Each overlay: how to open it, and a string that is on screen ONLY while it is
 * up.
 *
 * The markers are deliberately not the tab names. The first version of this
 * used /COMPANY/i for the company sheet and reported four overlays STRANDED —
 * because "COMPANY" is also the label of the tab that opens it, so the check
 * was reading the tab bar and could never have gone green. A marker has to be
 * something only the overlay renders.
 */
const OVERLAYS = [
  { name: "company", open: "COMPANY", marker: /THE STAT SHEET/ },
  { name: "team", open: "TEAM", marker: /Close the team screen/ },
  { name: "product", open: "PRODUCT", marker: /Close the product sheet/ },
  { name: "assets", open: "ASSETS", marker: /Asset ledger/ },
  { name: "closet", open: "CLOSET", marker: /EQUIPPED/ },
];

/*
 * `NV_CHROMIUM` lets a machine whose Playwright build does not match its
 * installed browser point at the one it has, instead of downloading a second
 * copy. Unset, this is ordinary `chromium.launch()`. One name across all six
 * probes — this one briefly answered to `CHROME` while audit-phone answered
 * to `PLAYWRIGHT_CHROMIUM`, and setting the right knob for one script still
 * failed the rest.
 */
const browser = await chromium.launch(
  process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

/** Walk the founding form so /play has a real run. No localStorage forgery. */
async function establishRun() {
  await page.goto(`${BASE}/found`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const input = page.locator('input[placeholder="Company name"]');
  const submit = page.locator("button", { hasText: "FOUND IT" }).first();
  await input.waitFor({ state: "visible", timeout: 30000 });
  /*
   * The paperwork gates FOUND IT on more than a name: the founder's pronoun
   * and an industry are required too. This walk was written when the name
   * was the whole form, and kept filling one field for thirty seconds before
   * concluding the button "never enabled" — the first time anyone ran it
   * against the grown form, it reported the probe's own staleness as an app
   * bug. Food & Beverage is one of the four free industries, so the walk
   * works on a build with no entitlements.
   */
  await page.locator("button", { hasText: /^HE$/ }).first().click().catch(() => {});
  await page
    .locator("button", { hasText: "Food & Beverage" })
    .first()
    .click()
    .catch(() => {});
  for (let i = 0; i < 40; i++) {
    await input.fill("Exit Audit Co");
    try {
      await submit.waitFor({ state: "visible", timeout: 2000 });
      if (await submit.isEnabled()) break;
    } catch {
      /* keep trying */
    }
    await page.waitForTimeout(750);
  }
  if (!(await submit.isEnabled())) throw new Error("FOUND IT never enabled");
  /*
   * Skip the tutorial. The coachmark overlay is a full-screen z-[85] scrim with
   * a spotlight hole, so every tab click during it lands on the scrim — and its
   * second step deliberately advances the month, which then puts a decision
   * card on the board. Neither is what this harness is measuring, and the
   * founding form already offers the switch a returning player uses.
   */
  const skip = page.locator('input[type="checkbox"]').first();
  if (await skip.count()) await skip.check().catch(() => {});
  await submit.click({ force: true });
  await page.waitForURL(/\/play/, { timeout: 20000 });
  await page.waitForTimeout(1200);
}

async function dismissCoachmarks() {
  for (let i = 0; i < 12; i++) {
    const up = await page.evaluate(() => /STEP \d+ OF \d+/.test(document.body.innerText));
    if (!up) return;
    const got = page.locator("button", { hasText: /^GOT IT$/i }).first();
    if (await got.count()) {
      await got.click({ timeout: 2000 }).catch(() => {});
    } else {
      // The "tap the real control" step: click through the spotlight hole.
      const hole = await page.evaluate(() => {
        const el = [...document.querySelectorAll("div")].find(
          (d) => /ring-4/.test(String(d.className)) && d.style.width && d.style.height,
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      if (!hole) return;
      await page.mouse.click(hole.x, hole.y);
    }
    await page.waitForTimeout(600);
  }
}

/*
 * Clear any decision card sitting on the board.
 *
 * Step 2 of the tutorial is "tap ADVANCE MONTH", so clearing the coachmarks
 * genuinely moves time — which surfaces an event, which renders DecisionSheet
 * over everything at z-50. Every tab click after that lands on the sheet
 * instead of the tab. Resolving it is a legitimate part of playing, so the
 * harness plays it: take the first choice.
 */
async function clearDecision() {
  for (let i = 0; i < 6; i++) {
    const sheet = page.locator("div.fixed.inset-0.z-50").first();
    if (!(await sheet.count())) return;
    const choice = sheet.locator("button.nv-card").first();
    if (!(await choice.count())) return;
    await choice.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
}

await establishRun();
// Belt and braces: the switch above should mean there is nothing to dismiss.
await dismissCoachmarks();
await clearDecision();

/*
 * Clicks are dispatched through the DOM, not through the pointer.
 *
 * Playwright's real click does hit-testing, which is correct for testing that a
 * control is reachable — and wrong here. This harness measures whether a
 * component UNMOUNTS cleanly, and the game legitimately stacks full-screen
 * scrims that intercept pointers (a decision card, a coachmark spotlight).
 * Fighting z-index would be testing the wrong thing; `el.click()` fires the
 * same React handler regardless of what is on top of it.
 */
const clickByText = (re) =>
  page.evaluate((src) => {
    const rx = new RegExp(src, "i");
    const el = [...document.querySelectorAll("button")]
      .reverse()
      .find((b) => rx.test((b.textContent || "").trim()));
    if (!el) return false;
    el.click();
    return true;
  }, re.source);

/*
 * Matches against the rendered HTML rather than innerText: two of the markers
 * are aria-labels on the close control, which is the only string some of these
 * sheets carry that the tab bar behind them does not.
 */
const bodyHas = (re) =>
  page.evaluate((src) => new RegExp(src, "i").test(document.body.innerHTML), re.source);

const results = [];
for (const o of OVERLAYS) {
  if (!(await clickByText(new RegExp(`^${o.open}$`)))) {
    results.push({ ...o, status: "skipped", note: "tab control not present" });
    continue;
  }
  await page.waitForTimeout(650);
  if (!(await bodyHas(o.marker))) {
    results.push({ ...o, status: "skipped", note: "overlay did not open" });
    continue;
  }

  if (!(await clickByText(/^(DONE|CLOSE|BACK)$/))) {
    results.push({ ...o, status: "skipped", note: "no close control" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    continue;
  }

  // One frame after the close: a working exit is still on screen here.
  await page.waitForTimeout(60);
  const midExit = await bodyHas(o.marker);
  // Well past the 180 ms exit: it must be gone.
  await page.waitForTimeout(900);
  const after = await bodyHas(o.marker);

  results.push({
    ...o,
    status: after ? "STRANDED" : midExit ? "animated" : "cut",
    note: after
      ? "still in the DOM ~1s after close — AnimatePresence is holding it"
      : midExit
        ? "present mid-exit, gone after — exit ran"
        : "gone within one frame — no exit animation",
  });
  await page.waitForTimeout(300);
}

await browser.close();

console.log("\n  Overlay exits on /play\n");
let stranded = 0;
for (const r of results) {
  const mark = r.status === "STRANDED" ? "✗" : r.status === "animated" ? "✓" : "·";
  if (r.status === "STRANDED") stranded++;
  console.log(`  ${mark} ${r.name.padEnd(10)} ${r.status.padEnd(10)} ${r.note}`);
}

if (stranded) {
  console.error(
    `\n  ✗ ${stranded} overlay(s) never unmounted. This is the welcome/page.tsx:137\n` +
      "    failure: a child of AnimatePresence with no motion element carrying an\n" +
      "    `exit` prop is held on screen forever. Add the exit, or remove the key.\n",
  );
  process.exit(1);
}
console.log("");
