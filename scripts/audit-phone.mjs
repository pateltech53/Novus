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
  //
  // The LAST dialog in document order, not the first: sheets stack now — the
  // legal reader opens over Settings and over the Pro sheet — and they nest,
  // so the first match is the one UNDERNEATH. Taking it scoped the audit to
  // the covered screen and reported its own rows as unreachable, which they
  // are, and are supposed to be.
  const dialogs = document.querySelectorAll('[role="dialog"]');
  const modal = dialogs[dialogs.length - 1] ?? null;
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

  // ── The overlays that are not tabs ────────────────────────────────────────
  //
  // Settings, the Pro sheet and the legal reader open from the masthead rather
  // than the tab bar, so the walk above never touched them — and every control
  // App Review looks for lives in one of the three: account deletion, restore
  // purchases, the privacy policy and the terms. They are also the longest
  // scrolling surfaces in the app, which is exactly where a 320×568 screen
  // gives way. Each is opened from a fresh /play so one sheet's state cannot
  // change what the next one is measured in.
  const overlays = [
    [
      "settings",
      async (p) => {
        await p.click('button[aria-label="Settings"]');
      },
    ],
    [
      "settings-signin",
      async (p) => {
        await p.click('button[aria-label="Settings"]');
        await p.waitForTimeout(420);
        await p.getByRole("button", { name: "Sign in", exact: true }).click();
      },
    ],
    [
      "settings-legal",
      async (p) => {
        await p.click('button[aria-label="Settings"]');
        await p.waitForTimeout(420);
        await p.getByRole("button", { name: "Privacy policy" }).click();
      },
    ],
    [
      "pro",
      async (p) => {
        await p.locator("button").filter({ hasText: /^(FREE|PRO)$/ }).first().click();
      },
    ],
  ];

  for (const [tag, open] of overlays) {
    await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    try {
      await open(page);
    } catch (e) {
      console.log(`  ${name}/${tag}: could not open — ${e.message.split("\n")[0]}`);
      continue;
    }
    await page.waitForTimeout(700);

    const problems = await page.evaluate(AUDIT);
    await page.screenshot({ path: join(SHOTS, `${name}-${tag}.png`), fullPage: false });
    if (problems.length) {
      failures += problems.length;
      console.log(`\n✗ ${name} (${width}px) · ${tag}`);
      for (const p of [...new Set(problems)]) console.log(`    ${p}`);
    } else {
      console.log(`✓ ${name} (${width}px) · ${tag}`);
    }
  }

  await ctx.close();
}

// ── The store-build rule ────────────────────────────────────────────────────
//
// App Store Guideline 3.1.1 and Google Play's Payments policy both say the
// same thing: digital content used inside the app is sold with the store's own
// billing or not at all — and 3.1.3(a) forbids linking out to any other
// purchase mechanism. Novus answers by selling nothing in a store build
// (lib/commerce.ts); Pro is bought on the web and arrives with the account.
//
// That rule is invisible in a browser, which is exactly how it would rot. This
// pass runs the same bundle three times — as a browser, as the iOS shell, as
// the Android shell — by setting the globals `@capacitor/core` reads to decide
// the platform, and asserts the rule in BOTH directions. One-way checks are
// how a gate that returns false everywhere passes its own test while quietly
// taking the checkout button off the web.
const PRICE = /\$\s?\d/;
/**
 * Is there an in-app plan picker on screen?
 *
 * A price alone stopped separating a browser from a store build when the link
 * out to the web started carrying one (lib/commerce.ts). What still separates
 * them is whether a player can CHOOSE a plan and pay for it here.
 *
 * Asked of the DOM rather than of the text, and the difference is not
 * pedantry: the link-out's own price line reads "$39.99 A YEAR · $6.99 A
 * MONTH", so any regex looking for the chips' wording finds the sentence that
 * exists precisely because there are no chips.
 */
const picker = (page) =>
  page.evaluate(() => !!document.querySelector('[aria-label="Billing period"]'));
/** Restore, in either voice — it is a small chip in the app and a row in Settings. */
const RESTORE = /RESTORE PURCHASE|Restore purchase/i;

// The globals @capacitor/core reads to decide the platform (getPlatformId in
// its dist bundle). addInitScript hands the function its `arg`, never `window`,
// so these take none and touch the global directly.
const SHELLS = [
  ["browser", null],
  ["ios", () => { window.webkit = { messageHandlers: { bridge: {} } }; }],
  ["android", () => { window.androidBridge = {}; }],
];

/**
 * Click through onboarding until the plans step is on screen.
 *
 * The accent-filled pill is the call to action on almost every step, but not
 * on all of them: the shark's explanation narrates first and offers only Skip
 * until it finishes, and headless Chromium has no speech synthesis to finish
 * with. So a step with no accent button falls back to whatever ordinary button
 * moves forward, and the walk stops only when there is neither.
 */
const walkToPlans = async (page) => {
  for (let i = 0; i < 20; i++) {
    if (await page.getByText("Free is the whole game").count()) return true;

    const input = page.locator("input:visible").first();
    if ((await input.count()) && !(await input.inputValue())) {
      const numeric = (await input.getAttribute("inputmode")) === "numeric";
      await input.fill(numeric ? "17" : "Zach");
      await page.waitForTimeout(240);
    }

    const cta = page.locator('button[class*="bg-[var(--action)]"]:not([disabled])');
    if (await cta.count()) {
      await cta.first().click().catch(() => {});
    } else {
      const alt = page
        .locator("button:visible")
        .filter({ hasText: /skip|next|continue|ready|show me|what is novus/i })
        .first();
      if (!(await alt.count())) return false;
      await alt.click().catch(() => {});
    }
    await page.waitForTimeout(560);
  }
  return false;
};

for (const [shell, inject] of SHELLS) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("novus:theme:v1", "dark"));
  if (inject) await page.addInitScript(inject);

  const sells = shell === "browser";
  const problems = [];
  const want = (condition, complaint) => { if (!condition) problems.push(complaint); };

  // ── "/" belongs to the web ───────────────────────────────────────────────
  //
  // The shell is pointed at /boot.html, so a store build should never render
  // the marketing page — it carries a WebGL scene and an account gate whose
  // CONTINUE AS has no business inside an app. Configuration can fail to
  // apply; this checks the behaviour rather than the setting.
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const onLanding = await page.evaluate(() => location.pathname === "/");
  want(onLanding === sells, sells
    ? "the browser does not render the landing page at /"
    : `the ${shell} build sits on the marketing page at /`);

  // ── The onboarding plans step: what a first cold start opens on ──────────
  await page.goto(`http://127.0.0.1:${PORT}/welcome/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  if (!(await walkToPlans(page))) {
    problems.push("could not reach the plans step");
  } else {
    await page.waitForTimeout(400);
    const text = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: join(SHOTS, `shell-${shell}-plans.png`) });

    // A price is fine everywhere now: a store build states what Pro costs on
    // the link that leaves for the browser. What may not be here is a way to
    // PAY — the plan chips and the checkout button that opens Stripe.
    want(PRICE.test(text), "no price on the plans step");
    want((await picker(page)) === sells, sells
      ? "no plan picker in a browser"
      : `a plan picker is on the plans step in the ${shell} build`);
    want(text.includes("CHOOSE PRO") === sells, sells
      ? "no CHOOSE PRO in a browser"
      : `CHOOSE PRO is in the ${shell} build`);
    want(text.includes("TERMS OF USE") && text.includes("PRIVACY"),
      "the plans step is missing its terms/privacy links");
    want(text.includes("CONTINUE FREE"), "no way past the plans step");
    if (!sells) {
      want(text.includes("GET PRO"), `no way to buy Pro at all in the ${shell} build`);
      want(text.includes("opens your browser"),
        `the ${shell} build does not say where the payment happens`);
    }
  }

  // ── The in-game Pro sheet ────────────────────────────────────────────────
  await page.evaluate((s) => {
    localStorage.setItem("novus:run:v1", JSON.stringify(s.run));
    localStorage.setItem("novus:profile:v1", JSON.stringify(s.profile));
  }, seed);
  await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator("button").filter({ hasText: /^(FREE|PRO)$/ }).first().click();
  await page.waitForTimeout(700);

  const sheet = await page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    return dialogs[dialogs.length - 1]?.innerText ?? "";
  });
  await page.screenshot({ path: join(SHOTS, `shell-${shell}-pro.png`) });

  want(sheet.length > 0, "the Pro sheet did not open");
  want(PRICE.test(sheet), "no price in the Pro sheet");
  want((await picker(page)) === sells, sells
    ? "no plan picker in the Pro sheet in a browser"
    : `a plan picker is in the Pro sheet in the ${shell} build`);
  want(sheet.includes("CHOOSE PRO") === sells, sells
    ? "no CHOOSE PRO in the Pro sheet in a browser"
    : `CHOOSE PRO is in the Pro sheet in the ${shell} build`);
  if (!sells) {
    want(sheet.includes("GET PRO"), `no way to buy Pro from the Pro sheet in the ${shell} build`);
    want(sheet.includes("opens your browser"),
      `the Pro sheet does not say where the payment happens in the ${shell} build`);
  }
  // Required on every platform. It is how a purchase made anywhere — and in a
  // store build every purchase is made somewhere else — reaches this device.
  want(RESTORE.test(sheet), "the Pro sheet has no Restore");
  want(sheet.includes("TERMS OF USE") && sheet.includes("PRIVACY"),
    "the Pro sheet is missing its terms/privacy links");

  // ── The upgrade screen ───────────────────────────────────────────────────
  // Six refused gates open this one, which makes it the most reachable pricing
  // surface in the app and the one a reviewer is most likely to find. Reached
  // here through the talent-pool gate on the team tab.
  await page.goto(`http://127.0.0.1:${PORT}/play/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const team = page
    .locator('nav[aria-label="Activities"] button')
    .filter({ hasText: /^team$/i });
  if (await team.count()) {
    await team.first().click();
    await page.waitForTimeout(650);
    const gate = page
      .locator("button")
      .filter({ hasText: "More candidates in the pool" })
      .first();
    if (await gate.count()) {
      await gate.click();
      await page.waitForTimeout(700);

      const upgrade = await page.evaluate(() => {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        return dialogs[dialogs.length - 1]?.innerText ?? "";
      });
      await page.screenshot({ path: join(SHOTS, `shell-${shell}-upgrade.png`) });

      want(upgrade.includes("KEEP PLAYING FREE"), "the upgrade screen did not open");
      want(PRICE.test(upgrade), "no price on the upgrade screen");
      // GET PRO is on both, and means two different things: in a browser it
      // opens Stripe, in a store build it opens Safari. The chips are what
      // separate them — an in-app plan picker only exists where checkout does.
      want(upgrade.includes("GET PRO"), "no GET PRO on the upgrade screen");
      want((await picker(page)) === sells, sells
        ? "no plan picker on the upgrade screen in a browser"
        : `a plan picker is on the upgrade screen in the ${shell} build`);
      if (!sells) {
        want(upgrade.includes("opens your browser"),
          `the upgrade screen does not say where the payment happens in the ${shell} build`);
      }
      want(RESTORE.test(upgrade), "the upgrade screen has no Restore");
      want(upgrade.includes("TERMS OF USE") && upgrade.includes("PRIVACY"),
        "the upgrade screen is missing its terms/privacy links");
    } else {
      problems.push("could not reach the talent-pool gate");
    }
  } else {
    problems.push("no team tab");
  }

  if (problems.length) {
    failures += problems.length;
    console.log(`\n✗ store rule · ${shell}`);
    for (const p of [...new Set(problems)]) console.log(`    ${p}`);
  } else {
    console.log(`✓ store rule · ${shell}${sells ? " (sells)" : " (sells nothing)"}`);
  }
  await ctx.close();
}

console.log(`\n${failures} finding(s). Screenshots in ${SHOTS}/`);
await browser.close();
server.close();
process.exit(failures > 0 ? 1 : 0);
