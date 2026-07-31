#!/usr/bin/env node
/**
 * Character asset pipeline.
 *
 * Takes the raw 1392×1424 renders (founder tiers + the five panel sharks),
 * keys out their white studio background, trims, and writes web-sized webp.
 *
 *   node scripts/make-characters.mjs [sourceDir]
 *
 * WHY FLOOD FILL, NOT A THRESHOLD
 * These renders sit on pure white, but the characters contain white too — the
 * tuxedo shirt, the teeth, the sneakers. A "make every near-white pixel
 * transparent" pass punches holes straight through all three. So the alpha
 * comes from a flood fill inward from the border: only white that is connected
 * to the edge is background. Interior white survives untouched.
 *
 * Source files are read from the parent folder and never modified.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] ?? join(root, "..");
const { default: sharp } = await import("sharp");

/** Panel sharks — the five who grill you. */
const SHARKS = [
  { src: "Marcus Cole.png", out: "marcus" },
  { src: "Serena Voss .jpg", out: "serena" }, // note: trailing space in the filename
  { src: "Dev Okafor.jpg", out: "dev" },
  { src: "Lily Zhang.png", out: "lily" },
  { src: "Viktor Reyes.jpg", out: "viktor" },
];

/** Founder tiers 1–5, both genders. Tier 1 is a hoodie; tier 5 is a tuxedo. */
const FOUNDERS = [
  ...[1, 2, 3, 4].map((t) => ({ src: `male${t}.png`, out: `male-${t}` })),
  { src: "malefinal.png", out: "male-5" },
  ...[1, 2, 3, 4].map((t) => ({ src: `fem${t}.png`, out: `female-${t}` })),
  { src: "femfinal.png", out: "female-5" },
];

/**
 * Alpha from a border-seeded flood fill.
 * Returns a new RGBA buffer with background pixels zeroed.
 */
function keyOutBackground(data, w, h, { tolerance = 34, feather = 0.7, edge = 16 } = {}) {
  const isBg = new Uint8Array(w * h);
  const stack = [];

  // Sample the actual corner colour rather than assuming 255 — some renders
  // land at 254, and Lily's sits on cream rather than white.
  const at = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const [br, bg_, bb] = at(0);
  const near = (i) => {
    const [r, g, b] = at(i);
    return Math.abs(r - br) <= tolerance && Math.abs(g - bg_) <= tolerance && Math.abs(b - bb) <= tolerance;
  };

  /**
   * Local gradient magnitude — how hard the image changes at this pixel.
   *
   * Colour alone cannot separate Lily Zhang from her background: she stands on
   * cream and her blazer IS cream, within about 8 levels. A pure colour test
   * either leaks through the garment or leaves a halo. What actually divides
   * them is the drawn outline, so the fill refuses to cross a strong edge —
   * it floods flat background and stops dead at the rim of the coat.
   */
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
    // Stop at the outline: mark it background (so the silhouette stays tight)
    // but do not expand past it.
    if (grad(i) > edge) continue;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  // Hard alpha first.
  for (let i = 0; i < w * h; i++) if (isBg[i]) data[i * 4 + 3] = 0;

  /*
   * Erode one pixel inward before feathering.
   *
   * The renders sit on white/cream, so the outermost kept pixels are part
   * background — a light fringe. Composited onto the dark app ground that
   * fringe reads as a halo tracing the whole silhouette. Cutting one pixel
   * removes the contaminated ring; at this resolution it costs nothing
   * visible.
   */
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

  // One soft pass so the cut edge is not a staircase: any kept pixel touching
  // background gets partial alpha proportional to how many neighbours are out.
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
async function processAsset(srcPath, outBase, { size, dir }) {
  const img = sharp(srcPath).ensureAlpha();
  const { width, height } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });

  keyOutBackground(data, width, height);

  const keyed = sharp(data, { raw: { width, height, channels: 4 } });
  const outDir = join(root, "public", dir);
  mkdirSync(outDir, { recursive: true });

  const buf = await keyed
    .trim({ threshold: 1 }) // drop the now-empty margin so the subject fills the frame
    .resize({ width: size, height: size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 88, effort: 5 })
    .toBuffer();

  writeFileSync(join(outDir, `${outBase}.webp`), buf);
  return buf.length;
}

let total = 0;
console.log("\nPanel sharks → public/sharks/");
for (const s of SHARKS) {
  const p = join(SRC, s.src);
  if (!existsSync(p)) { console.log(`  ✗ missing: ${s.src}`); continue; }
  const n = await processAsset(p, s.out, { size: 512, dir: "sharks" });
  total += n;
  console.log(`  ✓ ${s.out}.webp  ${(n / 1024).toFixed(0)} KB`);
}

console.log("\nFounder tiers → public/founder/");
for (const f of FOUNDERS) {
  const p = join(SRC, f.src);
  if (!existsSync(p)) { console.log(`  ✗ missing: ${f.src}`); continue; }
  const n = await processAsset(p, f.out, { size: 640, dir: "founder" });
  total += n;
  console.log(`  ✓ ${f.out}.webp  ${(n / 1024).toFixed(0)} KB`);
}

console.log(`\n${(total / 1048576).toFixed(2)} MB total (was ~20 MB of source PNG/JPEG)\n`);
