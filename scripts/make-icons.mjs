#!/usr/bin/env node
/**
 * Renders the PWA icon set from one inline SVG.
 *
 * Uses sharp, which is already present as a Next.js transitive dependency — no
 * new package for a build-time asset step. Run when the mark changes:
 *   node scripts/make-icons.mjs
 *
 * The mark is the fin, not a letterform: it is what the mascot already is, it
 * reads at 32px, and it does not collide with any other finance app's glyph.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const { default: sharp } = await import("sharp");

/** @param {{size:number, pad:number, radius:number|null}} o */
const svg = ({ size, pad, radius }) => {
  const s = size;
  const inner = s - pad * 2;
  const bg =
    radius === null
      ? `<rect width="${s}" height="${s}" fill="#1b2029"/>`
      : `<rect width="${s}" height="${s}" rx="${radius}" ry="${radius}" fill="#1b2029"/>`;
  // Fin path normalised to a 30×26 box, scaled into the padded area.
  const k = inner / 30;
  const tx = pad;
  const ty = pad + (inner - 26 * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  ${bg}
  <g transform="translate(${tx} ${ty}) scale(${k})">
    <path d="M15 2C15 2 6 12 3 22c6-3 9-3 12-3s6 0 12 3C24 12 15 2 15 2Z" fill="#ff6b00"/>
  </g>
</svg>`;
};

const targets = [
  // Maskable art needs its subject inside the safe zone, so it is padded hard.
  { file: "icon-maskable-512.png", size: 512, pad: 128, radius: null },
  { file: "icon-512.png", size: 512, pad: 96, radius: 112 },
  { file: "icon-192.png", size: 192, pad: 36, radius: 42 },
  // iOS applies its own mask, so this one ships square and unrounded.
  { file: "apple-touch-icon.png", size: 180, pad: 34, radius: null },
];

for (const t of targets) {
  const buf = await sharp(Buffer.from(svg(t))).png().toBuffer();
  writeFileSync(join(out, t.file), buf);
  console.log(`  ✓ ${t.file}  ${t.size}×${t.size}  ${(buf.length / 1024).toFixed(1)} KB`);
}
console.log(`\n${targets.length} icons → public/icons/`);
