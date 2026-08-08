#!/usr/bin/env node
/**
 * Per-route JavaScript weight, measured off the artifact — and a budget that
 * fails the build when a route grows past it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `next build` prints a First Load JS table and then forgets it. Nothing stores
 * the numbers, nothing compares them to the last build, and nothing fails. So
 * `/found` — a form that picks a gender, a tier and an industry — reached
 * 329 kB gzipped without a single commit noticing, because no individual commit
 * added very much. That is how every bundle gets heavy: not in one bad decision
 * but in forty reasonable ones with no scale in the room.
 *
 * It reads `.next/app-build-manifest.json` (the route → chunk mapping Next
 * writes for its own client runtime) and gzips each chunk off disk, so the
 * numbers are the transfer sizes a browser actually pays. No dependency: an
 * analyzer that fails to install is an analyzer nobody runs, and this has to
 * work in CI on a cold cache.
 *
 *   node scripts/bundle-report.mjs           # print the table
 *   node scripts/bundle-report.mjs --check   # …and exit 1 if a budget is blown
 *
 * ── On the budgets ──────────────────────────────────────────────────────────
 *
 * They are set a little above where each route stands today, so this lands
 * green and starts catching the NEXT regression rather than demanding a
 * refactor before it can be merged. They are meant to ratchet down as the
 * routes get lighter. Raising one is fine and sometimes right — do it in the
 * commit that needs it, with the reason in the message, which is the entire
 * difference between a budget and a number in a log.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NEXT = join(root, ".next");

/** kB gzipped, First Load JS. `null` = report only, no budget. */
const BUDGETS = {
  "/page": 150,
  // 346, not 342. Two things landed in this chunk, +1.6 kB gzipped between
  // them, measured against the same build of main on the same machine:
  //
  //   · the nudge's native half — the four strings, the two events and the
  //     dismissal state that let UIKit draw the card instead of the DOM, so
  //     that on iOS it is real Liquid Glass above the deck rather than a
  //     CSS impression of it at the bottom of a document
  //   · lib/warm.tsx, which is what stopped every overlay on this screen
  //     paying React's ~300ms Suspense fallback throttle on its first open
  //
  // The second one is why the first is affordable: this chunk got 1.6 kB
  // bigger and every screen it can open got ~295ms faster to appear.
  //
  // The 342 this replaces was itself "342, not 340: the activity sheets became
  // dismissible by their grabber, and the pointer handling that does it lands
  // in this chunk because all five screens share `ScreenSheet`."
  "/play/page": 346,
  "/found/page": 325,
  // The picker is the front door for anyone with a company, so it is on the
  // critical path for every returning player. 320 is a little above where it
  // stands (312) on the same rule as the rest of this table.
  "/islands/page": 320,
  "/welcome/page": 195,
  "/chapter/page": 130,
  "/join/page": 120,
  "/reset/page": 125,
  "/privacy/page": 115,
  "/terms/page": 115,
  "/download/page": 115,
};

const manifestPath = join(NEXT, "app-build-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("No .next/app-build-manifest.json — run `npm run build` first.");
  process.exit(1);
}

const { pages } = JSON.parse(readFileSync(manifestPath, "utf8"));

/** Gzipped size of a built chunk, memoised — chunks are shared across routes. */
const sizeCache = new Map();
function gzSize(rel) {
  if (sizeCache.has(rel)) return sizeCache.get(rel);
  const full = join(NEXT, rel);
  const size = existsSync(full) ? gzipSync(readFileSync(full)).length : 0;
  sizeCache.set(rel, size);
  return size;
}

const rows = Object.entries(pages)
  // Route handlers have no client bundle worth reporting; `/layout` and
  // `/not-found` are not routes a player can be on.
  .filter(([route]) => !route.startsWith("/api/") && route.endsWith("/page"))
  .map(([route, chunks]) => {
    const files = chunks.filter((c) => c.endsWith(".js"));
    return {
      route,
      kb: files.reduce((n, f) => n + gzSize(f), 0) / 1024,
      chunks: files.length,
      budget: BUDGETS[route] ?? null,
    };
  })
  .sort((a, b) => b.kb - a.kb);

const failures = rows.filter((r) => r.budget !== null && r.kb > r.budget);

const w = Math.max(...rows.map((r) => r.route.length));
console.log(`\n  ${"Route".padEnd(w)}  ${"First Load".padStart(11)}  ${"Budget".padStart(8)}  Chunks`);
console.log(`  ${"─".repeat(w)}  ${"─".repeat(11)}  ${"─".repeat(8)}  ──────`);
for (const r of rows) {
  const over = r.budget !== null && r.kb > r.budget;
  const mark = over ? "✗" : r.budget === null ? " " : "·";
  console.log(
    `${mark} ${r.route.padEnd(w)}  ${r.kb.toFixed(1).padStart(8)} kB  ` +
      `${(r.budget === null ? "—" : String(r.budget)).padStart(8)}  ${String(r.chunks).padStart(6)}`,
  );
}

/*
 * The heaviest individual chunks, which is the question you actually have when
 * a route is over: not "how big is it" but "what is in it".
 */
const biggest = [...sizeCache.entries()]
  .filter(([rel]) => rel.endsWith(".js"))
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8);
console.log("\n  Heaviest chunks");
for (const [rel, size] of biggest) {
  const raw = existsSync(join(NEXT, rel)) ? statSync(join(NEXT, rel)).size : 0;
  console.log(
    `    ${(size / 1024).toFixed(1).padStart(7)} kB gz  ` +
      `${(raw / 1024).toFixed(0).padStart(6)} kB raw  ${rel.replace("static/chunks/", "")}`,
  );
}

if (process.argv.includes("--check") && failures.length) {
  console.error(`\n  ✗ ${failures.length} route${failures.length > 1 ? "s" : ""} over budget:`);
  for (const f of failures) {
    console.error(`      ${f.route}  ${f.kb.toFixed(1)} kB > ${f.budget} kB`);
  }
  console.error(
    "\n    Either find what grew (heaviest chunks above), or raise the budget in\n" +
      "    scripts/bundle-report.mjs in this commit, with the reason in the message.\n",
  );
  process.exit(1);
}

console.log("");
