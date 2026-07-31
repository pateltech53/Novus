#!/usr/bin/env node
/**
 * Enforce the no-answer-key rule on activities (Addendum A §7.1).
 *
 * An activity's `signal` is what the player reads before committing. It must be
 * QUALITATIVE: "Cheap reach. Rents by the week." — never "Brand +4 · CTR +3".
 * A number in a signal is an effect preview, which is failure P1 from the master
 * prompt, and it is the exact leak that Phase 2 fixed for decisions and left
 * behind in `activities.ts`.
 *
 * `costS` is deliberately NOT checked. Cash leaving your account now is a fact
 * the player is spending, not a prediction of what it buys.
 *
 * This is a build step, not a lint suggestion: it exits non-zero, because a
 * signal with a number in it is indistinguishable from the old `known` field and
 * will be copied by the next person who adds an activity.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const files = [join(root, "lib/engine/activities.ts")];
const industriesDir = join(root, "lib/engine/industries");
if (existsSync(industriesDir)) {
  for (const f of readdirSync(industriesDir).filter((f) => f.endsWith(".ts")))
    files.push(join(industriesDir, f));
}

/**
 * Digits that are part of prose rather than a stat. "Twice the covers" is fine
 * and so is a bare "24/7"; what we are hunting is "+5", "−2S", "10%", "0.4S/mo".
 */
const STAT_SHAPED = /[+\-−±]\s*\d|\d+\s*(%|S\b|S\/mo|pt\b|pts\b)|\d+\s*[·•]/;

const errors = [];
const warnings = [];
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = file.slice(root.length + 1);

  // Signals are authored as single-quoted or double-quoted string literals on a
  // `signal:` key. Template literals would defeat this check, so they are called
  // out rather than silently skipped.
  for (const m of src.matchAll(/signal:\s*`([^`]*)`/g)) {
    warnings.push(`${rel}: signal uses a template literal — cannot be verified statically: \`${m[1]}\``);
  }

  for (const m of src.matchAll(/signal:\s*"([^"]*)"/g)) {
    checked += 1;
    const text = m[1];
    if (STAT_SHAPED.test(text)) {
      errors.push(`${rel}: signal reveals an effect — "${text}"`);
    }
    if (/\b(Risk|TDebt|SupLoy|InvSent|TeamLoy)\b/.test(text)) {
      errors.push(`${rel}: signal names a hidden stat — "${text}"`);
    }
    if (text.length > 68) {
      warnings.push(`${rel}: signal is ${text.length} chars, will wrap on a phone — "${text}"`);
    }
  }
}

console.log(`\nValidating ${checked} activity signals across ${files.length} files…`);
for (const w of warnings) console.log(`  ⚠ ${w}`);

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} signals leak information the player has to discover:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    "\n  Signals are qualitative. Move the numbers into the outcome, where the\n" +
      "  player finds them after they have committed. costS may stay visible.\n",
  );
  process.exit(1);
}
console.log(`✓ ${checked} activity signals clean — no effect previews\n`);
