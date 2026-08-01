#!/usr/bin/env node
/**
 * Renders the iOS and Android icon and launch art from the same mark as the
 * PWA set — the fin in scripts/make-icons.mjs, which is what the mascot
 * already is, reads at 32px, and does not collide with another finance app's
 * glyph.
 *
 * Run when the mark changes:  node scripts/make-app-icons.mjs
 *
 * Without this, both stores get Capacitor's own logo, which is the single most
 * visible way for an app to look unfinished. Overwrites the placeholder files
 * the platform templates ship, in place, so nothing has to be re-registered in
 * Xcode or in a resource table.
 *
 * Three sets of rules are enforced here rather than remembered:
 *
 *   · the App Store icon must be opaque, square and unrounded — iOS applies
 *     its own mask, and an alpha channel is a rejection
 *   · an Android adaptive foreground is 108dp of canvas with only the inner
 *     66dp guaranteed to survive the launcher's mask, so the fin is drawn
 *     into that safe circle and the rest is deliberately empty
 *   · launch art is scaled to fill by both platforms, so the mark sits small
 *     and centred and everything around it is flat ground
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { default: sharp } = await import("sharp");

/** --n-1 in the dark theme: the ground the app itself opens on. */
const GROUND = "#1c1d21";
/** The only colour that asks you to do something. */
const ACTION = "#ff6b00";

/**
 * The mark, on a canvas.
 *
 * `fin` is the fraction of the shorter side the fin should occupy, which is
 * the one number that differs between a 48px launcher icon and a 2732px launch
 * screen. Everything else falls out of it.
 */
function art({ width, height = width, fin = 0.62, ground = GROUND, radius = 0 }) {
  const short = Math.min(width, height);
  const w = short * fin;
  const k = w / 30; // the fin path is normalised to a 30×26 box
  const tx = (width - 30 * k) / 2;
  const ty = (height - 26 * k) / 2;
  const bg = ground
    ? `<rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${ground}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${bg}
  <g transform="translate(${tx} ${ty}) scale(${k})">
    <path d="M15 2C15 2 6 12 3 22c6-3 9-3 12-3s6 0 12 3C24 12 15 2 15 2Z" fill="${ACTION}"/>
  </g>
</svg>`;
}

let count = 0;

async function write(path, svg, { alpha = true } = {}) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  let pipeline = sharp(Buffer.from(svg)).png();
  // An App Store icon with an alpha channel is rejected, and a launcher icon
  // flattened onto the ground is fine — only the adaptive foreground needs it.
  if (!alpha) pipeline = pipeline.flatten({ background: GROUND });
  writeFileSync(full, await pipeline.toBuffer());
  count += 1;
}

// ── iOS ─────────────────────────────────────────────────────────────────────

await write(
  "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  art({ width: 1024, fin: 0.58, radius: 0 }),
  { alpha: false },
);

// One image, three scales: the launch screen scales it to fill, so the same
// 2732 square is correct at every one of them.
for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
  await write(
    `ios/App/App/Assets.xcassets/Splash.imageset/${name}`,
    art({ width: 2732, fin: 0.16 }),
    { alpha: false },
  );
}

// ── Android ─────────────────────────────────────────────────────────────────

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

for (const [density, size] of Object.entries(LAUNCHER)) {
  await write(
    `android/app/src/main/res/mipmap-${density}/ic_launcher.png`,
    art({ width: size, fin: 0.6, radius: size * 0.22 }),
    { alpha: false },
  );
  await write(
    `android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`,
    art({ width: size, fin: 0.6, radius: size / 2 }),
    { alpha: false },
  );
  // Adaptive foreground: 108dp of canvas, 66dp of it guaranteed visible. The
  // fin is sized against the safe circle, not the canvas, and the background
  // is the flat colour in values/ic_launcher_background.xml.
  const fgSize = Math.round(size * 2.25);
  await write(
    `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
    art({ width: fgSize, fin: 0.34, ground: null }),
  );
}

const SPLASH = {
  "drawable": [480, 320],
  "drawable-port-mdpi": [320, 480],
  "drawable-port-hdpi": [480, 800],
  "drawable-port-xhdpi": [720, 1280],
  "drawable-port-xxhdpi": [960, 1600],
  "drawable-port-xxxhdpi": [1280, 1920],
  "drawable-land-mdpi": [480, 320],
  "drawable-land-hdpi": [800, 480],
  "drawable-land-xhdpi": [1280, 720],
  "drawable-land-xxhdpi": [1600, 960],
  "drawable-land-xxxhdpi": [1920, 1280],
};

for (const [dir, [w, h]] of Object.entries(SPLASH)) {
  await write(
    `android/app/src/main/res/${dir}/splash.png`,
    art({ width: w, height: h, fin: 0.22 }),
    { alpha: false },
  );
}

// The adaptive icon's background layer, and the window background behind the
// launch art. Both were white, which flashed against a dark app.
writeFileSync(
  join(root, "android/app/src/main/res/values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${GROUND}</color>
</resources>
`,
);
count += 1;

console.log(`\n${count} files written. iOS and Android now open on the fin, not on Capacitor's logo.`);
