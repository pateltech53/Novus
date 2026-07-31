#!/usr/bin/env node
/**
 * Validate data/events.json against the engine contract. Fails the build on
 * structural errors; warns (loudly) on content smells the engine can survive.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const events = JSON.parse(readFileSync(join(root, "data", "events.json"), "utf8"));

const errors = [];
const warnings = [];

const EFFECT_STATS = new Set([
  "cash_S", "burn_S_mo", "rev_pct", "gm_pt", "brand", "morale", "qual", "csat",
  "churn_pt", "emp", "energy", "val_pct", "respect", "share_pt", "cac_pt",
  "ctr_pt", "cwp_pt", "dilution_pct", "risk", "tdebt", "suploy", "invsent", "teamloy",
]);
const PERFORM_TYPES = new Set(["pitch", "nego", "consult", "board", "allhands", "media"]);
const INDUSTRIES = new Set([
  "FOOD", "ECOM", "TECH", "CONTENT", "FASHION", "GAMING",
  "FITNESS", "BEAUTY", "EDTECH", "SUSTAIN", "TOYS", "PET",
]);
/** Special ops the engine implements (lib/engine/effects.ts applySpecial). */
const KNOWN_SPECIALS = new Set([
  "arm_chain", "chain_odds", "arm_event", "arm_events", "event_odds",
  "refire_harder", "refire_yearly", "rearm_years",
  "burn_pct", "emp_pct", "rev_delay", "launch_delay", "delay", "rev_flat",
  "features_pause", "fires_q", "rev_pull_forward", "hype_plus", "hype_minus",
  "tdebt_cleared", "risk_cleared", "risk_clear", "en_floor", "teamloy_max", "karma",
  "autopsy_magnet", "impair_choices", "immunity", "moat",
  "insurance_halves_damage", "unlock", "unlock_activity", "forced_rename", "merger_arc",
]);

const ids = new Set(events.map((e) => e.id));
const flagsSet = new Set();
const flagsUsed = new Set();
const unknownSpecials = new Map();

function checkOutcome(ev, where, outcome) {
  if (!outcome || typeof outcome !== "object") return;
  for (const eff of outcome.effects ?? []) {
    if (!EFFECT_STATS.has(eff.stat))
      errors.push(`${ev.id} ${where}: unknown effect stat "${eff.stat}"`);
    if (typeof eff.amount !== "number" || Number.isNaN(eff.amount))
      errors.push(`${ev.id} ${where}: effect amount must be a number`);
    if (eff.durationQ !== undefined && eff.durationQ <= 0)
      errors.push(`${ev.id} ${where}: durationQ must be > 0`);
  }
  for (const f of outcome.setFlags ?? []) flagsSet.add(f);
  for (const f of outcome.clearFlags ?? []) flagsUsed.add(f);
  for (const op of outcome.special ?? []) {
    const tag = String(op).split(":")[0];
    if (!KNOWN_SPECIALS.has(tag)) {
      unknownSpecials.set(tag, (unknownSpecials.get(tag) ?? 0) + 1);
    }
  }
  if (outcome.followupId && !ids.has(outcome.followupId))
    errors.push(`${ev.id} ${where}: followupId "${outcome.followupId}" does not exist`);
}

for (const ev of events) {
  if (!ev.id || !ev.title || !ev.text)
    errors.push(`${ev.id ?? "(no id)"}: missing id/title/text`);
  if (!Array.isArray(ev.stages) || ev.stages.length === 0)
    errors.push(`${ev.id}: stages must be a non-empty array`);
  for (const st of ev.stages ?? [])
    if (![1, 2, 3, 4, 5].includes(st)) errors.push(`${ev.id}: bad stage ${st}`);
  if (ev.industries !== "all") {
    if (!Array.isArray(ev.industries)) errors.push(`${ev.id}: industries must be "all" or an array`);
    else
      for (const ind of ev.industries)
        if (!INDUSTRIES.has(ind)) errors.push(`${ev.id}: unknown industry "${ind}"`);
  }
  if (typeof ev.weight !== "number" || ev.weight <= 0)
    errors.push(`${ev.id}: weight must be a positive number`);

  for (const f of ev.requiresFlags ?? []) flagsUsed.add(f);
  for (const f of ev.excludesFlags ?? []) flagsUsed.add(f);

  const hasResolution = ev.choices?.length || ev.performOnly || ev.auto;
  if (!hasResolution) errors.push(`${ev.id}: no choices, performOnly, or auto — unresolvable`);

  if (ev.performOnly) {
    if (!PERFORM_TYPES.has(ev.performOnly.type))
      errors.push(`${ev.id}: unknown perform type "${ev.performOnly.type}"`);
    checkOutcome(ev, "performOnly.pass", ev.performOnly.pass);
    checkOutcome(ev, "performOnly.fail", ev.performOnly.fail);
  }
  if (ev.auto) checkOutcome(ev, "auto", ev.auto);

  for (const [i, choice] of (ev.choices ?? []).entries()) {
    const where = `choice[${i}] "${choice.label}"`;
    if (!choice.label) errors.push(`${ev.id} ${where}: missing label`);
    if (choice.requiresFlag) flagsUsed.add(choice.requiresFlag);
    for (const f of choice.requiresAnyFlags ?? []) flagsUsed.add(f);
    if (choice.excludesFlag) flagsUsed.add(choice.excludesFlag);
    if (choice.requiresFlag?.includes("|"))
      errors.push(`${ev.id} ${where}: requiresFlag contains "|" — use requiresAnyFlags`);

    const routes = [choice.outcome, choice.branches, choice.perform].filter(Boolean).length;
    if (routes === 0) errors.push(`${ev.id} ${where}: no outcome/branches/perform`);
    if (routes > 1) errors.push(`${ev.id} ${where}: more than one resolution route`);

    if (choice.outcome) checkOutcome(ev, where, choice.outcome);
    if (choice.perform) {
      if (!PERFORM_TYPES.has(choice.perform.type))
        errors.push(`${ev.id} ${where}: unknown perform type "${choice.perform.type}"`);
      checkOutcome(ev, `${where}.pass`, choice.perform.pass);
      checkOutcome(ev, `${where}.fail`, choice.perform.fail);
    }
    if (choice.branches) {
      const weighted = choice.branches.filter((b) => b.weight !== undefined);
      const conditional = choice.branches.filter((b) => b.cond || b.fallback);
      if (weighted.length > 0) {
        const sum = weighted.reduce((n, b) => n + b.weight, 0);
        if (Math.abs(sum - 100) > 0.5)
          errors.push(`${ev.id} ${where}: weighted branches sum to ${sum}, expected 100`);
      }
      // A conditional set with no fallback is fine when weighted arms follow:
      // resolveBranches() falls through to the roll. Only warn when nothing catches.
      if (conditional.length > 0 && !conditional.some((b) => b.fallback) && weighted.length === 0)
        errors.push(`${ev.id} ${where}: conditional branches with no fallback and no weighted arms — unresolvable`);
      for (const [j, b] of choice.branches.entries())
        checkOutcome(ev, `${where}.branch[${j}]`, b.outcome);
    }
    // Brand Law: the visible tradeoff must not reveal flags or hidden stats.
    if (choice.known && /\{|Risk|TDebt|SupLoy|InvSent|TeamLoy|%\s*chance/i.test(choice.known))
      warnings.push(`${ev.id} ${where}: "known" leaks hidden information — "${choice.known}"`);
  }

  if (ev.chain) {
    if (!ev.chain.id || !ev.chain.step) errors.push(`${ev.id}: malformed chain descriptor`);
  }
}


/**
 * Flags the engine maintains from live Books rather than any authored choice
 * (lib/engine/sim.ts refreshBooks). Events legitimately gate on these.
 */
const ENGINE_FLAGS = new Set([
  "runway_low",
  "tdebt_high",
  // Maintained by lib/engine/positioning.ts (syncPositioning / positioningYearTick),
  // not by any authored setFlags — without this they read as orphan gates.
  "clarity_low",
  "clarity_high",
  "repositioned_recent",
]);

// Flags that are required/excluded but never set anywhere = dead gates.
const orphanFlags = [...flagsUsed].filter(
  (f) => !flagsSet.has(f) && !ENGINE_FLAGS.has(f),
);

// ── Report ──────────────────────────────────────────────────────────────────

console.log(`\nValidating ${events.length} events…\n`);

const byCategory = {};
for (const ev of events) byCategory[ev.category] = (byCategory[ev.category] ?? 0) + 1;
console.log(
  "  categories: " +
    Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join("  "),
);
console.log(`  flags set: ${flagsSet.size}   flags gated on: ${flagsUsed.size}`);
console.log(
  `  perform events: ${events.filter((e) => e.performOnly || e.choices?.some((c) => c.perform)).length}`,
);
console.log(`  chains: ${new Set(events.filter((e) => e.chain).map((e) => e.chain.id)).size}`);

if (orphanFlags.length > 0) {
  console.log(`\n  ⚠ ${orphanFlags.length} flags gated on but never set:`);
  console.log("    " + orphanFlags.join(", "));
}
if (unknownSpecials.size > 0) {
  console.log(`\n  ⚠ ${unknownSpecials.size} special tags the engine does not implement yet`);
  console.log("    (they degrade to narration + a flag; nothing is silently dropped):");
  const sorted = [...unknownSpecials.entries()].sort((a, b) => b[1] - a[1]);
  console.log("    " + sorted.map(([t, n]) => `${t}×${n}`).join(", "));
}
for (const w of warnings.slice(0, 25)) console.log(`  ⚠ ${w}`);
if (warnings.length > 25) console.log(`  ⚠ …and ${warnings.length - 25} more warnings`);

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} errors:\n`);
  for (const e of errors.slice(0, 40)) console.error(`  ${e}`);
  if (errors.length > 40) console.error(`  …and ${errors.length - 40} more`);
  process.exit(1);
}
console.log(`\n✓ ${events.length} events valid\n`);
