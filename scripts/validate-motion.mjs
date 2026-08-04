#!/usr/bin/env node
/**
 * Keeps the motion system from drifting back into thirty transition objects.
 *
 *   node scripts/validate-motion.mjs
 *
 * ── What it guards, and why a lint rule would not ───────────────────────────
 *
 * Before this pass: 78 `motion.*` elements carrying 30 distinct transition
 * objects; `ENTER` imported by zero files while six sites hand-wrote its exact
 * literal; four different `active:scale-[…]` press magnitudes; and one `width`
 * animation, which design.md §5 has forbidden since it was written.
 *
 * None of that arrived in one commit. It arrived one reasonable line at a time,
 * and nothing in the build had an opinion about any of them — the same way 6.7
 * MB of dead video stayed in `public/` after two documents said to delete it.
 * A rule nobody runs is a rule that does not exist, so this runs in
 * `npm run check` alongside the event and token validators.
 *
 * It is deliberately a script rather than an ESLint rule: this project has no
 * ESLint config checked in, and adding one to enforce four patterns would be a
 * larger and more fragile change than the thing it enforces.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every .tsx under app/ and components/, minus the file that DEFINES the tokens. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const TOKEN_FILE = join(root, "components", "ui", "Motion.tsx");
const files = [...sources(join(root, "app")), ...sources(join(root, "components"))].filter(
  (f) => f !== TOKEN_FILE,
);

const RULES = [
  {
    id: "hardcoded-easing",
    // The three named curves live in components/ui/Motion.tsx and globals.css.
    // A cubic-bezier written inline is a fourth curve nobody decided on.
    re: /ease:\s*\[/g,
    say: "inline `ease: [...]` — import EASE_OUT/EASE_IN/EASE_IN_OUT from @/components/ui/Motion",
  },
  {
    id: "hardcoded-spring",
    re: /stiffness:\s*\d/g,
    say: "inline spring — import SHEET_SPRING or SETTLE_SPRING from @/components/ui/Motion",
  },
  {
    id: "adhoc-press",
    re: /active:scale-\[/g,
    say: "ad-hoc press scale — use the .nv-press or .nv-press-row utility",
  },
  {
    id: "layout-animation",
    // design.md §5: "Only transform and opacity animate. Never width, height,
    // top, left, box-shadow, or backdrop-filter."
    re: /animate=\{\{[^}]*\b(width|height|top|left|marginTop|marginLeft):/g,
    say: "animating a layout property — animate transform (scaleX/translate) instead",
  },
];

const hits = [];
for (const file of files) {
  if (!statSync(file).isFile()) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const rule of RULES) {
    lines.forEach((line, i) => {
      // A rule name inside a comment is documentation, not a violation.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) {
        hits.push({ file: relative(root, file), line: i + 1, rule: rule.id, say: rule.say });
      }
    });
  }
}

if (hits.length) {
  console.error(`\n  ✗ ${hits.length} motion-system violation${hits.length > 1 ? "s" : ""}:\n`);
  for (const h of hits) {
    console.error(`    ${h.file}:${h.line}`);
    console.error(`      ${h.say}`);
  }
  console.error(
    "\n    These are the four patterns that produced 30 transition objects and four\n" +
      "    press magnitudes. If one of them is genuinely right here, say so in a\n" +
      "    comment above the line and move the value into components/ui/Motion.tsx.\n",
  );
  process.exit(1);
}

console.log(`✓ motion system clean across ${files.length} files`);
