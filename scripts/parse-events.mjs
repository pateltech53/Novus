#!/usr/bin/env node
/**
 * Merge the per-section authored JSON into data/events.json (build-time step).
 * Sections are converted from design/NOVUS_EVENT_LIBRARY_B1.md; humans edit the
 * .md, the engine reads the merged JSON.
 *
 * ── Two extra inputs, both under data/industry/ ─────────────────────────────
 *
 * data/sections/*.json is protected authored content. Making the game's
 * situations answer to the player's chosen industry needed changes to that
 * content, so instead it arrives as an overlay applied here:
 *
 *   events.json   industry-exclusive events, merged into the pool like any
 *                 other section. `industries: [CODE]` — lib/engine/events.ts
 *                 already gates on this in isEligible().
 *
 *   reskins.json  per-industry rewrites of GameEvent.text for events whose
 *                 MECHANICS are universal but whose fiction is not. Merged onto
 *                 each event's `reskins` map, which DecisionSheet.tsx already
 *                 reads. Base text is left in place as the fallback for any
 *                 industry a rewrite does not cover.
 *
 * The net effect is that every section file stays byte-identical while roughly a
 * quarter of drawn situations now name the player's actual business.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sectionsDir = join(root, "data", "sections");
const industryDir = join(root, "data", "industry");

const INDUSTRIES = new Set([
  "FOOD", "ECOM", "TECH", "CONTENT", "FASHION", "GAMING",
  "FITNESS", "BEAUTY", "EDTECH", "SUSTAIN", "TOYS", "PET",
]);

const readJson = (path, label) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`✗ ${label}: invalid JSON — ${err.message}`);
    process.exit(1);
  }
};

const files = readdirSync(sectionsDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

const all = [];
const seen = new Map();

for (const file of files) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(sectionsDir, file), "utf8"));
  } catch (err) {
    console.error(`✗ ${file}: invalid JSON — ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error(`✗ ${file}: expected an array`);
    process.exit(1);
  }
  for (const ev of parsed) {
    if (seen.has(ev.id)) {
      console.error(`✗ duplicate event id ${ev.id} (${seen.get(ev.id)} and ${file})`);
      process.exit(1);
    }
    seen.set(ev.id, file);
    all.push(ev);
  }
  console.log(`  ${file.padEnd(8)} ${String(parsed.length).padStart(3)} events`);
}

// ── Industry-exclusive events ───────────────────────────────────────────────

// Same multi-file convention as the reskins below: every events*.json in
// data/industry merges, sorted for deterministic order, so a subsystem (the
// positioning layer, a future pack) can ship its events without reopening the
// base file.
const industryEventFiles = readdirSync(industryDir)
  .filter((f) => f.startsWith("events") && f.endsWith(".json"))
  .sort();
for (const file of industryEventFiles) {
  const extra = readJson(join(industryDir, file), `industry/${file}`);
  if (!Array.isArray(extra)) {
    console.error(`✗ industry/${file}: expected an array`);
    process.exit(1);
  }
  for (const ev of extra) {
    if (seen.has(ev.id)) {
      console.error(`✗ duplicate event id ${ev.id} (${seen.get(ev.id)} and industry/${file})`);
      process.exit(1);
    }
    // These exist to be industry-specific. One tagged "all" is a copy-paste
    // slip, and it would quietly dilute every other industry's pool.
    if (ev.industries === "all" || !Array.isArray(ev.industries) || ev.industries.length === 0) {
      console.error(`✗ ${ev.id}: industry/${file} entries need a non-empty industries array`);
      process.exit(1);
    }
    seen.set(ev.id, `industry/${file}`);
    all.push(ev);
  }
  console.log(`  ${file.replace(".json","").padEnd(8).slice(0,8)} ${String(extra.length).padStart(3)} events (industry-exclusive)`);
}

// ── Reskin overlays ─────────────────────────────────────────────────────────

/*
 * Reskins are split across several files so different passes can be written and
 * revised independently (the base overlay, then the Tier-1 CUS/PRD pass, then
 * MKT/OPS/RIV). Sorted so precedence is deterministic: a later file wins on a
 * collision, which is how a correction ships without reopening the file it
 * corrects.
 */
const reskinFiles = readdirSync(industryDir)
  .filter((f) => f.startsWith("reskins") && f.endsWith(".json"))
  .sort();
{
  const byId = new Map(all.map((e) => [e.id, e]));
  let events = 0;
  let strings = 0;
  for (const file of reskinFiles) {
    const overlay = readJson(join(industryDir, file), `industry/${file}`);
    for (const [eventId, rewrites] of Object.entries(overlay)) {
      if (eventId.startsWith("_")) continue; // _readme and friends
      const target = byId.get(eventId);
      // Fail rather than warn: a typo'd id is a rewrite that silently never
      // ships, and the symptom (an industry that feels generic) is invisible.
      if (!target) {
        console.error(`✗ industry/${file}: no event "${eventId}"`);
        process.exit(1);
      }
      for (const code of Object.keys(rewrites)) {
        if (!INDUSTRIES.has(code)) {
          console.error(`✗ industry/${file} ${eventId}: unknown industry "${code}"`);
          process.exit(1);
        }
      }
      target.reskins = { ...(target.reskins ?? {}), ...rewrites };
      events += 1;
      strings += Object.keys(rewrites).length;
    }
  }
  console.log(
    `  reskins  ${String(strings).padStart(3)} rewrites across ${events} events (${reskinFiles.length} files)`,
  );
}

// ── The relevance multiplier (Addendum B §2) ────────────────────────────────

/*
 * Addendum B §2.1 asks for a draw-weight multiplier so that most of what happens
 * to a player is about the company they actually built, and it nominates
 * `lib/engine/events.ts` as "the one sanctioned modification".
 *
 * It does not need to be modified. `effectiveWeight()` in that file already ends
 * with exactly the hook this requires:
 *
 *     for (const mod of ev.weightMods ?? [])
 *       if (mod.industries?.includes(state.industry)) w *= mod.mult;
 *
 * So the multiplier is injected here, into the DATA, at build time. An event that
 * speaks the player's industry — because it is industry-exclusive, or because it
 * carries a reskin for them — is simply worth more in the draw. Identical
 * behaviour, zero edits to a protected file, and the anti-repeat, cooldown,
 * flag-gating and weakest-stat targeting in that function keep working untouched
 * because none of them are aware this happened.
 *
 * §2.2 binds here too: the multiplier is industry-blind. A free industry gets the
 * same boost as a paid one. Pro buys MORE WORLD, never a better game.
 */
const RELEVANCE_MULT = 2.4;

let boosted = 0;
for (const ev of all) {
  // Milestones and chain steps are scheduled, not drawn — a weight multiplier on
  // them would do nothing except confuse the next person to read this.
  if (ev.category === "MILE" || ev.chain) continue;

  const speaksTo =
    ev.industries === "all"
      ? Object.keys(ev.reskins ?? {})
      : Array.isArray(ev.industries)
        ? ev.industries
        : [];
  if (speaksTo.length === 0) continue;

  // Append — never replace. Authored weightMods carry flag-based tuning that has
  // nothing to do with relevance and must survive.
  ev.weightMods = [...(ev.weightMods ?? []), { industries: speaksTo, mult: RELEVANCE_MULT }];
  boosted += 1;
}
console.log(`  relevance ${String(boosted).padStart(3)} events boosted ×${RELEVANCE_MULT} for industries they speak to`);

all.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(root, "data", "events.json"), JSON.stringify(all), "utf8");
console.log(`✓ merged ${all.length} events → data/events.json`);
