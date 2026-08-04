#!/usr/bin/env node
/**
 * The onboarding clip pipeline.
 *
 * `public/onboarding/` is 9.0 MB of mp4 — the three beats of `LoopExplainer`,
 * and the largest single directory left in `public/` after the dead shark clips
 * came out. This shrinks it in two passes, kept separate on purpose because
 * only one of them can change a pixel.
 *
 *   node scripts/make-clips.mjs            # pass 1 only — lossless, always safe
 *   node scripts/make-clips.mjs --encode   # pass 1 + pass 2
 *   node scripts/make-clips.mjs --check    # report what each pass would save
 *
 * ── Pass 1 · strip (lossless, no quality risk whatsoever) ───────────────────
 *
 * Every clip carries an AAC audio track and a 13,668-byte XMP `uuid` box from
 * whatever exported them. Both are unreachable: `LoopExplainer.tsx:209` renders
 * these `muted`, `aria-hidden="true"` and without controls — they are
 * illustration, not media, and there is no code path in the app that unmutes
 * them. `-c copy` remuxes the video stream byte-for-byte and drops the rest, so
 * the decoded frames are bit-identical to what ships today. Measured payload:
 * ~801 KB of AAC + ~41 KB of XMP.
 *
 * NOT included here, deliberately: `-movflags +faststart`. Every one of these
 * files already has `moov` ahead of `mdat` — checked by parsing the box order,
 * not assumed — so there is nothing for it to fix.
 *
 * ── Pass 2 · re-encode (changes pixels — look at the output) ────────────────
 *
 * CRF 30 with a slow preset. These are flat-shaded mascot renders and one lit
 * 3D set, which is content H.264 handles well above its usual bitrate class;
 * the win is real and the artefacts land in gradients rather than on edges.
 * `--encode` writes to `*.new.mp4` and stops rather than overwriting, because
 * a re-encode is a thing a person should look at before it becomes the asset.
 *
 * ── Why this is a script and not a commit ───────────────────────────────────
 *
 * ffmpeg is not in the CI container these files were last touched from, so the
 * exact invocation lived in someone's shell history and the saving never
 * landed. It lives here now.
 */
import { existsSync, statSync, readFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(root, "public", "onboarding");
const CLIPS = ["months", "tank", "choices"];

const encode = process.argv.includes("--encode");
const checkOnly = process.argv.includes("--check");

function haveFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Walks the MP4 box tree far enough to answer two questions: which track
 * handlers are present, and how many bytes sit in boxes that carry no picture.
 * Enough to report the saving honestly without shelling out to ffprobe.
 */
function probe(path) {
  const buf = readFileSync(path);
  const found = [];
  (function walk(start, end) {
    let p = start;
    while (p + 8 <= end) {
      let size = buf.readUInt32BE(p);
      const type = buf.toString("latin1", p + 4, p + 8);
      let hdr = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(p + 8));
        hdr = 16;
      }
      if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      found.push({ type, size, p });
      if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) walk(p + hdr, p + size);
      p += size;
    }
  })(0, buf.length);

  const sum = (t) => found.filter((b) => b.type === t).reduce((n, b) => n + b.size, 0);
  return {
    tracks: found.filter((b) => b.type === "hdlr").map((b) => buf.toString("latin1", b.p + 16, b.p + 20)),
    uuid: sum("uuid"),
    faststart: found.findIndex((b) => b.type === "moov") < found.findIndex((b) => b.type === "mdat"),
  };
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
let before = 0;

console.log("\n  Onboarding clips\n");
for (const name of CLIPS) {
  const src = join(DIR, `${name}.mp4`);
  if (!existsSync(src)) {
    console.log(`  · ${name}.mp4 — missing, skipped`);
    continue;
  }
  const size = statSync(src).size;
  before += size;
  const info = probe(src);
  console.log(
    `  · ${name.padEnd(8)} ${mb(size).padStart(8)}  tracks=${info.tracks.join("+")}` +
      `  xmp=${info.uuid}B  faststart=${info.faststart ? "yes" : "NO"}`,
  );
}
console.log(`\n  total ${mb(before)}`);

if (checkOnly) {
  console.log("\n  --check only; nothing written.\n");
  process.exit(0);
}

if (!haveFfmpeg()) {
  console.error(
    "\n  ✗ ffmpeg not found on PATH.\n" +
      "    This is the one asset step that needs it. Install ffmpeg and re-run:\n" +
      "      macOS   brew install ffmpeg\n" +
      "      Debian  sudo apt install ffmpeg\n",
  );
  process.exit(1);
}

console.log("\n  Pass 1 · stripping audio and metadata (lossless remux)\n");
let after = 0;
for (const name of CLIPS) {
  const src = join(DIR, `${name}.mp4`);
  if (!existsSync(src)) continue;
  const tmp = join(DIR, `${name}.stripped.mp4`);
  execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", src, "-map", "0:v", "-c", "copy", "-map_metadata", "-1", tmp],
    { stdio: "inherit" },
  );
  const from = statSync(src).size;
  const to = statSync(tmp).size;
  renameSync(tmp, src);
  after += to;
  console.log(`  · ${name.padEnd(8)} ${mb(from)} → ${mb(to)}  (−${((1 - to / from) * 100).toFixed(1)}%)`);
}
console.log(`\n  total ${mb(before)} → ${mb(after)}\n`);

if (!encode) {
  console.log("  Pass 2 skipped. Re-run with --encode to write CRF 30 candidates.\n");
  process.exit(0);
}

console.log("  Pass 2 · re-encoding at CRF 30 → *.new.mp4 (not installed)\n");
for (const name of CLIPS) {
  const src = join(DIR, `${name}.mp4`);
  if (!existsSync(src)) continue;
  const out = join(DIR, `${name}.new.mp4`);
  execFileSync(
    "ffmpeg",
    [
      "-y", "-loglevel", "error", "-i", src,
      "-c:v", "libx264", "-crf", "30", "-preset", "slow",
      "-pix_fmt", "yuv420p", "-an", "-map_metadata", "-1",
      "-movflags", "+faststart", out,
    ],
    { stdio: "inherit" },
  );
  console.log(
    `  · ${name.padEnd(8)} ${mb(statSync(src).size)} → ${mb(statSync(out).size)}  ${name}.new.mp4`,
  );
}
console.log(
  "\n  Look at the .new.mp4 files against the originals before installing them:\n" +
    "    mv public/onboarding/NAME.new.mp4 public/onboarding/NAME.mp4\n" +
    "  Check the mascot's edges on the two keyed clips (months, choices) — they\n" +
    "  composite with mix-blend-mode: multiply, so matte noise is visible there\n" +
    "  in a way it is not on tank.mp4.\n",
);
