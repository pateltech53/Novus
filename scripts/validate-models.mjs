#!/usr/bin/env node
/**
 * Keep the four places a 3-D prop's name and version live from drifting apart.
 *
 *   assets-src/briefcase/models.json   the registry (slug, version, source)
 *   lib/rewards/models.ts              MODEL_VERSIONS — what the client loads
 *   lib/rewards/tables.ts              TIER_SLUGS — how the ceremony names one
 *   public/briefcase/models/           <slug>-v<version>.glb — what is served
 *
 * A version bumped in one place and not the others is a 404 in the unlock
 * ceremony: the case simply never appears, the canvas stays empty, and no
 * test that does not open a browser would notice. So this is a build step,
 * not a lint — it exits non-zero from `npm run events`, which `check` and CI
 * both run before anything else.
 *
 * It also refuses a stale file: a `-v1.glb` left behind after a `-v2` build
 * ships in every deploy for nothing, and a served file no registry entry
 * claims is exactly the "nobody can explain this artefact" state
 * build-models.mjs exists to end.
 *
 * The TS table is parsed, not imported — the same trick validate-tokens.mjs
 * uses on interpolate.ts — so this stays a plain node script with no
 * TypeScript loader in the way.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = join(root, "assets-src/briefcase/models.json");
const TABLE = join(root, "lib/rewards/models.ts");
const TIERS = join(root, "lib/rewards/tables.ts");
const SERVED = join(root, "public/briefcase/models");

const problems = [];

const registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
const wanted = new Map(registry.models.map((m) => [m.slug, m.version]));

// ── lib/rewards/models.ts ────────────────────────────────────────────────────

const src = readFileSync(TABLE, "utf8");
const block = src.match(/export const MODEL_VERSIONS\s*=\s*\{([\s\S]*?)\}\s*as const/);
if (!block) {
  console.error("\n✗ Could not find `export const MODEL_VERSIONS = { … } as const` in lib/rewards/models.ts.\n");
  process.exit(1);
}
const table = new Map([...block[1].matchAll(/"([a-z0-9-]+)"\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
for (const [slug, version] of wanted) {
  if (!table.has(slug)) problems.push(`lib/rewards/models.ts is missing "${slug}" (registry says v${version})`);
  else if (table.get(slug) !== version) problems.push(`"${slug}": registry v${version}, lib/rewards/models.ts v${table.get(slug)}`);
}
for (const slug of table.keys()) {
  if (!wanted.has(slug)) problems.push(`lib/rewards/models.ts names "${slug}", which is not in the registry`);
}

const fit = src.match(/export const MODEL_FIT\s*=\s*([\d.]+)/);
if (!fit || Number(fit[1]) !== registry.fit) {
  problems.push(`MODEL_FIT is ${fit?.[1] ?? "missing"} in lib/rewards/models.ts but the registry says ${registry.fit}`);
}

// ── lib/rewards/tables.ts ────────────────────────────────────────────────────

/*
 * The ceremony loads its case as `modelUrl(TIER_SLUGS[tier])`, so a tier slug
 * that is not a registry slug resolves to `/briefcase/models/undefined-vundefined.glb`.
 * TypeScript cannot catch it — the cast to ModelSlug is exactly where the two
 * naming systems meet — and neither can anything above: the registry would be
 * internally consistent and every file would be present. Only the browser
 * would notice, by drawing nothing.
 */
const tiers = readFileSync(TIERS, "utf8").match(/export const TIER_SLUGS[\s\S]*?\{([\s\S]*?)\}/);
if (!tiers) {
  problems.push("could not find `export const TIER_SLUGS = { … }` in lib/rewards/tables.ts");
} else {
  for (const [, tier, slug] of tiers[1].matchAll(/(\d+)\s*:\s*"([a-z0-9-]+)"/g)) {
    if (!wanted.has(slug)) problems.push(`TIER_SLUGS[${tier}] is "${slug}", which the 3-D registry does not carry — the ceremony would load a 404`);
  }
}

// ── public/briefcase/models/ ─────────────────────────────────────────────────

const served = existsSync(SERVED) ? readdirSync(SERVED).filter((f) => f.endsWith(".glb")) : [];
for (const [slug, version] of wanted) {
  const file = `${slug}-v${version}.glb`;
  if (!served.includes(file)) problems.push(`public/briefcase/models/${file} is not built — run \`npm run models\``);
}
for (const file of served) {
  const m = file.match(/^(.+)-v(\d+)\.glb$/);
  if (!m) { problems.push(`public/briefcase/models/${file} is not named <slug>-v<n>.glb`); continue; }
  if (wanted.get(m[1]) !== Number(m[2])) {
    problems.push(`public/briefcase/models/${file} is stale — the registry wants ${m[1]} at v${wanted.get(m[1]) ?? "(not listed)"}; delete it`);
  }
}

if (problems.length) {
  console.error(`\n✗ 3-D prop registry drift (${problems.length}):\n`);
  for (const p of problems) console.error(`  · ${p}`);
  console.error(
    "\n  Sources of truth: assets-src/briefcase/models.json ↔ lib/rewards/models.ts" +
      " ↔ lib/rewards/tables.ts ↔ public/briefcase/models/\n",
  );
  process.exit(1);
}
console.log(`✓ models: ${wanted.size} props, registry ↔ lib/rewards/models.ts ↔ TIER_SLUGS ↔ public/briefcase/models agree`);
