#!/usr/bin/env node
/**
 * Generate the reward system's seed migration from the TypeScript sources.
 *
 *   npm run rewards:seed
 *
 * ── Why generated rather than hand-written ──────────────────────────────────
 *
 * The 51 templates, the 40-odd rewards and the 101 skins already exist in
 * lib/rewards/*.ts and assets-src/briefcase/skins.csv, because the generator
 * and the roller read them at runtime. Typing them a second time into SQL
 * would create two lists that agree today and disagree the first time either
 * is edited — and the disagreement would show up as a challenge nobody can
 * complete or a skin the wardrobe knows about and the roller does not.
 *
 * So the SQL is derived, checked in, and regenerated when the sources change.
 * The file it writes is idempotent (`on conflict do update`), so re-running
 * the migration against a live database updates content without touching a
 * single player's inventory.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

register("./ts-loader.mjs", pathToFileURL("./scripts/"));

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { TEMPLATES } = await import("../lib/rewards/templates.ts");
const { REWARDS } = await import("../lib/rewards/catalog.ts");

/** Postgres string literal. */
const q = (value) => (value == null ? "null" : `'${String(value).replace(/'/g, "''")}'`);
const arr = (list) => `array[${list.map(q).join(",")}]::text[]`;
const json = (value) => `${q(JSON.stringify(value))}::jsonb`;

// ── skins, from the CSV the art pipeline already reads ──────────────────────
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
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const skins = parseCsv(readFileSync(join(root, "assets-src/briefcase/skins.csv"), "utf8"));

const lines = [];
lines.push("-- ════════════════════════════════════════════════════════════════════════════");
lines.push("-- 0018 · Briefcase content — GENERATED, do not edit by hand");
lines.push("--");
lines.push("-- Written by `npm run rewards:seed` from lib/rewards/templates.ts,");
lines.push("-- lib/rewards/catalog.ts and assets-src/briefcase/skins.csv — the same three");
lines.push("-- sources the generator and the roller read at runtime, so the rules in the");
lines.push("-- database and the rules in the code cannot drift apart.");
lines.push("--");
lines.push("-- Every statement is an upsert: re-running this against a live database");
lines.push("-- updates the CONTENT and touches no player's inventory, progress or tokens.");
lines.push("-- ════════════════════════════════════════════════════════════════════════════");
lines.push("");

lines.push(`-- ── ${TEMPLATES.length} achievement templates ──`);
for (const t of TEMPLATES) {
  lines.push(
    `insert into public.achievement_templates (id, category, text_pattern, params, event, flags, cooldown_days, band_easy, band_medium, band_hard) values (` +
    [q(t.id), q(t.category), q(t.text), json(t.params), q(t.event), arr(t.flags ?? []),
     String(t.cooldownDays ?? 2), String(Boolean(t.params.easy)), String(Boolean(t.params.medium)),
     String(Boolean(t.params.hard))].join(", ") +
    `) on conflict (id) do update set category=excluded.category, text_pattern=excluded.text_pattern, params=excluded.params, event=excluded.event, flags=excluded.flags, cooldown_days=excluded.cooldown_days, band_easy=excluded.band_easy, band_medium=excluded.band_medium, band_hard=excluded.band_hard;`,
  );
}
lines.push("");

lines.push(`-- ── ${REWARDS.length} non-skin rewards ──`);
lines.push("-- The `no_permanent_pro` and `trial_duration_bounded` constraints in 0017 are");
lines.push("-- what stop a careless edit here from handing out the paid product.");
for (const r of REWARDS) {
  lines.push(
    `insert into public.rewards (id, kind, rarity, name, payload, flags) values (` +
    [q(r.id), q(r.kind), q(r.rarity), q(r.name), json(r.payload), arr(r.flags ?? [])].join(", ") +
    `) on conflict (id) do update set kind=excluded.kind, rarity=excluded.rarity, name=excluded.name, payload=excluded.payload, flags=excluded.flags;`,
  );
}
lines.push("");

lines.push(`-- ── ${skins.length} skins (${skins.filter((s) => s.collection !== "milestone_only").length} in the RNG pool) ──`);
for (const s of skins) {
  const inPool = s.collection !== "milestone_only";
  lines.push(
    `insert into public.skins (id, name, tier, collection, outfit_spec, in_pool) values (` +
    [q(s.id), q(s.name), String(Number(s.tier)), q(s.collection), q(s.outfit_block ?? null), String(inPool)].join(", ") +
    `) on conflict (id) do update set name=excluded.name, tier=excluded.tier, collection=excluded.collection, outfit_spec=excluded.outfit_spec, in_pool=excluded.in_pool;`,
  );
}
lines.push("");

const out = join(root, "supabase/migrations/0018_rewards_seed.sql");
writeFileSync(out, lines.join("\n"));
console.log(`✓ ${TEMPLATES.length} templates · ${REWARDS.length} rewards · ${skins.length} skins → supabase/migrations/0018_rewards_seed.sql`);
