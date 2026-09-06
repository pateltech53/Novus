#!/usr/bin/env node
/**
 * Rebuild the shipped GLBs from source: two sharks and eleven briefcase props.
 *
 *   npm run models                       everything
 *   npm run models -- --only t5-gold     one, by registry slug
 *
 * Prefer `--only` when you have regenerated one prop. A full run also
 * re-encodes the two sharks from sources that have not changed, and
 * gltf-transform's output is not byte-identical between runs — so a
 * briefcase-only rebuild leaves 1 MB of visually identical shark in the diff,
 * which is a megabyte nobody can review and a re-download for every player.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The meshes in `public/` are derived artefacts, and until now the derivation
 * lived in somebody's shell history. That is how the repo ended up with a
 * 2.96 MB `shark.glb` that nobody could regenerate and nobody could explain:
 * the compression settings were lost, so every later look at it could only ask
 * "is 2.96 MB small enough?" — a question about the download — instead of the
 * question that mattered, which is what the phone does after the download.
 *
 * ── What the pipeline does, and why in this order ───────────────────────────
 *
 * 1. **weld** — merges vertices that are numerically identical. Simplify needs
 *    a connected mesh to collapse edges across; on an unwelded export it
 *    quietly does far less work than it reports.
 * 2. **simplify** — the actual win. Both meshes were exported at film density
 *    (457k and 247k triangles) for boxes 128–300 CSS px tall. Below ~65,536
 *    vertices the index buffer drops from UINT32 to UINT16, which alone halves
 *    the largest single accessor in the file.
 * 3. **resize** — textures to the size they are actually sampled at. This is
 *    the VRAM axis and it is quadratic: 2048² → 1024² is four times less
 *    memory and four times less WebP to decode on the main thread.
 * 4. **optimize** — meshopt + WebP. Deliberately meshopt and NOT Draco: drei
 *    bundles the meshopt decoder from three-stdlib, while its Draco decoder is
 *    fetched from a Google CDN, which this app's CSP and its no-third-party
 *    rule both forbid. Draco also decodes SLOWER on the main thread, which is
 *    the axis being optimised here.
 *
 * ── The one invariant ───────────────────────────────────────────────────────
 *
 * **The bounding box must not move.** `components/SharkCanvas.tsx` scales the
 * pitch-screen mascot by a hardcoded MODEL_SCALE with no normalization step,
 * so a re-export at a different unit scale silently resizes it on a screen
 * nobody re-checks. None of the four steps above touch scale, and this script
 * asserts it afterwards rather than trusting that.
 *
 * ── Output names ────────────────────────────────────────────────────────────
 *
 * `next.config.ts` serves /models and /shark with `immutable, max-age=7d`, and
 * its own note says the way to replace such an asset is to rename it. So the
 * outputs are versioned and the two load sites name the version. Bump the
 * suffix here and in those two files together; never overwrite in place.
 *
 * ── Why the tool is not a devDependency ────────────────────────────────────
 *
 * `@gltf-transform/cli` pulls 239 packages, and CI runs `npm ci` twice on every
 * push while running this script exactly never — meshes are re-exported when
 * the art changes, which is a deliberate act by a person. So it is fetched on
 * demand, at a pinned version, and the install cost lands on whoever is
 * actually rebuilding a mesh. Needs network the first time; nothing else here
 * does.
 */
const CLI = "@gltf-transform/cli@4.4.2";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "novus-models-"));

/** The briefcase-prop registry; the shark entries below are still inline. */
const REGISTRY = JSON.parse(readFileSync(join(root, "assets-src/briefcase/models.json"), "utf8"));

/**
 * `npm run models -- --only t5-gold,key-t1` rebuilds a subset. Matched
 * against the registry slug for briefcase props and against a slug-ish form
 * of the name for the two sharks ("pitch-screen-shark", "landing-champion").
 */
const onlyFlag = process.argv.indexOf("--only");
const ONLY = onlyFlag >= 0 && process.argv[onlyFlag + 1]
  ? new Set(process.argv[onlyFlag + 1].split(",").map((s) => s.trim()).filter(Boolean))
  : null;

/**
 * The two meshes, and what each is actually looked at through.
 *
 * `ratio` and the texture sizes are set from the RENDER BOX, not from a byte
 * target — that is the whole correction this file encodes. A mascot in a
 * 176 px card does not need a 2048² normal map, and no amount of compression
 * makes uploading one cheap.
 */
const MODELS = [
  {
    name: "pitch-screen shark",
    // The tracked 23.7 MB original, so decimation starts from full density
    // rather than from an already-lossy intermediate.
    from: "assets-src/shark.original.glb",
    to: "public/shark/shark-v2.glb",
    ratio: 0.15,
    // Rendered into h-32 … h-56 boxes (128–224 px) on the pitch screen, while
    // the camera and the speech pipeline are running.
    textures: [{ pattern: null, size: 512 }],
  },
  {
    name: "landing champion",
    // No full-density original for this pose — the previously-shipped mesh IS
    // the source. It moved out of public/ into assets-src/ when it stopped
    // being served: a 2.16 MB file that nothing loads is still 2.16 MB in the
    // native bundle. gltf-transform reads its meshopt encoding fine.
    from: "assets-src/shark-champion.original.glb",
    to: "public/models/shark-champion-v2.glb",
    ratio: 0.2,
    // The hero, ~200–300 px tall. Base colour keeps 1024² because it is the
    // one map a viewer can actually resolve; the rest are lighting detail at
    // that size and go to 512².
    textures: [
      { pattern: "*{normal,metallic,roughness,emissive,occlusion}*", size: 512 },
      { pattern: null, size: 1024 },
    ],
  },
  /*
   * The briefcase-system props — five cases, the Shark Token, five keys —
   * from Meshy (image-to-3D off the shipped 2-D art; see
   * scripts/generate-briefcase-models.mjs). The list is READ from the
   * registry, `assets-src/briefcase/models.json`, so a slug or a version
   * bumped there is built here without a second edit; scripts/validate-models.mjs
   * fails the build if lib/rewards/models.ts does not agree.
   *
   * These spin in the unlock ceremony at roughly 260-360 px and are the only
   * mesh on screen while they do it, so they can afford a little more
   * geometry than the mascot — but only a little: the ceremony is the moment
   * the game must not stutter, and on a mid-range phone the frame it drops is
   * the one the player is looking hardest at. The token and keys render
   * smaller still (a 40-96 px prop beside a number), and share the setting
   * rather than earning a lower one: at ratio 0.35 of a 30k-triangle Meshy
   * export the whole set lands under 300 kB a file.
   *
   * Meshy exports arrive around 1-3 MB with 2048² maps (base colour plus,
   * with PBR, metallic-roughness and normal), which is film density for a
   * prop the size of a playing card.
   *
   * An entry whose `.original.glb` has not been generated yet is reported
   * and skipped rather than failing the run, so a partly regenerated set can
   * still be built; the validator is what insists on the full set.
   */
  ...REGISTRY.models.map((m) => ({
    name: `${m.name} (briefcase ${m.kind})`,
    slug: m.slug,
    from: `assets-src/briefcase/models/${m.slug}.original.glb`,
    to: `public/briefcase/models/${m.slug}-v${m.version}.glb`,
    ratio: 0.35,
    textures: [{ pattern: null, size: 512 }],
  })),
];

const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;

/** gltf-transform, quietly, with a heap big enough for the 23 MB original. */
function gltf(args) {
  execFileSync("npx", ["--yes", CLI, ...args], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=3072" },
  });
}

/**
 * The scene bounding box, read back through the CLI.
 *
 * Parsed out of `--format csv` because `inspect` has no JSON mode. The SCENES
 * table quotes each vector as one field — `"-0.95, -0.77, -0.64"` — so the six
 * numbers are recovered by pulling the two quoted groups off the data row
 * rather than by splitting on commas, which would split inside them.
 */
function boundingBox(file) {
  const out = execFileSync("npx", ["--yes", CLI, "inspect", file, "--format", "csv"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=3072" },
  });
  const scenes = out.slice(out.indexOf("SCENES"));
  const row = scenes.split("\n").find((line) => /^\d+,/.test(line.trim()));
  const vectors = row?.match(/"([^"]+)"/g) ?? [];
  const numbers = vectors.flatMap((v) => v.replace(/"/g, "").split(",").map(Number));
  if (numbers.length !== 6 || numbers.some(Number.isNaN)) {
    throw new Error(`could not read a bounding box out of ${file}`);
  }
  return numbers;
}

let failed = false;

let built = 0;
for (const model of MODELS) {
  const slug = model.slug ?? model.name.replace(/\s+/g, "-");
  if (ONLY && !ONLY.has(slug)) continue;
  const source = join(root, model.from);
  if (!existsSync(source)) {
    console.log(`\n${model.name}\n  ${model.from} is not there yet — skipped (generate it first)`);
    continue;
  }
  console.log(`\n${model.name}`);
  built++;
  const before = statSync(source).size;

  let step = join(work, "welded.glb");
  gltf(["weld", source, step]);

  const simplified = join(work, "simplified.glb");
  gltf(["simplify", step, simplified, "--ratio", String(model.ratio), "--error", "0.001"]);
  step = simplified;

  model.textures.forEach((texture, i) => {
    const next = join(work, `resized-${i}.glb`);
    gltf([
      "resize",
      step,
      next,
      "--width",
      String(texture.size),
      "--height",
      String(texture.size),
      ...(texture.pattern ? ["--pattern", texture.pattern] : []),
    ]);
    step = next;
  });

  const out = join(root, model.to);
  gltf(["optimize", step, out, "--compress", "meshopt", "--texture-compress", "webp"]);

  const after = statSync(out).size;
  console.log(`  ${model.from} ${mb(before)} → ${model.to} ${mb(after)}`);

  /*
   * The invariant, checked rather than assumed. A tolerance and not equality:
   * simplify moves vertices by up to `--error`, so the extreme vertex on an
   * axis can shift by a fraction of a unit. 0.002 is roughly twice that and
   * far below anything visible; a real scale change would be a factor, not a
   * thousandth.
   */
  const src = boundingBox(source);
  const dst = boundingBox(out);
  const drift = Math.max(...src.map((v, i) => Math.abs(v - dst[i])));
  if (drift > 0.002) {
    failed = true;
    console.log(
      `  ✗ bounding box moved by ${drift.toFixed(5)} — SharkCanvas scales by a ` +
        `hardcoded MODEL_SCALE and will render this at the wrong size`,
    );
  } else {
    console.log(`  ✓ scale preserved (max drift ${drift.toFixed(5)})`);
  }
}

/*
 * Name what is now stale. A superseded `-v1.glb` is not deleted here — the
 * header's rule is that replacing a served file is a deliberate act — but
 * validate-models.mjs will refuse to pass `npm run events` until it is gone,
 * so say so now, next to the build that made it stale.
 */
{
  const dir = join(root, "public/briefcase/models");
  const wanted = new Set(REGISTRY.models.map((m) => `${m.slug}-v${m.version}.glb`));
  const stale = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".glb") && !wanted.has(f))
    : [];
  if (stale.length) {
    console.log(`\nstale in public/briefcase/models/ (no registry entry at that version — delete before committing):`);
    for (const f of stale) console.log(`  · ${f}`);
  }
}

console.log(`\n${built} model(s) built`);
rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
