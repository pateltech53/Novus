#!/usr/bin/env node
/**
 * Enforce the interpolation-token registry on the event data (Addendum B §3.3).
 *
 * A token the renderer does not know renders as a literal `{whatevr}` in the
 * middle of a sentence on a card the player cannot dismiss without deciding.
 * One typo in one authored string does that, and nothing else in the pipeline
 * would catch it — the parser copies text verbatim and the type checker never
 * sees the strings. So this is a build step, not a lint: it exits non-zero.
 *
 * The registry is READ OUT OF lib/engine/interpolate.ts rather than copied
 * here, so the list cannot drift from the code that resolves it. Adding a token
 * means editing one array in one file.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── The registry, parsed from the engine ────────────────────────────────────

const REGISTRY_FILE = join(root, "lib/engine/interpolate.ts");

function loadRegistry() {
  if (!existsSync(REGISTRY_FILE)) {
    console.error(`\n✗ ${REGISTRY_FILE} is missing — the token registry lives there.\n`);
    process.exit(1);
  }
  const src = readFileSync(REGISTRY_FILE, "utf8");
  const block = src.match(/export const TOKEN_NAMES\s*=\s*\[([\s\S]*?)\]/);
  if (!block) {
    console.error(
      "\n✗ Could not find `export const TOKEN_NAMES = [...]` in" +
        " lib/engine/interpolate.ts.\n  The validator parses that array; keep it a" +
        " plain array of quoted strings.\n",
    );
    process.exit(1);
  }
  const names = [...block[1].matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)].map((m) => m[1]);
  if (names.length === 0) {
    console.error("\n✗ TOKEN_NAMES is empty in lib/engine/interpolate.ts.\n");
    process.exit(1);
  }
  return new Set(names);
}

const REGISTRY = loadRegistry();

// ── What gets scanned ───────────────────────────────────────────────────────

const files = [join(root, "data/events.json")];
const industryDir = join(root, "data/industry");
if (existsSync(industryDir)) {
  for (const f of readdirSync(industryDir).filter((f) => f.endsWith(".json")))
    files.push(join(industryDir, f));
}

/**
 * Keys whose strings are machinery, not prose — ids, flags, effect stats,
 * special ops. None of them may legally contain a token, and a future syntax
 * that borrows braces (`req:{a} or {b}`) would otherwise read as one.
 */
const STRUCTURAL_KEYS = new Set([
  "id", "followupId", "category", "industries", "stat", "key", "type", "seat",
  "flag", "notFlag", "requiresFlag", "excludesFlag", "requiresFlags",
  "excludesFlags", "requiresAnyFlags", "setFlags", "clearFlags", "special",
  "rookieTerms", "chain", "tags", "metaKey",
]);

/** Tokens whose event PREMISE needs the subject to exist (§3.3's own example). */
const PREMISE_TOKENS = new Set(["deadItem"]);

const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
/** Anything brace-wrapped that is not even token-shaped. Also a typo. */
const MALFORMED_RE = /\{[^}]*\}/g;

const errors = [];
const warnings = [];
const usage = new Map(); // token -> occurrence count
let stringsScanned = 0;
/**
 * Top-level entries carrying at least one token — an event in a library file,
 * an event id in a reskin overlay. This is the number §3.3 is arguing about:
 * how much of the library says your name.
 */
let carriersWithTokens = 0;

function scanString(text, where) {
  stringsScanned += 1;
  if (!text.includes("{")) return false;
  let found = false;

  for (const m of text.matchAll(TOKEN_RE)) {
    const name = m[1];
    found = true;
    usage.set(name, (usage.get(name) ?? 0) + 1);
    if (!REGISTRY.has(name)) {
      errors.push(`${where}: unknown token {${name}} — "${clip(text)}"`);
    }
  }

  for (const m of text.matchAll(MALFORMED_RE)) {
    if (!/^\{[A-Za-z][A-Za-z0-9_]*\}$/.test(m[0])) {
      errors.push(`${where}: malformed token ${m[0]} — "${clip(text)}"`);
      found = true;
    }
  }
  return found;
}

function walk(node, where, onToken) {
  if (typeof node === "string") {
    if (scanString(node, where)) onToken(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${where}[${i}]`, onToken));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      walk(value, `${where}.${key}`, onToken);
    }
  }
}

const clip = (s) => (s.length > 92 ? `${s.slice(0, 89)}…` : s);

/** An event whose premise needs a subject must gate on a flag, not fall back. */
function checkPremiseGating(ev, rel) {
  const gated =
    (ev.requiresFlags ?? []).length > 0 || (ev.requiresCond ?? []).length > 0;
  if (gated) return;
  const blob = JSON.stringify(ev);
  for (const token of PREMISE_TOKENS) {
    if (blob.includes(`{${token}}`)) {
      warnings.push(
        `${rel} ${ev.id}: uses {${token}} but gates on nothing — an event built on a` +
          ` subject that may not exist has to require a flag, not lean on the fallback`,
      );
    }
  }
}

for (const file of files) {
  const rel = file.slice(root.length + 1);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    errors.push(`${rel}: not valid JSON — ${err.message}`);
    continue;
  }

  // A library file is an array of events; a reskin overlay is event id →
  // industry code → replacement text. Both are walked one carrier at a time so
  // the coverage count means the same thing either way.
  const carriers = Array.isArray(parsed)
    ? parsed.map((ev) => [ev?.id ?? "(no id)", ev])
    : Object.entries(parsed);

  for (const [id, carrier] of carriers) {
    let hit = false;
    walk(carrier, `${rel} ${id}`, () => {
      hit = true;
    });
    if (hit) carriersWithTokens += 1;
    if (Array.isArray(parsed) && carrier && typeof carrier === "object")
      checkPremiseGating(carrier, rel);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

const total = [...usage.values()].reduce((a, b) => a + b, 0);
console.log(
  `\nValidating interpolation tokens across ${files.length} data files` +
    ` (${stringsScanned} authored strings, ${REGISTRY.size} registered tokens)…`,
);

if (usage.size > 0) {
  const rows = [...usage.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${total} token uses · ${carriersWithTokens} entries name something of yours`);
  for (const [name, count] of rows) {
    console.log(`    {${name}}${REGISTRY.has(name) ? "" : "  ← NOT REGISTERED"} × ${count}`);
  }
}
for (const w of warnings) console.log(`  ⚠ ${w}`);

const unused = [...REGISTRY].filter((t) => !usage.has(t));
if (unused.length > 0) {
  console.log(`  · registered but unused: ${unused.map((t) => `{${t}}`).join(" ")}`);
}

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} token problems:\n`);
  for (const e of errors) console.error(`  ${e}`);
  console.error(
    "\n  Every token must be in TOKEN_NAMES in lib/engine/interpolate.ts.\n" +
      "  Fix the spelling, or register the token and teach tokenSubjects() how\n" +
      "  to resolve it and what it falls back to.\n",
  );
  process.exit(1);
}
console.log(`✓ ${total} token uses, all registered\n`);
