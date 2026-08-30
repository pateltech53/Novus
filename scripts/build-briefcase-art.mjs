#!/usr/bin/env node
/**
 * Briefcase-system art build: raw Gemini masters → shipped assets + manifest.
 *
 *   node scripts/build-briefcase-art.mjs [--lenient] [--skip-sheets]
 *
 * Reads the raw PNGs that generate-briefcase-art.mjs left in
 * .assets-staging/briefcase/, QAs them, keys out the white studio background
 * (same border-seeded flood fill as make-characters.mjs — thresholds would
 * punch holes through white shirts and gold-on-white sheen), and writes:
 *
 *   public/briefcase/skins/t{tier}/{id}_{novus|nova}.webp   640px, keyed
 *   public/briefcase/cases/{case}-{closed|glow|open}.webp   1024px, keyed
 *   public/briefcase/keys/{tier}.webp                        640px, keyed
 *   public/briefcase/props/*.webp                            512–1600px
 *   public/briefcase/manifest.json                           id → art + meta
 *
 * The manifest lists EVERY catalog entry; entries whose art has not been
 * generated yet carry null urls, and the app renders its tier-colored
 * placeholder card instead (build prompt §4). So this script is safe to run
 * at any completion level — art streams in as generation batches finish.
 *
 * QA gate: a raw file below 1000px or with a border that is less than 97%
 * white is reported and SKIPPED (it would key badly and ship a halo).
 * --lenient ships it anyway; the real fix is regenerating that id.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets-src", "briefcase");
const STAGING = join(root, ".assets-staging", "briefcase");
const OUT = join(root, "public", "briefcase");
/**
 * The PNGs live OUTSIDE public/.
 *
 * They are lossless on purpose — quantising would crush the soft alpha ramp
 * that is the whole thing worth inspecting — and lossless costs ~15× the
 * webp, ~120 MB across the set. public/ is the deploy root: everything in it
 * is uploaded and served, so parking a review artefact there would ship
 * 120 MB to the CDN for pixels no player ever requests. Tracked in git
 * (that is the point — they are the reviewable, hand-offable copy), just not
 * deployed.
 */
const PNG_OUT = join(root, "art-review", "briefcase");
const pngPathFor = (outRel) => join(PNG_OUT, outRel.replace(/\.webp$/, ".png"));
/** Repo-relative, NOT a URL: nothing serves these. */
const pngRepoPath = (outRel) => `art-review/briefcase/${outRel.replace(/\.webp$/, ".png")}`;
const LENIENT = process.argv.includes("--lenient");
const SKIP_SHEETS = process.argv.includes("--skip-sheets");
const { default: sharp } = await import("sharp");

const RARITY = {
  1: { rarity: "common", color: "#8E9BAA" },
  2: { rarity: "uncommon", color: "#2EC4B6" },
  3: { rarity: "rare", color: "#3A6BFF" },
  4: { rarity: "epic", color: "#FF6B00" },
  5: { rarity: "legendary", color: "#F5C518" },
};

/** Same CSV subset as generate-briefcase-art.mjs. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; if (row.some((f) => f !== "")) rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const SKINS = parseCsv(readFileSync(join(SRC, "skins.csv"), "utf8"));
const PROPS = JSON.parse(readFileSync(join(SRC, "props.json"), "utf8"));

/**
 * Border-seeded flood-fill keying, lifted from scripts/make-characters.mjs —
 * see that file for the rationale on tolerance/edge/erode/feather.
 * seedCenter additionally floods from the image center: avatar FRAMES enclose
 * a white hole that no border-connected fill can reach.
 */
function keyOutBackground(data, w, h, { tolerance = 34, feather = 0.7, edge = 16, seedCenter = false } = {}) {
  const isBg = new Uint8Array(w * h);
  const stack = [];
  const at = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const [br, bg_, bb] = at(0);
  const near = (i) => {
    const [r, g, b] = at(i);
    return Math.abs(r - br) <= tolerance && Math.abs(g - bg_) <= tolerance && Math.abs(b - bb) <= tolerance;
  };
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

  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  if (seedCenter) stack.push(((h / 2) | 0) * w + ((w / 2) | 0));

  while (stack.length) {
    const i = stack.pop();
    if (isBg[i] || !near(i)) continue;
    isBg[i] = 1;
    if (grad(i) > edge) continue;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }

  for (let i = 0; i < w * h; i++) if (isBg[i]) data[i * 4 + 3] = 0;

  { // erode one pixel — kills the light fringe that halos on dark surfaces
    const grow = new Uint8Array(isBg);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (isBg[i]) continue;
        if (isBg[i - 1] || isBg[i + 1] || isBg[i - w] || isBg[i + w]) { grow[i] = 1; data[i * 4 + 3] = 0; }
      }
    isBg.set(grow);
  }

  if (feather > 0) {
    const copy = new Uint8Array(isBg);
    for (let y = 1; y < h - 1; y++)
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
  return data;
}

const flagged = [];

/** min-resolution + border-whiteness gate. Returns raw RGBA or null if failed.
 *  Backdrops are full-bleed scenes, so they are held to resolution only. */
async function loadQa(path, key, { needsWhiteBorder = true } = {}) {
  const img = sharp(path).ensureAlpha();
  const { width, height } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });
  const problems = [];
  if (Math.min(width, height) < 1000) problems.push(`only ${width}×${height}`);
  if (!needsWhiteBorder) {
    if (problems.length) {
      flagged.push(`${key}: ${problems.join(", ")}`);
      if (!LENIENT) return null;
    }
    return { data, width, height };
  }
  let whiteish = 0, n = 0;
  const white = (i) => data[i * 4] > 235 && data[i * 4 + 1] > 235 && data[i * 4 + 2] > 235;
  for (let x = 0; x < width; x += 4) {
    if (white(x)) whiteish++;
    if (white((height - 1) * width + x)) whiteish++;
    n += 2;
  }
  for (let y = 0; y < height; y += 4) {
    if (white(y * width)) whiteish++;
    if (white(y * width + width - 1)) whiteish++;
    n += 2;
  }
  if (whiteish / n < 0.97) problems.push(`border only ${((whiteish / n) * 100).toFixed(0)}% white`);
  if (problems.length) {
    flagged.push(`${key}: ${problems.join(", ")}`);
    if (!LENIENT) return null;
  }
  return { data, width, height };
}

/** Counted apart: only the webp is served to players; the PNG is review
 *  weight, and one blended total hides which of the two is growing. */
const shippedBytes = { webp: 0, png: 0 };
/**
 * Ships TWO files per asset from one keying pass:
 *   .webp — what the app will serve (small, alpha)
 *   .png  — the same pixels lossless, for review and for any tool that wants
 *           PNG (Zach, 30 Aug). Same basename, so a manifest url swaps by ext.
 */
async function shipKeyed(srcPath, outRel, key, { size, quality = 82, seedCenter = false } = {}) {
  const raw = await loadQa(srcPath, key);
  if (!raw) return false;
  keyOutBackground(raw.data, raw.width, raw.height, { seedCenter });
  const outPath = join(OUT, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  const shaped = () =>
    sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
      .trim({ threshold: 1 })
      .resize({ width: size, height: size, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
  const webp = await shaped().webp({ quality, effort: 5 }).toBuffer();
  // NOT palette:true. Quantising to 256 colours crushes the soft alpha ramp
  // the feathering pass just built — which is the exact thing the PNG exists
  // to let someone inspect. Truly lossless, and it costs a few hundred kB.
  const png = await shaped().png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(outPath, webp);
  const pngPath = pngPathFor(outRel);
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath, png);
  shippedBytes.webp += webp.length;
  shippedBytes.png += png.length;
  return true;
}

/**
 * Backdrops keep their background, so they skip keying — but not QA: a
 * backdrop that came back at 512 px would silently ship upscaled and blurry.
 * Decoded once, and never enlarged past the source.
 */
async function shipScene(srcPath, outRel, key, { width = 1600, quality = 80 } = {}) {
  const raw = await loadQa(srcPath, key, { needsWhiteBorder: false });
  if (!raw) return false;
  const outPath = join(OUT, outRel);
  mkdirSync(dirname(outPath), { recursive: true });
  const pipeline = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .resize({ width: Math.min(width, raw.width), withoutEnlargement: true });
  const webp = await pipeline.clone().webp({ quality, effort: 5 }).toBuffer();
  const png = await pipeline.clone().png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(outPath, webp);
  const pngPath = pngPathFor(outRel);
  mkdirSync(dirname(pngPath), { recursive: true });
  writeFileSync(pngPath, png);
  shippedBytes.webp += webp.length;
  shippedBytes.png += png.length;
  return true;
}

// ── Skins ────────────────────────────────────────────────────────────────────

const manifest = {
  version: 1,
  styleVersion: "v1",
  basePath: "/briefcase",
  // Every asset ships twice: .webp for the app, .png (same basename) for
  // review and for tools that want lossless. `png` mirrors `urls`.
  formats: ["webp", "png"],
  skins: {}, cases: {}, keys: {}, props: {}, fx: {},
};
const bases = ["novus", "nova"];
/** The PNG twin of a shipped webp url — a REPO PATH, not a served url. */
const pngOf = (u) => (u ? pngRepoPath(u.replace("/briefcase/", "")) : null);
const pngMap = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, pngOf(v)]));
let shipped = 0, missing = 0;

for (const s of SKINS) {
  const urls = {};
  for (const base of bases) {
    const rawPath = join(STAGING, "raw", "skins", `${s.id}_${base}.png`);
    const rel = `skins/t${s.tier}/${s.id}_${base}.webp`;
    if (existsSync(rawPath) && (await shipKeyed(rawPath, rel, `skin ${s.id}_${base}`, { size: 640 }))) {
      urls[base] = `/briefcase/${rel}`;
      shipped++;
    } else if (existsSync(join(OUT, rel))) {
      urls[base] = `/briefcase/${rel}`; // already built in an earlier pass
    } else missing++;
  }
  const any = urls.novus || urls.nova;
  const webp = { novus: urls.novus ?? null, nova: urls.nova ?? null };
  manifest.skins[s.id] = {
    name: s.name,
    tier: Number(s.tier),
    collection: s.collection,
    inPool: s.collection !== "milestone_only",
    ...RARITY[Number(s.tier)],
    urls: any ? webp : null,
    png: any ? pngMap(webp) : null,
  };
}

// ── Cases, keys, objects, scenes, poses ──────────────────────────────────────

for (const c of PROPS.cases) {
  // Every state key is always present (url or null) so consumers can check
  // per state; `states: null` means no art at all, same as skins' urls.
  const states = {};
  for (const state of Object.keys(PROPS.caseStates)) {
    const rawPath = join(STAGING, "raw", "props", `case-${c.id}-${state}.png`);
    const rel = `cases/${c.id}-${state}.webp`;
    states[state] = null;
    if (existsSync(rawPath) && (await shipKeyed(rawPath, rel, `case ${c.id}-${state}`, { size: 1024, quality: 85 }))) {
      states[state] = `/briefcase/${rel}`;
      shipped++;
    } else if (existsSync(join(OUT, rel))) states[state] = `/briefcase/${rel}`;
    else missing++;
  }
  const anyState = Object.values(states).some(Boolean);
  manifest.cases[c.id] = {
    name: c.name,
    tier: c.tier,
    reskin: c.id === "t1-denim" || undefined,
    states: anyState ? states : null,
    png: anyState ? pngMap(states) : null,
  };
}

for (const k of PROPS.keys) {
  const rawPath = join(STAGING, "raw", "props", `key-${k.id}.png`);
  const rel = `keys/${k.id}.webp`;
  let url = null;
  if (existsSync(rawPath) && (await shipKeyed(rawPath, rel, `key ${k.id}`, { size: 640 }))) { url = `/briefcase/${rel}`; shipped++; }
  else if (existsSync(join(OUT, rel))) url = `/briefcase/${rel}`;
  else missing++;
  manifest.keys[k.id] = { tier: k.tier, url, png: pngOf(url) };
}

for (const o of PROPS.objects) {
  const rawPath = join(STAGING, "raw", "props", `${o.id}.png`);
  const rel = `props/${o.id}.webp`;
  let url = null;
  if (existsSync(rawPath) && (await shipKeyed(rawPath, rel, `prop ${o.id}`, { size: o.frame ? 640 : 512, seedCenter: Boolean(o.frame) }))) {
    url = `/briefcase/${rel}`;
    shipped++;
  } else if (existsSync(join(OUT, rel))) url = `/briefcase/${rel}`;
  else missing++;
  manifest.props[o.id] = { name: o.name, kind: o.frame ? "frame" : "object", url, png: pngOf(url) };
}

for (const s of PROPS.scenes) {
  const rawPath = join(STAGING, "raw", "props", `${s.id}.png`);
  const rel = `props/${s.id}.webp`;
  let url = null;
  if (existsSync(rawPath) && (await shipScene(rawPath, rel, `scene ${s.id}`))) { url = `/briefcase/${rel}`; shipped++; }
  else if (existsSync(join(OUT, rel))) url = `/briefcase/${rel}`;
  else missing++;
  manifest.props[s.id] = { name: s.name, kind: "background", url, png: pngOf(url) };
}

for (const p of PROPS.poses) {
  const rawPath = join(STAGING, "raw", "props", `${p.id}.png`);
  const rel = `props/${p.id}.webp`;
  let url = null;
  if (existsSync(rawPath) && (await shipKeyed(rawPath, rel, `pose ${p.id}`, { size: 640 }))) { url = `/briefcase/${rel}`; shipped++; }
  else if (existsSync(join(OUT, rel))) url = `/briefcase/${rel}`;
  else missing++;
  manifest.props[p.id] = { name: p.name, kind: "pose", base: p.base, url, png: pngOf(url) };
}

// ── FX sprites (AI-generated flat 2D; keyed like everything else) ────────────

for (const s of PROPS.sprites) {
  const rawPath = join(STAGING, "raw", "sprites", `${s.id}.png`);
  const rel = `fx/${s.id}.webp`;
  let url = null;
  if (existsSync(rawPath) && (await shipKeyed(rawPath, rel, `sprite ${s.id}`, { size: s.size ?? 256, seedCenter: Boolean(s.hole) }))) {
    url = `/briefcase/${rel}`;
    shipped++;
  } else if (existsSync(join(OUT, rel))) url = `/briefcase/${rel}`;
  else missing++;
  const set = (manifest.fx[s.set] ??= { name: s.name, sprites: {}, png: {} });
  set.sprites[s.id] = url;
  set.png[s.id] = pngOf(url);
}

// ── Manifest + contact sheets ────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

/*
 * A gallery GitHub itself renders.
 *
 * The admin wall at /admin/assets needs the app running; this is the same
 * art in a file you can open in the GitHub UI on a phone, which is where
 * "does this set hang together?" actually gets answered. Relative image
 * paths, so it works in the repo browser and in any local markdown viewer.
 */
/** docs/asset-review/README.md → repo root is two levels up. */
const rel = (p) => (p ? `../../${p}` : null);
const img = (u, alt, w = 130) => (u ? `<img src="${rel(u)}" alt="${alt}" width="${w}">` : "—");
const md = [];
md.push("# Briefcase art — review gallery\n");
md.push(
  `Every asset the generator produced (style \`${manifest.styleVersion}\`). Nothing here is wired into the ` +
  `game yet — this page exists to be judged.\n`,
);
md.push(
  `The images below are the lossless PNGs in \`art-review/briefcase/\`, which is tracked in git but NOT ` +
  `deployed. The app's copies are the webp twins under \`public/briefcase/\`, same pixels, ~15× smaller.\n`,
);
md.push(
  `Both founders are sharks from the panel cast: **Novus** (masc) and **Nova** (fem). ` +
  `Each design renders on both. For an interactive version with dark/light/checker grounds and tier ` +
  `filters, run the app and open \`/admin/assets\`.\n`,
);
{
  const skins = Object.values(manifest.skins);
  const renders = skins.reduce((n, s) => n + (s.urls?.novus ? 1 : 0) + (s.urls?.nova ? 1 : 0), 0);
  const props = Object.values(manifest.props).filter((p) => p.url).length;
  const cases = Object.values(manifest.cases).reduce(
    (n, c) => n + Object.values(c.states ?? {}).filter(Boolean).length, 0);
  const keys = Object.values(manifest.keys).filter((k) => k.url).length;
  const fx = Object.values(manifest.fx).reduce(
    (n, s) => n + Object.values(s.sprites).filter(Boolean).length, 0);
  md.push(`**${renders}** skin renders · **${cases}** case states · **${keys}** keys · **${props}** props · **${fx}** FX sprites\n`);
}
// Walk the CSV, not the manifest object: "100" and "101" are canonical
// integer keys, so JS enumerates them BEFORE "001" and the gallery would
// open on the Legendary collection with The Magnate at the top.
const byCollection = {};
for (const row of SKINS) (byCollection[row.collection] ??= []).push([row.id, manifest.skins[row.id]]);
const COLLECTION_TITLES = {
  garage: "Garage Days", office: "First Office", corporate: "Corporate Ladder",
  street: "Street CEO", retro: "Retro Business", tech: "Tech Visionary",
  world: "World Tour Tailoring", industry: "Industry Pro", seasonal: "Seasonal & Events",
  legendary: "Legendary Founders", milestone_only: "Milestone only",
};
// The gallery links the PNGs, not the webp: every markdown renderer in the
// chain (GitHub, phones, editors) draws a PNG without argument.
for (const [collection, skins] of Object.entries(byCollection)) {
  md.push(`\n## ${COLLECTION_TITLES[collection] ?? collection}\n`);
  md.push("| # | Name | Tier | Novus | Nova |");
  md.push("|---|---|---|---|---|");
  for (const [id, s] of skins)
    md.push(`| ${id} | ${s.name} | T${s.tier} ${s.rarity} | ${img(s.png?.novus, `${id} novus`)} | ${img(s.png?.nova, `${id} nova`)} |`);
}
md.push("\n## Briefcases\n");
md.push("| Case | Tier | Closed | Glow | Open |");
md.push("|---|---|---|---|---|");
for (const [id, c] of Object.entries(manifest.cases))
  md.push(`| ${c.name} | T${c.tier} | ${img(c.png?.closed, `${id} closed`, 160)} | ${img(c.png?.glow, `${id} glow`, 160)} | ${img(c.png?.open, `${id} open`, 160)} |`);
md.push("\n## Keys\n");
md.push(`| ${Object.keys(manifest.keys).map((k) => k.toUpperCase()).join(" | ")} |`);
md.push(`|${Object.keys(manifest.keys).map(() => "---").join("|")}|`);
md.push(`| ${Object.entries(manifest.keys).map(([id, k]) => img(k.png, `key ${id}`)).join(" | ")} |`);
md.push("\n## Props\n");
md.push("| Asset | Kind | Art |");
md.push("|---|---|---|");
for (const [id, p] of Object.entries(manifest.props))
  md.push(`| ${p.name} | ${p.kind} | ${img(p.png, id, p.kind === "background" ? 320 : 150)} |`);
md.push("\n## FX sprites\n");
for (const [setId, set] of Object.entries(manifest.fx)) {
  const shots = Object.entries(set.png ?? {}).filter(([, u]) => u);
  if (!shots.length) continue;
  md.push(`\n**${set.name}** (\`${setId}\`)\n`);
  md.push(`| ${shots.map(([id]) => id).join(" | ")} |`);
  md.push(`|${shots.map(() => "---").join("|")}|`);
  md.push(`| ${shots.map(([id, u]) => img(u, id, 90)).join(" | ")} |`);
}
{
  // Name the gaps. A dash in a table reads as "not made yet", but not as
  // "here is the command that makes it" — and a half-built set that does not
  // say what it is missing gets mistaken for a finished one.
  // Two different absences that need two different commands. A render the
  // API never produced is filled by a plain resume; one the QA gate REJECTED
  // already has a master on disk, so a resume skips it and only --force
  // replaces it. Listing them together under one command was a lie.
  const ungenerated = [], rejected = [];
  for (const row of SKINS)
    for (const base of bases)
      if (!manifest.skins[row.id]?.urls?.[base]) {
        const id = `${row.id}_${base}`;
        (existsSync(join(STAGING, "raw", "skins", `${id}.png`)) ? rejected : ungenerated).push(id);
      }
  if (ungenerated.length) {
    md.push(`\n## Still to generate (${ungenerated.length})\n`);
    md.push("```\n" + ungenerated.join(" ") + "\n```\n");
    md.push(
      "No master exists for these yet, so a plain resume picks up exactly them — " +
      "finished renders are never redone:\n\n" +
      "```sh\nnpm run art:briefcase -- all --model gemini-3.1-flash-image --concurrency 4\n```\n",
    );
  }
  if (rejected.length) {
    md.push(`\n## Generated but rejected by QA (${rejected.length})\n`);
    md.push("```\n" + rejected.join(" ") + "\n```\n");
    md.push(
      "A master exists but failed the resolution / white-background gate, so it was not shipped. " +
      "A resume will SKIP these — replacing them needs `--force`:\n\n" +
      "```sh\nnpm run art:briefcase -- skins --only " +
      [...new Set(rejected.map((r) => r.split("_")[0]))].join(",") +
      " --force --model gemini-3.1-flash-image\n```\n",
    );
  }
}
md.push("\n---\n");
md.push("_Generated by `scripts/build-briefcase-art.mjs`. See `docs/BRIEFCASE-ART.md` for the pipeline._\n");
const galleryDir = join(root, "docs", "asset-review");
mkdirSync(galleryDir, { recursive: true });
writeFileSync(join(galleryDir, "README.md"), md.join("\n"));
console.log("gallery → docs/asset-review/README.md (browsable on GitHub)");

if (!SKIP_SHEETS) {
  // Per-collection grids from the SHIPPED art (what players will see), on
  // white so keying mistakes are visible. QA rubric lives in the docs.
  const sheetDir = join(STAGING, "sheets");
  const byCollection = {};
  for (const s of SKINS) (byCollection[s.collection] ??= []).push(s);
  for (const [collection, skins] of Object.entries(byCollection)) {
    const cells = [];
    for (const s of skins)
      for (const base of bases) {
        const u = manifest.skins[s.id].urls?.[base];
        if (u) cells.push({ path: join(root, "public", u.slice(1)), label: `${s.id} ${base}` });
      }
    if (!cells.length) continue;
    const cols = Math.min(8, cells.length), cell = 256;
    const rows = Math.ceil(cells.length / cols);
    const composites = await Promise.all(cells.map(async (c, i) => ({
      input: await sharp(c.path).resize(cell, cell, { fit: "contain", background: "#fff" }).png().toBuffer(),
      left: (i % cols) * cell,
      top: Math.floor(i / cols) * cell,
    })));
    mkdirSync(sheetDir, { recursive: true });
    await sharp({ create: { width: cols * cell, height: rows * cell, channels: 3, background: "#fff" } })
      .composite(composites)
      .webp({ quality: 80 })
      .toFile(join(sheetDir, `${collection}.webp`));
  }
  console.log(`contact sheets → .assets-staging/briefcase/sheets/`);
}

const mb = (n) => (n / 1048576).toFixed(2);
console.log(
  `\n${shipped} assets shipped this pass — ${mb(shippedBytes.webp)} MB webp (what players download) ` +
  `+ ${mb(shippedBytes.png)} MB png (review only), ${missing} awaiting generation`);
if (flagged.length) {
  console.log(`\n${LENIENT ? "shipped DESPITE" : "skipped by"} QA (regenerate these ids):`);
  for (const f of flagged) console.log(`  ⚠ ${f}`);
  if (!LENIENT) process.exitCode = 1;
}
