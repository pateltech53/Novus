#!/usr/bin/env node
/**
 * Wardrobe skin pipeline.
 *
 * Takes the hand-drawn wardrobe renders in .assets-staging, keys out their
 * studio backgrounds, trims, and writes web-sized webp to public/founder/skins.
 *
 *   node scripts/make-skins.mjs [sourceDir]
 *
 * Same keying as scripts/make-characters.mjs, for the same reason: the
 * characters contain the background colour (whites on the chef, white soles,
 * teeth), so a threshold pass punches holes through the subject. Alpha comes
 * from a border-seeded flood fill instead — only background CONNECTED to the
 * edge is background — gated by local gradient so the fill stops dead at the
 * drawn outline, then eroded one pixel to kill the light fringe that would
 * halo on the app's dark surfaces.
 *
 * Source files are read from .assets-staging and never modified.
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] ?? join(root, ".assets-staging");
const { default: sharp } = await import("sharp");

/**
 * Skin art, both genders. Output names match lib/engine/wardrobe.ts skinSrc:
 * <skin>-<gender>.webp. The source names are the artist's own, quirks intact.
 */
const SKINS = [
  { src: "chefboy.jpg", out: "chef-male" },
  { src: "chefgirl.jpg", out: "chef-female" },
  { src: "codingboy.png", out: "coder-male" },
  { src: "codinggirl.png", out: "coder-female" },
  { src: "gamerboy.png", out: "gamer-male" },
  { src: "gamergirl.jpg", out: "gamer-female" },
  { src: "gymbro.jpg", out: "gymbro-male" }, // the boy has no suffix
  { src: "gymbro girl.png", out: "gymbro-female" }, // note: space in the filename
  { src: "mathgeniusboy.png", out: "mathgenius-male" },
  { src: "mathgeniusgirl.jpg", out: "mathgenius-female" },
  { src: "drippedoutboy.jpg", out: "drippedout-male" },
  { src: "drippedoutgirl.jpg", out: "drippedout-female" },
];

/**
 * Alpha from a border-seeded flood fill. Lifted from make-characters.mjs —
 * see that file for the full rationale on each stage.
 * Returns the same RGBA buffer with background pixels zeroed.
 */
function keyOutBackground(data, w, h, { tolerance = 34, feather = 0.7, edge = 16 } = {}) {
  const isBg = new Uint8Array(w * h);
  const stack = [];

  // Sample the actual corner colour rather than assuming white — several of
  // these are JPEGs, where "white" wobbles a few levels around 250.
  const at = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const [br, bg_, bb] = at(0);
  const near = (i) => {
    const [r, g, b] = at(i);
    return Math.abs(r - br) <= tolerance && Math.abs(g - bg_) <= tolerance && Math.abs(b - bb) <= tolerance;
  };

  // Local gradient magnitude. The fill refuses to cross a strong edge, so it
  // floods flat background and stops at the drawn outline even where the
  // garment is within tolerance of the backdrop (chef whites on white).
  const grad = (i) => {
    const x = i % w, y = (i / w) | 0;
    if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return 0;
    let m = 0;
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      const [r, g, b] = at(j), [r0, g0, b0] = at(i);
      m = Math.max(m, Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0));
    }
    return m;
  };

  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }

  while (stack.length) {
    const i = stack.pop();
    if (isBg[i] || !near(i)) continue;
    isBg[i] = 1;
    // Mark the outline background (tight silhouette) but do not expand past it.
    if (grad(i) > edge) continue;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  // Hard alpha first.
  for (let i = 0; i < w * h; i++) if (isBg[i]) data[i * 4 + 3] = 0;

  // Erode one pixel: the outermost kept ring is part backdrop, and on the dark
  // app ground that ring reads as a halo tracing the whole silhouette.
  {
    const grow = new Uint8Array(isBg);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (isBg[i]) continue;
        if (isBg[i - 1] || isBg[i + 1] || isBg[i - w] || isBg[i + w]) {
          grow[i] = 1;
          data[i * 4 + 3] = 0;
        }
      }
    }
    isBg.set(grow);
  }

  // One soft pass so the cut edge is not a staircase.
  if (feather > 0) {
    const copy = new Uint8Array(isBg);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (copy[i]) continue;
        let n = 0;
        if (copy[i - 1]) n++;
        if (copy[i + 1]) n++;
        if (copy[i - w]) n++;
        if (copy[i + w]) n++;
        if (n) data[i * 4 + 3] = Math.max(0, 255 - n * 64 * feather);
      }
    }
  }
  return data;
}

// NB: not `process` — that shadows Node's global and breaks process.argv.
async function processSkin(srcPath, outBase) {
  const img = sharp(srcPath).ensureAlpha();
  const { width, height } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });

  keyOutBackground(data, width, height);

  const keyed = sharp(data, { raw: { width, height, channels: 4 } });
  const outDir = join(root, "public", "founder", "skins");
  mkdirSync(outDir, { recursive: true });

  const buf = await keyed
    .trim({ threshold: 1 }) // drop the now-empty margin so the subject fills the frame
    // 640 square to match the tier portraits — FounderAvatar renders both
    // through the same square <Image>, so mixed aspect ratios would jump.
    .resize({ width: 640, height: 640, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 82, effort: 5 })
    .toBuffer();

  writeFileSync(join(outDir, `${outBase}.webp`), buf);
  return buf.length;
}

let total = 0;
let missing = 0;
console.log("\nWardrobe skins → public/founder/skins/");
for (const s of SKINS) {
  const p = join(SRC, s.src);
  if (!existsSync(p)) {
    console.log(`  ✗ missing: ${s.src}`);
    missing++;
    continue;
  }
  const n = await processSkin(p, s.out);
  total += n;
  console.log(`  ✓ ${s.out}.webp  ${(n / 1024).toFixed(0)} KB`);
}
console.log(`\n${(total / 1048576).toFixed(2)} MB total, ${missing} missing\n`);
if (missing) process.exitCode = 1;
