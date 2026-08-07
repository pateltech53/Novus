#!/usr/bin/env node
/**
 * Renders /islands with N companies and checks two things the eye is bad at:
 *   · does any island's box intersect the header's box?
 *   · when the water is longer than the screen, is the hint on screen?
 * Also shoots each case.
 */
import { chromium } from "playwright";
import http from "node:http";
import { register } from "node:module";
import { readFile, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

const REPO = "/home/user/Novus";
const ROOT = join(REPO, "out");
const PORT = 4717;
const SHOTS = process.env.NV_SHOTS ?? "/tmp/islands";
const DEV = { w: 393, h: 852, top: 59, bottom: 34 };

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp3": "audio/mpeg",
  ".mp4": "video/mp4", ".glb": "model/gltf-binary", ".txt": "text/plain",
  ".wasm": "application/wasm", ".mjs": "text/javascript",
};
const server = http.createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const cands = /\.[a-z0-9]+$/i.test(p) ? [join(ROOT, p)] : [join(ROOT, p, "index.html"), join(ROOT, `${p}.html`)];
  for (const f of cands) {
    try {
      await stat(f);
      res.writeHead(200, { "content-type": TYPES[f.slice(f.lastIndexOf("."))] ?? "application/octet-stream" });
      res.end(await readFile(f));
      return;
    } catch {}
  }
  res.writeHead(404).end("not found");
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

register(join(REPO, "scripts/ts-loader.mjs"), import.meta.url);
const { createRun } = await import(join(REPO, "lib/engine/run.ts"));

/** N saved companies, slot 0..N-1, with names long enough to wrap the title. */
const makeIslands = (n) =>
  Array.from({ length: n }, (_, slot) => {
    const run = createRun({
      founderName: "Zach", playerAge: 17, companyName: `Company ${slot + 1}`,
      industry: "FOOD", rookieMode: true, tutorial: false, gender: "male",
    });
    run.id = `run-${slot}`;
    return { slot, run };
  });

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.NV_CHROMIUM ? { executablePath: process.env.NV_CHROMIUM } : {}),
  args: ["--enable-unsafe-swiftshader"],
});

const CHECK = () => {
  const header = document.querySelector("header");
  const hb = header?.getBoundingClientRect();
  const hint = [...document.querySelectorAll("span")].find((s) =>
    /MORE OVER THERE|BACK THAT WAY/.test(s.textContent || ""),
  );
  const boat = document.querySelector("svg[data-boat], .nv-bob");
  const islands = [...document.querySelectorAll("button")]
    .filter((b) => b.className.includes("nv-press") && b.querySelector(".nv-bob, span"))
    .map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 22),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
      };
    })
    .filter((i) => i.bottom > i.top);
  const hits = hb
    ? islands.filter((i) => i.top < hb.bottom && i.bottom > hb.top && i.right > hb.left && i.left < hb.right)
    : [];
  const scroller = document.querySelector(".nv-noscrollbar");
  return {
    headerBottom: hb ? Math.round(hb.bottom) : null,
    islands: islands.length,
    overlaps: hits.map((h) => `${h.text} [${h.top}..${h.bottom}]`),
    hint: hint ? (hint.textContent || "").trim() : null,
    scroll: scroller
      ? { w: Math.round(scroller.clientWidth), sw: Math.round(scroller.scrollWidth) }
      : null,
    signOut: [...document.querySelectorAll("button")].some((b) => /SIGN OUT/.test(b.textContent || "")),
  };
};

let bad = 0;
for (const n of [1, 2, 3, 8, 14]) {
  const ctx = await browser.newContext({
    viewport: { width: DEV.w, height: DEV.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.addInitScript((data) => {
    localStorage.setItem("novus:theme:v1", "dark");
    localStorage.setItem("novus:account:v1", JSON.stringify({
      displayName: "Zach", email: "zach@example.com", createdAtISO: "2026-01-01T00:00:00.000Z",
    }));
    localStorage.setItem("novus:profile:v1", JSON.stringify({
      founderName: "Zach", playerAge: 17, rookieMode: true, onboarded: true, micCalibration: null,
    }));
    for (const { slot, run } of data) localStorage.setItem(`novus:run:v1:${slot}`, JSON.stringify(run));
    localStorage.setItem("novus:island:v1", "0");
  }, makeIslands(n));
  await page.addInitScript(({ top, bottom }) => {
    const s = document.createElement("style");
    s.textContent = `:root{--nv-safe-top:calc(${top}px + 0.75rem);--nv-safe-bottom:calc(${bottom}px + 0.5rem);}`;
    const go = () => document.head.appendChild(s);
    if (document.head) go(); else document.addEventListener("DOMContentLoaded", go);
  }, DEV);

  await page.goto(`http://127.0.0.1:${PORT}/islands/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const r = await page.evaluate(CHECK);
  const ok = r.overlaps.length === 0;
  if (!ok) bad++;
  console.log(`\n── ${n} island${n === 1 ? "" : "s"} ──`);
  console.log(`  header bottom ${r.headerBottom}   islands drawn ${r.islands}   sign out ${r.signOut ? "✓" : "✗"}`);
  console.log(`  water ${r.scroll ? `${r.scroll.w} visible / ${r.scroll.sw} wide` : "—"}   hint ${r.hint ?? "none"}`);
  console.log(ok ? "  ✓ nothing under the header" : `  ✗ OVERLAP: ${r.overlaps.join(" | ")}`);
  await page.screenshot({ path: join(SHOTS, `islands-${String(n).padStart(2, "0")}.png`) });
  if (r.scroll && r.scroll.sw > r.scroll.w + 40) {
    await page.evaluate(() => {
      const el = document.querySelector(".nv-noscrollbar");
      if (el) el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(500);
    const r2 = await page.evaluate(CHECK);
    console.log(`  scrolled to the end → hint ${r2.hint ?? "none"}`);
    await page.screenshot({ path: join(SHOTS, `islands-${String(n).padStart(2, "0")}-end.png`) });
  }
  await ctx.close();
}
await browser.close();
server.close();
if (bad) { console.log(`\n✗ ${bad} case(s) overlap the header`); process.exit(1); }
console.log("\n✓ no island overlaps the header at any count");
