#!/usr/bin/env node
/**
 * Briefcase-system art generation (Gemini image API).
 *
 *   node scripts/generate-briefcase-art.mjs <command> [flags]
 *
 * Commands
 *   bases    generate canon-founder candidates (default 6 per base)
 *   crown    promote one candidate to canon:  crown --base novus --pick 3
 *   skins    generate every skins.csv row × both bases (needs crowned canons)
 *   props    generate cases ×3 states, keys, token, frames, scenes, poses
 *   all      skins + props
 *   status   report what exists and what is missing
 *
 * Flags
 *   --model <id>        image model (default gemini-3-pro-image)
 *   --concurrency <n>   parallel requests (default 2 — the API throttles hard)
 *   --limit <n>         stop after n new generations (for smoke runs)
 *   --only <ids>        comma-separated skin ids or prop ids to (re)generate
 *   --force             regenerate even if the raw file exists
 *   --candidates <n>    how many base candidates per gender (default 6)
 *   --mock              no network: writes deterministic placeholder PNGs so
 *                       the whole pipeline can be exercised without quota
 *
 * CONSISTENCY RULES (plan §11.4) — the code enforces what it can:
 *   1. Reference images ride along on EVERY request: the Marcus Cole render
 *      (public/sharks/marcus.webp) pins the toy style, and for skins/poses the
 *      crowned canon founder pins the face. Never generate without them.
 *   2. The style block is read from assets-src/briefcase/style_v1.txt and never
 *      paraphrased. Editing it means regenerating everything after.
 *   3. Generate the whole set in one window on ONE model. If quota dies
 *      mid-set, resume on the SAME model — this script never mixes models
 *      silently, it aborts instead.
 *   4. Only the outfit block varies between skin prompts.
 *
 * Raw output lands in .assets-staging/briefcase/ (gitignored — these are the
 * QA masters). scripts/build-briefcase-art.mjs turns them into the committed
 * webp under public/briefcase/ plus manifest.json.
 *
 * GEMINI_API_KEY comes from the environment and is never written anywhere.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, appendFileSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets-src", "briefcase");
const STAGING = join(root, ".assets-staging", "briefcase");
const CANON = join(SRC, "canon");
const STYLE_REF = join(root, "public", "sharks", "marcus.webp");

// ── CLI ──────────────────────────────────────────────────────────────────────

const [, , command, ...rest] = process.argv;
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const k = rest[i].slice(2);
    const v = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
    flags[k] = v;
  }
}
/** A mistyped numeric flag must die loudly — Number("two") is NaN, and NaN
 *  worker counts silently spawn zero workers and "succeed". */
function numFlag(name, dflt) {
  const v = Number(flags[name] ?? dflt);
  if (!Number.isFinite(v) || v < (name === "limit" ? 1 : 0)) {
    console.error(`--${name} needs a number, got "${flags[name]}"`);
    process.exit(2);
  }
  return v;
}

const MODEL = flags.model ?? "gemini-3-pro-image";
const CONCURRENCY = Math.max(1, numFlag("concurrency", 2));
const LIMIT = flags.limit ? numFlag("limit", 1) : Infinity;
const ONLY = flags.only ? String(flags.only).split(",").map((s) => s.trim()) : null;
const FORCE = Boolean(flags.force);
const MOCK = Boolean(flags.mock);
const CANDIDATES = Math.max(1, numFlag("candidates", 6));

if (!command || !["bases", "crown", "skins", "props", "all", "status"].includes(command)) {
  console.error("usage: node scripts/generate-briefcase-art.mjs <bases|crown|skins|props|all|status> [flags]");
  process.exit(2);
}

// ── Content sources ──────────────────────────────────────────────────────────

const STYLE = readFileSync(join(SRC, "style_v1.txt"), "utf8").trim();
const STYLE_OBJ = readFileSync(join(SRC, "style_object_v1.txt"), "utf8").trim();
const STYLE_SPRITE = readFileSync(join(SRC, "style_sprite_v1.txt"), "utf8").trim();
const NEG = readFileSync(join(SRC, "negative_v1.txt"), "utf8").trim();
const BASES = JSON.parse(readFileSync(join(SRC, "bases.json"), "utf8"));
delete BASES._comment; // annotation, not a founder
const PROPS = JSON.parse(readFileSync(join(SRC, "props.json"), "utf8"));

/** Quoted-field CSV, just enough for skins.csv (commas and "" escapes inside quotes). */
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

// ── Prompt assembly (plan §10.3 — the template is code, not 200 paragraphs) ──

const skinPrompt = (base, outfit) =>
  `${STYLE} The character is ${BASES[base].description}, exactly matching the first reference image's face, ` +
  `proportions and material. Outfit: ${outfit}. Keep pose, camera, lighting and background identical to the ` +
  `first reference image. The second reference image shows the same collectible toy line — match its art style ` +
  `and material quality. ${NEG}`;

const basePrompt = (base) =>
  `${STYLE} The character is ${BASES[base].description}. Outfit: ${BASES[base].candidateOutfit}. ` +
  `Match the attached reference image's art style, material quality, proportions and lighting exactly — ` +
  `it is the same collectible toy line. ${NEG}`;

const objectPrompt = (core) =>
  `${STYLE_OBJ} ${PROPS.objectMode}. The object: ${core}. Match the attached reference image's art style and ` +
  `material quality exactly — it is the same collectible toy line. ${NEG}`;

const scenePrompt = (core) =>
  `${core}. Match the attached reference image's art style and material quality — it is the same collectible ` +
  `toy world. no photorealism, no text or watermark, no characters`;

const spritePrompt = (core) =>
  `${STYLE_SPRITE} The element: ${core}. The attached reference image shows the game's collectible toy line — ` +
  `match its playful character and color spirit, but render strictly as a FLAT 2D sprite, not a 3D render. ` +
  `no photorealism, no text or watermark, no background props`;

const posePrompt = (core) =>
  `${STYLE} The character exactly matches the first reference image's face, proportions, outfit and material. ` +
  `Pose change only: ${core}. Keep camera, lighting and background identical to the first reference image. ` +
  `The second reference image shows the same collectible toy line — match its art style. ${NEG}`;

// ── Gemini call ──────────────────────────────────────────────────────────────

const refPart = (path) => {
  const mime = path.endsWith(".webp") ? "image/webp" : "image/png";
  return { inline_data: { mime_type: mime, data: readFileSync(path).toString("base64") } };
};

let styleRefCached;
const styleRef = () => (styleRefCached ??= refPart(STYLE_REF));

class QuotaZeroError extends Error {}
/** Bad key, bad model, no permission — every job would fail identically, so
 *  the whole run aborts instead of burning hours of backoff × 244 jobs. */
class FatalApiError extends Error {}

async function generateImage({ prompt, refs, aspect = "1:1" }) {
  const config = { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: aspect } };
  // imageSize exists on gemini-3+ image models only; 2.5 rejects it.
  if (!MODEL.startsWith("gemini-2.5")) config.imageConfig.imageSize = "1K";
  const body = JSON.stringify({
    contents: [{ parts: [...refs, { text: prompt }] }],
    generationConfig: config,
  });

  let httpAttempts = 0, emptyAttempts = 0;
  while (true) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      { method: "POST", headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" }, body },
    );
    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const img = parts.find((p) => p.inlineData?.data);
      if (img) return Buffer.from(img.inlineData.data, "base64");
      // No image part — usually a safety block or an empty candidate. One
      // clean retry on its own counter, not the HTTP error budget.
      if (emptyAttempts++ < 1) continue;
      throw new Error(`no image in response: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const msg = json.error?.message ?? `HTTP ${res.status}`;
    // "limit: 0" means the project has no image quota AT ALL (billing not
    // enabled) — retrying is pointless and mixing models mid-set is worse.
    if (res.status === 429 && msg.includes("limit: 0")) throw new QuotaZeroError(msg);
    // Permanent client errors never heal on retry.
    if ([400, 401, 403, 404].includes(res.status)) throw new FatalApiError(`HTTP ${res.status}: ${msg.slice(0, 300)}`);
    if (++httpAttempts > 4) throw new Error(msg.slice(0, 400));
    const retryS = Number(/retry in (\d+(\.\d+)?)s/i.exec(msg)?.[1]) || 8 * 2 ** (httpAttempts - 1);
    await new Promise((r) => setTimeout(r, Math.min(retryS, 120) * 1000));
  }
}

// ── Mock PNG (pure node: RGBA scanlines → zlib → chunks) ─────────────────────

function crc32(buf) {
  let c, table = crc32.table ??= Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** White field with a centered colored block — enough for keying + trim to work. */
function mockPng(seedText, w = 1024, h = 1024) {
  let hash = 2166136261;
  for (const ch of seedText) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  const [r, g, b] = [(hash >>> 16) & 0xff, (hash >>> 8) & 0xff, hash & 0xff];
  const raw = Buffer.alloc(h * (1 + w * 4), 0xff);
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter: none
    if (y > h * 0.2 && y < h * 0.85) {
      for (let x = Math.floor(w * 0.3); x < w * 0.7; x++) {
        const o = y * (1 + w * 4) + 1 + x * 4;
        raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Job runner: resumable, concurrent, honest about failures ─────────────────

// The API answers PNG today, but nothing guarantees it forever — accept any
// magic sharp can decode (the build step reads content, not extensions).
const looksLikeImage = (b) =>
  (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) || // png
  (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // jpeg
  (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46); // webp/riff

async function runJobs(jobs) {
  const pending = jobs.filter((j) => FORCE || !existsSync(j.out));
  const todo = pending.slice(0, LIMIT);
  console.log(`${jobs.length} assets, ${jobs.length - pending.length} already done, ${todo.length} to generate (model ${MOCK ? "MOCK" : MODEL})`);
  if (!todo.length) return { ok: 0, failed: 0 };
  if (!MOCK && !process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set");
    process.exit(1);
  }

  let ok = 0, failed = 0, aborted = false;
  const queue = [...todo];
  const worker = async () => {
    while (!aborted) {
      const job = queue.shift(); // take a job only after the abort check, so
      if (!job) break;           // aborting never swallows queued work
      try {
        const png = MOCK ? mockPng(job.key) : await generateImage(job);
        if (!MOCK && (!looksLikeImage(png) || png.length < 20_000))
          throw new Error(`suspicious output (${png.length} bytes)`);
        mkdirSync(dirname(job.out), { recursive: true });
        // Write-then-rename: a crash mid-write must not leave a truncated
        // file at the final path, or resume would count it "done" forever.
        writeFileSync(`${job.out}.tmp`, png);
        renameSync(`${job.out}.tmp`, job.out);
        appendFileSync(join(STAGING, "generation-log.jsonl"),
          JSON.stringify({ key: job.key, model: MOCK ? "mock" : MODEL, bytes: png.length, at: new Date().toISOString() }) + "\n");
        ok++;
        console.log(`  ✓ ${job.key}  ${(png.length / 1024).toFixed(0)} KB  (${ok + failed}/${todo.length})`);
      } catch (e) {
        if (e instanceof QuotaZeroError) {
          aborted = true;
          console.error(
            `\n✗ this Google project has ZERO image-generation quota (free tier).\n` +
            `  The Gemini API only serves image models with billing enabled — enable billing on the\n` +
            `  project behind GEMINI_API_KEY at https://aistudio.google.com/ (Settings → Plan) or\n` +
            `  https://console.cloud.google.com/billing, then re-run this exact command; it resumes\n` +
            `  where it stopped.\n  API said: ${e.message.slice(0, 200)}`);
          break;
        }
        if (e instanceof FatalApiError) {
          aborted = true;
          console.error(`\n✗ the API rejected the request outright — fix the key/model and re-run.\n  ${e.message}`);
          break;
        }
        failed++;
        console.error(`  ✗ ${job.key}: ${e.message.slice(0, 200)}`);
      }
    }
  };
  mkdirSync(STAGING, { recursive: true });
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n${ok} generated, ${failed} failed, ${queue.length} not attempted`);
  if (aborted || failed) process.exitCode = 1;
  return { ok, failed };
}

// ── Job builders ─────────────────────────────────────────────────────────────

const canonPath = (base) => join(CANON, `${base}.png`);

function needCanon() {
  const missing = Object.keys(BASES).filter((b) => !existsSync(canonPath(b)));
  if (missing.length) {
    console.error(
      `✗ no crowned canon render for: ${missing.join(", ")}.\n` +
      `  Run \`bases\` to generate candidates, review .assets-staging/briefcase/bases/,\n` +
      `  then \`crown --base <name> --pick <n>\`. Skins hard-require the canon reference\n` +
      `  or the 200-render set drifts apart (plan §11.4).`);
    process.exit(1);
  }
}

const baseJobs = () =>
  Object.keys(BASES).flatMap((base) =>
    Array.from({ length: CANDIDATES }, (_, i) => ({
      key: `base:${base}-${i + 1}`,
      out: join(STAGING, "bases", `${base}-${i + 1}.png`),
      prompt: basePrompt(base),
      refs: [styleRef()],
    })));

function skinJobs() {
  needCanon();
  const canonRefs = Object.fromEntries(Object.keys(BASES).map((b) => [b, refPart(canonPath(b))]));
  return SKINS
    .filter((s) => !ONLY || ONLY.includes(s.id))
    .flatMap((s) =>
      Object.keys(BASES).map((base) => ({
        key: `skin:${s.id}_${base}`,
        out: join(STAGING, "raw", "skins", `${s.id}_${base}.png`),
        prompt: skinPrompt(base, s.outfit_block),
        refs: [canonRefs[base], styleRef()],
      })));
}

function propJobs() {
  // --only matches EXACT ids, never substrings — "t1" must not drag the six
  // t1-canvas/t1-denim case states along with the tier-1 key. A case can be
  // addressed whole ("t1-canvas") or per state ("t1-canvas-closed").
  const wanted = (...aliases) => !ONLY || aliases.some((a) => ONLY.includes(a));
  const jobs = [];
  for (const c of PROPS.cases)
    for (const [state, phrase] of Object.entries(PROPS.caseStates))
      if (wanted(c.id, `${c.id}-${state}`))
        jobs.push({
          key: `case:${c.id}-${state}`,
          out: join(STAGING, "raw", "props", `case-${c.id}-${state}.png`),
          prompt: objectPrompt(`${c.core} — ${phrase}`),
          refs: [styleRef()],
        });
  for (const k of PROPS.keys)
    if (wanted(k.id, `key-${k.id}`))
      jobs.push({
        key: `key:${k.id}`,
        out: join(STAGING, "raw", "props", `key-${k.id}.png`),
        prompt: objectPrompt(k.core),
        refs: [styleRef()],
      });
  for (const o of PROPS.objects)
    if (wanted(o.id))
      jobs.push({
        key: `object:${o.id}`,
        out: join(STAGING, "raw", "props", `${o.id}.png`),
        prompt: objectPrompt(o.core),
        refs: [styleRef()],
      });
  for (const s of PROPS.scenes)
    if (wanted(s.id))
      jobs.push({
        key: `scene:${s.id}`,
        out: join(STAGING, "raw", "props", `${s.id}.png`),
        prompt: scenePrompt(s.core),
        refs: [styleRef()],
        aspect: s.aspect ?? "16:9",
      });
  // Only surviving pose jobs need the crowned canons — `props --only
  // shark-token` must work on a fresh checkout with nothing crowned yet.
  const poses = PROPS.poses.filter((p) => wanted(p.id));
  if (poses.length) needCanon();
  for (const p of poses)
    jobs.push({
      key: `pose:${p.id}`,
      out: join(STAGING, "raw", "props", `${p.id}.png`),
      prompt: posePrompt(p.core),
      refs: [refPart(canonPath(p.base)), styleRef()],
    });
  // FX sprites are flat 2D (Zach, 29 Aug: AI-generated too, not hand-drawn
  // SVG). The style reference still rides along — every request carries it —
  // but the prompt pins the output to 2D so the render style doesn't leak in.
  for (const s of PROPS.sprites)
    if (wanted(s.id))
      jobs.push({
        key: `sprite:${s.id}`,
        out: join(STAGING, "raw", "sprites", `${s.id}.png`),
        prompt: spritePrompt(s.core),
        refs: [styleRef()],
      });
  return jobs;
}

// ── Commands ─────────────────────────────────────────────────────────────────

if (command === "bases") {
  await runJobs(baseJobs());
  console.log(`\nReview .assets-staging/briefcase/bases/ and crown one per base:\n  node scripts/generate-briefcase-art.mjs crown --base novus --pick <n>`);
} else if (command === "crown") {
  const base = flags.base, pick = flags.pick;
  if (!BASES[base] || !pick) {
    console.error("usage: crown --base <novus|nova> --pick <candidate #>");
    process.exit(2);
  }
  const src = join(STAGING, "bases", `${base}-${pick}.png`);
  if (!existsSync(src)) { console.error(`✗ no candidate at ${src}`); process.exit(1); }
  mkdirSync(CANON, { recursive: true });
  copyFileSync(src, canonPath(base));
  console.log(`✓ crowned ${base} ← candidate ${pick} → assets-src/briefcase/canon/${base}.png (commit this — it anchors every skin render)`);
} else if (command === "skins") {
  await runJobs(skinJobs());
} else if (command === "props") {
  await runJobs(propJobs());
} else if (command === "all") {
  await runJobs([...skinJobs(), ...propJobs()]);
} else if (command === "status") {
  const count = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).length : 0);
  const skinsTotal = SKINS.length * Object.keys(BASES).length;
  const propsTotal = PROPS.cases.length * 3 + PROPS.keys.length + PROPS.objects.length + PROPS.scenes.length + PROPS.poses.length;
  console.log(`canon:      ${Object.keys(BASES).filter((b) => existsSync(canonPath(b))).map((b) => b).join(", ") || "none crowned"}`);
  console.log(`candidates: ${count(join(STAGING, "bases"))}`);
  console.log(`skins:      ${count(join(STAGING, "raw", "skins"))} / ${skinsTotal}`);
  console.log(`props:      ${count(join(STAGING, "raw", "props"))} / ${propsTotal}`);
  console.log(`sprites:    ${count(join(STAGING, "raw", "sprites"))} / ${PROPS.sprites.length}`);
}
