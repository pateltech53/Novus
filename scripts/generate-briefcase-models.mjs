#!/usr/bin/env node
/**
 * Briefcase-system 3-D generation (Meshy API).
 *
 *   node scripts/generate-briefcase-models.mjs <command> [flags]
 *   npm run art:models -- <command> [flags]
 *
 * Commands
 *   generate   lift every registry entry into a textured GLB (resumable)
 *   install    copy finished GLBs + thumbnails into the repo, write provenance
 *   status     what exists, what is missing, what Meshy is still chewing on
 *
 * Flags
 *   --only <slugs>       comma-separated registry slugs to (re)generate
 *   --force              regenerate even if a finished GLB is staged
 *   --route image|text   override the route (default: image when the entry
 *                        has an `image`, else text)
 *   --model <id>         Meshy model id (default "latest": Meshy 7 on the
 *                        image route, Meshy 6 on the text route — text-to-3D
 *                        does not offer 7)
 *   --no-pbr             base colour only (default asks for PBR maps)
 *   --concurrency <n>    parallel tasks (default 4)
 *   --limit <n>          stop after n new generations (smoke runs)
 *   --mock               no network, no credits: writes a valid one-triangle
 *                        GLB and a 1×1 PNG into a SEPARATE staging root so
 *                        the plumbing can be exercised without touching the
 *                        real masters. `install --mock` is a dry run.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * The first six briefcase GLBs (#108) were made by hand in the Meshy web app,
 * round-tripped through Blender, and committed. Nothing recorded the prompts
 * or settings, the account behind this key holds no API task for any of them,
 * and the Blender export dropped every material: `gltf-transform inspect` on
 * each `.original.glb` reports "No materials found / No textures found". The
 * ceremony has been spinning an untextured grey mesh and calling it the Gold
 * Briefcase. `scripts/build-models.mjs` complains about exactly this failure
 * mode for the shark — a derivation that lived in somebody's shell history —
 * and this script is the same fix applied to the props: the registry
 * (`assets-src/briefcase/models.json`) is the source of truth, the task ids
 * and settings land in `assets-src/briefcase/models/provenance.json`, and
 * anyone with a key can rebuild the set.
 *
 * ── The route ───────────────────────────────────────────────────────────────
 *
 * Image-to-3D from the shipped 2-D art, not text-to-3D from a sentence. The
 * Gemini pipeline already spent its consistency budget getting every case,
 * key and token into one toy style on one white ground; lifting those exact
 * renders (the lossless `art-review/` masters, keyed alpha and all) keeps the
 * 3-D set in step with the 2-D set — the same latch, the same tag, the same
 * gold — where a fresh text prompt re-rolls the design. It is also the better
 * model: Meshy's own tool description says to prefer the image route, and
 * image-to-3D is where Meshy 7 lives. Both routes cost the same 30 credits
 * per textured model (text: 20 preview + 10 refine; image: 30 textured).
 *
 * ── Resumable, like the art pipeline ────────────────────────────────────────
 *
 * Every slug owns a staging directory. A finished GLB there is skipped; an
 * in-flight task id there is re-polled rather than re-bought, so a killed
 * terminal or a dropped proxy costs nothing. Only `--force` throws a finished
 * model away. Insufficient credits (402) aborts the whole run at once instead
 * of failing one slug at a time.
 *
 * MESHY_API_KEY comes from the environment and is never written anywhere.
 * It is the same key the Meshy MCP server in `.mcp.json` reads.
 */
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets-src", "briefcase");
const REGISTRY_PATH = join(SRC, "models.json");
const ORIGINALS = join(SRC, "models");
const PROVENANCE_PATH = join(ORIGINALS, "provenance.json");
const REVIEW = join(root, "art-review", "briefcase", "models");
const GALLERY = join(root, "docs", "asset-review", "MODELS.md");

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
/** A mistyped numeric flag dies loudly — NaN workers "succeed" by doing nothing. */
function numFlag(name, dflt) {
  const raw = flags[name] ?? dflt;
  if (typeof raw === "boolean") { console.error(`--${name} needs a value`); process.exit(2); }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 1) { console.error(`--${name} needs a number ≥ 1, got "${flags[name]}"`); process.exit(2); }
  return v;
}

if (!["generate", "install", "status"].includes(command)) {
  console.error("usage: node scripts/generate-briefcase-models.mjs <generate|install|status> [flags]");
  process.exit(2);
}

const MOCK = Boolean(flags.mock);
const FORCE = Boolean(flags.force);
const ONLY = flags.only ? String(flags.only).split(",").map((s) => s.trim()).filter(Boolean) : null;
const ROUTE = flags.route ? String(flags.route) : null;
const MODEL = flags.model ? String(flags.model) : "latest";
const PBR = !flags["no-pbr"];
const CONCURRENCY = numFlag("concurrency", 4);
const LIMIT = flags.limit ? numFlag("limit", 1) : Infinity;
if (ROUTE && !["image", "text"].includes(ROUTE)) { console.error("--route must be image or text"); process.exit(2); }

// The mock run gets its own staging root so a plumbing test can never be
// mistaken for, or installed over, a real generation.
const STAGING = join(root, ".assets-staging", "briefcase", MOCK ? "models-mock" : "models");

const API = (process.env.MESHY_API_HOST ?? "https://api.meshy.ai").replace(/\/$/, "");
const KEY = process.env.MESHY_API_KEY;

// ── Registry ─────────────────────────────────────────────────────────────────

const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
const MODELS = registry.models;
{
  const slugs = new Set();
  for (const m of MODELS) {
    if (!/^[a-z0-9-]+$/.test(m.slug)) die(`registry: slug "${m.slug}" must be kebab-case`);
    if (slugs.has(m.slug)) die(`registry: slug "${m.slug}" appears twice`);
    slugs.add(m.slug);
    if (!Number.isInteger(m.version) || m.version < 1) die(`registry: ${m.slug} needs an integer version ≥ 1`);
    if (!m.image && !m.prompt) die(`registry: ${m.slug} has neither an image nor a prompt`);
    if (m.image && !existsSync(join(root, m.image))) die(`registry: ${m.slug} image ${m.image} does not exist`);
    if ((m.prompt ?? "").length > 600 || (m.texture ?? "").length > 600) die(`registry: ${m.slug} prompt/texture exceeds Meshy's 600 characters`);
  }
  if (ONLY) for (const s of ONLY) if (!slugs.has(s)) die(`--only: "${s}" is not in ${relative(root, REGISTRY_PATH)}`);
}
const selected = MODELS.filter((m) => !ONLY || ONLY.includes(m.slug));
/**
 * --route wins, then the registry's own `route` (an entry whose 2-D master is
 * off-model pins itself to text and says why in `note`), then the default:
 * image whenever there is one.
 */
const routeOf = (m) => ROUTE ?? m.route ?? (m.image ? "image" : "text");

function die(msg) { console.error(`✗ ${msg}`); process.exit(1); }
const stageDir = (slug) => join(STAGING, slug);
const stagedGlb = (slug) => join(stageDir(slug), `${slug}.glb`);
const stagedPng = (slug) => join(stageDir(slug), `${slug}.png`);
const stagedTask = (slug) => join(stageDir(slug), "task.json");
const readJson = (p, dflt) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : dflt);
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const log = (slug, event, extra = {}) => {
  mkdirSync(STAGING, { recursive: true });
  appendFileSync(join(STAGING, "log.jsonl"), JSON.stringify({ at: new Date().toISOString(), slug, event, ...extra }) + "\n");
};

// ── HTTP ─────────────────────────────────────────────────────────────────────

/**
 * One call, with the two failures that matter told apart. 402 is "out of
 * credits" and ends the run for everyone; 429 and 5xx are retried with
 * backoff because a burst of eleven task creations is exactly what a
 * per-minute limit is for. Anything else is this slug's problem.
 */
class OutOfCredits extends Error {}
async function api(path, init = {}, attempt = 0) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 402) throw new OutOfCredits(`Meshy: insufficient credits (${await res.text()})`);
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const wait = Math.min(60_000, 2_000 * 2 ** attempt);
    await sleep(wait);
    return api(path, init, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`Meshy ${init.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The task endpoints differ by route; `kind` is what the task.json remembers. */
const TASK_PATH = { image: "/openapi/v1/image-to-3d", text: "/openapi/v2/text-to-3d" };

/**
 * Poll until terminal. Meshy's own MCP tool backs off 5s→30s; a fixed 8s is
 * close enough and keeps the log readable. Thirty minutes is generous —
 * textured Meshy 7 runs land in three to eight — and a task past it is left
 * running server-side for a later resume rather than cancelled.
 */
async function waitFor(kind, id, slug, label) {
  const started = Date.now();
  let lastProgress = -1;
  for (;;) {
    const task = await api(`${TASK_PATH[kind]}/${id}`);
    if (task.progress !== lastProgress) {
      lastProgress = task.progress;
      console.log(`  ${slug} · ${label} ${task.status} ${task.progress ?? 0}%`);
    }
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(`${label} ${task.status}: ${task.task_error?.message ?? "no message"}`);
    }
    if (Date.now() - started > 30 * 60_000) throw new Error(`${label} still ${task.status} after 30 min — resume later`);
    await sleep(8_000);
  }
}

async function download(url, to) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} for ${url.slice(0, 80)}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

// ── The two routes ───────────────────────────────────────────────────────────

const dataUri = (file) => {
  const buf = readFileSync(file);
  const mime = file.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
};

/**
 * Image route: one task, textured. `texture_prompt` names the material so
 * the model pass does not have to guess "gold" from a JPEG's highlights, and
 * `should_remesh` + a triangle target hands build-models.mjs a mesh it can
 * decimate predictably instead of Meshy's raw marching-cubes density.
 */
async function generateFromImage(m, state) {
  if (!state.taskId) {
    const body = {
      image_url: dataUri(join(root, m.image)),
      ai_model: MODEL,
      should_texture: true,
      enable_pbr: PBR,
      should_remesh: true,
      topology: "triangle",
      target_polycount: registry.polycount ?? 30000,
      ...(m.texture ? { texture_prompt: m.texture } : {}),
    };
    const { result } = await api(TASK_PATH.image, { method: "POST", body: JSON.stringify(body) });
    state.taskId = result;
    state.route = "image";
    state.request = { ...body, image_url: `<${m.image}>` }; // never stage a megabyte of base64 twice
    save(m.slug, state);
    log(m.slug, "image-to-3d.created", { taskId: result });
  }
  return waitFor("image", state.taskId, m.slug, "image-to-3d");
}

/** Text route: preview (mesh) then refine (texture) — two tasks, two waits. */
async function generateFromText(m, state) {
  if (!state.previewId) {
    const body = {
      mode: "preview",
      prompt: m.prompt,
      ai_model: MODEL,
      should_remesh: true,
      topology: "triangle",
      target_polycount: registry.polycount ?? 30000,
    };
    const { result } = await api(TASK_PATH.text, { method: "POST", body: JSON.stringify(body) });
    state.previewId = result;
    state.route = "text";
    state.request = body;
    save(m.slug, state);
    log(m.slug, "text-to-3d.preview.created", { taskId: result });
  }
  const preview = await waitFor("text", state.previewId, m.slug, "preview");
  state.previewCredits = preview.consumed_credits ?? null;
  if (!state.taskId) {
    const body = {
      mode: "refine",
      preview_task_id: state.previewId,
      ai_model: MODEL,
      enable_pbr: PBR,
      ...(m.texture ? { texture_prompt: m.texture } : {}),
    };
    const { result } = await api(TASK_PATH.text, { method: "POST", body: JSON.stringify(body) });
    state.taskId = result;
    state.refineRequest = body;
    save(m.slug, state);
    log(m.slug, "text-to-3d.refine.created", { taskId: result });
  }
  return waitFor("text", state.taskId, m.slug, "refine");
}

function save(slug, state) {
  mkdirSync(stageDir(slug), { recursive: true });
  writeFileSync(stagedTask(slug), JSON.stringify(state, null, 2) + "\n");
}

// ── Mock output: a valid one-triangle GLB and a 1×1 PNG ─────────────────────

/**
 * Hand-assembled binary glTF: a JSON chunk and a BIN chunk holding three
 * positions with a declared min/max, which is everything gltf-transform's
 * weld/simplify/inspect need to run end to end. The triangle spans the same
 * ±0.95 box the real set is fitted to, so build-models' scale assertion is
 * exercised by the mock too.
 */
function mockGlb() {
  const positions = new Float32Array([-0.95, -0.95, 0, 0.95, -0.95, 0, 0, 0.95, 0]);
  const bin = Buffer.from(positions.buffer);
  const json = {
    asset: { version: "2.0", generator: "generate-briefcase-models.mjs --mock" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "mock" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.2, 1], metallicFactor: 1, roughnessFactor: 0.3 } }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [-0.95, -0.95, 0], max: [0.95, 0.95, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength, target: 34962 }],
    buffers: [{ byteLength: bin.byteLength }],
  };
  let jsonBuf = Buffer.from(JSON.stringify(json));
  while (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.from(" ")]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jsonHead = Buffer.alloc(8); jsonHead.writeUInt32LE(jsonBuf.length, 0); jsonHead.write("JSON", 4);
  const binHead = Buffer.alloc(8); binHead.writeUInt32LE(bin.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHead, jsonBuf, binHead, bin]);
}
const MOCK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

// ── generate ─────────────────────────────────────────────────────────────────

async function generateOne(m) {
  const slug = m.slug;
  if (existsSync(stagedGlb(slug)) && !FORCE) { console.log(`  ${slug} · staged, skipping`); return "skipped"; }
  if (FORCE) rmSync(stageDir(slug), { recursive: true, force: true });
  mkdirSync(stageDir(slug), { recursive: true });

  if (MOCK) {
    writeFileSync(stagedGlb(slug), mockGlb());
    writeFileSync(stagedPng(slug), MOCK_PNG);
    save(slug, { mock: true, route: routeOf(m), taskId: `mock-${slug}`, model: MODEL, pbr: PBR, finishedAt: new Date().toISOString(), credits: 0 });
    console.log(`  ${slug} · mock GLB written`);
    return "generated";
  }

  const state = readJson(stagedTask(slug), {});
  const route = state.route ?? routeOf(m);
  if (route === "image" && !m.image) throw new Error(`${slug} has no image; use --route text`);
  if (route === "text" && !m.prompt) throw new Error(`${slug} has no prompt; use --route image`);
  console.log(`  ${slug} · ${state.taskId ? "resuming" : "starting"} (${route}, ${MODEL}${PBR ? ", pbr" : ""})`);

  const task = route === "image" ? await generateFromImage(m, state) : await generateFromText(m, state);
  const glbUrl = task.model_urls?.glb;
  if (!glbUrl) throw new Error(`${slug}: task succeeded without a GLB url`);
  await download(glbUrl, stagedGlb(slug));
  if (task.thumbnail_url) await download(task.thumbnail_url, stagedPng(slug));

  Object.assign(state, {
    model: MODEL,
    pbr: PBR,
    // A text-route model is two paid tasks; the refine's own figure is 10 of
    // the 30 it actually cost, and provenance is where the next person reads
    // the price of a regeneration.
    credits: (task.consumed_credits ?? 0) + (state.previewCredits ?? 0) || null,
    finishedAt: new Date().toISOString(),
    sourceSha256: route === "image" && m.image ? sha256(readFileSync(join(root, m.image))) : null,
    task: { id: task.id, type: task.type, ai_model: task.ai_model ?? MODEL, texture_urls: task.texture_urls ?? null },
  });
  save(slug, state);
  log(slug, "done", { credits: state.credits, bytes: statSync(stagedGlb(slug)).size });
  console.log(`  ${slug} · ✓ ${(statSync(stagedGlb(slug)).size / 1e6).toFixed(2)} MB, ${state.credits ?? "?"} credits`);
  return "generated";
}

async function generate() {
  if (!MOCK && !KEY) die("MESHY_API_KEY is not set (it is only ever read from the environment)");
  if (!MOCK) {
    const { balance } = await api("/openapi/v1/balance");
    const todo = selected.filter((m) => FORCE || !existsSync(stagedGlb(m.slug))).length;
    console.log(`Meshy balance ${balance} credits · ${todo} model(s) to generate at ~30 each`);
    if (balance < todo * 30) console.log(`  ⚠ that is ${todo * 30 - balance} short — the run will stop at the first 402`);
  }
  mkdirSync(STAGING, { recursive: true });

  const queue = [...selected];
  let generated = 0, failed = 0;
  let aborted = null;
  const worker = async () => {
    while (queue.length && !aborted && generated < LIMIT) {
      const m = queue.shift();
      try {
        if ((await generateOne(m)) === "generated") generated++;
      } catch (err) {
        if (err instanceof OutOfCredits) { aborted = err; break; }
        failed++;
        log(m.slug, "failed", { error: String(err.message ?? err) });
        console.log(`  ${m.slug} · ✗ ${err.message ?? err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  if (aborted) die(`${aborted.message} — top up and re-run; finished models are kept`);
  console.log(`\n${generated} generated, ${failed} failed, ${selected.length - generated - failed} already staged`);
  if (generated || !failed) console.log(`next: node scripts/generate-briefcase-models.mjs install${MOCK ? " --mock" : ""}`);
  process.exit(failed ? 1 : 0);
}

// ── install ──────────────────────────────────────────────────────────────────

/**
 * Staging → repo. The Meshy GLB becomes the tracked `.original.glb` (the
 * full-density source build-models.mjs decimates from; the old Blender
 * export it replaces had no materials to lose), the Meshy render becomes the
 * review thumbnail, and provenance.json records enough to re-download or
 * reproduce every model: route, model, task ids, credits, the sha of the
 * image it was lifted from. Nothing here touches public/ — that is
 * `npm run models`, deliberately a second, visible step.
 */
function install() {
  const provenance = readJson(PROVENANCE_PATH, {});
  let installed = 0;
  for (const m of selected) {
    const slug = m.slug;
    if (!existsSync(stagedGlb(slug))) { console.log(`  ${slug} · not staged`); continue; }
    const state = readJson(stagedTask(slug), {});
    if (state.mock || MOCK) { console.log(`  ${slug} · mock — would install (dry run)`); continue; }
    const target = join(ORIGINALS, `${slug}.original.glb`);
    const same = existsSync(target) && sha256(readFileSync(target)) === sha256(readFileSync(stagedGlb(slug)));
    if (!same) copyFileSync(stagedGlb(slug), target);
    mkdirSync(REVIEW, { recursive: true });
    if (existsSync(stagedPng(slug))) copyFileSync(stagedPng(slug), join(REVIEW, `${slug}.png`));
    provenance[slug] = {
      name: m.name,
      version: m.version,
      route: state.route,
      model: state.task?.ai_model ?? state.model,
      pbr: state.pbr,
      tasks: state.route === "text" ? { preview: state.previewId, refine: state.taskId } : { imageTo3d: state.taskId },
      credits: state.credits,
      source: state.route === "image" ? { image: m.image, sha256: state.sourceSha256 } : { prompt: m.prompt },
      ...(m.note ? { note: m.note } : {}),
      texturePrompt: m.texture ?? null,
      generatedAt: state.finishedAt,
      originalSha256: sha256(readFileSync(target)),
      originalBytes: statSync(target).size,
      thumbnail: existsSync(join(REVIEW, `${slug}.png`)) ? `art-review/briefcase/models/${slug}.png` : null,
    };
    installed++;
    console.log(`  ${slug} · ${same ? "unchanged" : "installed"} → ${relative(root, target)}`);
  }
  if (installed) {
    const ordered = Object.fromEntries(MODELS.filter((m) => provenance[m.slug]).map((m) => [m.slug, provenance[m.slug]]));
    mkdirSync(ORIGINALS, { recursive: true });
    writeFileSync(PROVENANCE_PATH, JSON.stringify(ordered, null, 2) + "\n");
    writeGallery(ordered);
    console.log(`\nprovenance → ${relative(root, PROVENANCE_PATH)}`);
    console.log("next: npm run models   (decimates into public/briefcase/models/, then commit all three)");
  }
}

/** A GitHub-rendered gallery, same idea as docs/asset-review/README.md. */
function writeGallery(provenance) {
  const rel = (p) => `../../${p}`;
  const md = [];
  md.push("# Briefcase 3-D models — review gallery\n");
  md.push(
    "Every GLB the reward loop renders, as Meshy rendered it. Generated by " +
    "`scripts/generate-briefcase-models.mjs` from `assets-src/briefcase/models.json`; the served files are " +
    "`public/briefcase/models/<slug>-v<version>.glb` after `npm run models`. Provenance (route, model, task ids, " +
    "credits) is `assets-src/briefcase/models/provenance.json`.\n",
  );
  md.push("| Slug | Name | v | Route | Model | Credits | Lifted from | Meshy render |");
  md.push("|---|---|---|---|---|---|---|---|");
  for (const [slug, p] of Object.entries(provenance)) {
    const from = p.source.image ? `<img src="${rel(p.source.image)}" alt="${slug} source" width="110">` : "text prompt";
    const thumb = p.thumbnail ? `<img src="${rel(p.thumbnail)}" alt="${slug}" width="160">` : "—";
    md.push(`| \`${slug}\` | ${p.name} | ${p.version} | ${p.route} | ${p.model} | ${p.credits ?? "?"} | ${from} | ${thumb} |`);
  }
  md.push("");
  md.push("Regenerate one: `npm run art:models -- generate --only <slug> --force`, then `install`, then `npm run models`, and bump its `version` in models.json + `lib/rewards/models.ts` so the served name changes.");
  mkdirSync(dirname(GALLERY), { recursive: true });
  writeFileSync(GALLERY, md.join("\n") + "\n");
  console.log(`gallery → ${relative(root, GALLERY)}`);
}

// ── status ───────────────────────────────────────────────────────────────────

function status() {
  const provenance = readJson(PROVENANCE_PATH, {});
  const w = Math.max(...MODELS.map((m) => m.slug.length));
  console.log(`${"slug".padEnd(w)}  staged  installed  built  provenance`);
  for (const m of MODELS) {
    const staged = existsSync(stagedGlb(m.slug)) ? "yes" : existsSync(stagedTask(m.slug)) ? "task…" : "—";
    const installed = existsSync(join(ORIGINALS, `${m.slug}.original.glb`)) ? "yes" : "—";
    const built = existsSync(join(root, "public", "briefcase", "models", `${m.slug}-v${m.version}.glb`)) ? `v${m.version}` : "—";
    const prov = provenance[m.slug] ? `${provenance[m.slug].route}/${provenance[m.slug].model}` : "none";
    console.log(`${m.slug.padEnd(w)}  ${staged.padEnd(6)}  ${installed.padEnd(9)}  ${built.padEnd(5)}  ${prov}`);
  }
  const untracked = MODELS.filter((m) => existsSync(join(ORIGINALS, `${m.slug}.original.glb`)) && !provenance[m.slug]);
  if (untracked.length) {
    console.log(`\n${untracked.length} original(s) with no provenance — made by hand before this script existed: ` +
      untracked.map((m) => m.slug).join(", "));
  }
  if (existsSync(STAGING)) {
    const inflight = readdirSync(STAGING).filter((d) => existsSync(join(STAGING, d, "task.json")) && !existsSync(join(STAGING, d, `${d}.glb`)));
    if (inflight.length) console.log(`in flight (re-run generate to resume): ${inflight.join(", ")}`);
  }
}

if (command === "generate") await generate();
else if (command === "install") install();
else status();
