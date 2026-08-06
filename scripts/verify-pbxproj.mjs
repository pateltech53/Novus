#!/usr/bin/env node
/**
 * Reads `ios/App/App.xcodeproj/project.pbxproj` and refuses to accept a file
 * Xcode would refuse to open.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The widget extension is a second build target, and a build target is not a
 * file you can add from a text editor without touching the project. The
 * project file is a hand-maintained graph of 24-character object ids where
 * every id must be defined exactly once and referenced only after it is, and
 * the failure mode of getting it wrong is not a build error — it is Xcode
 * declining to open the project at all, with a message that names no line.
 *
 * So the graph is checked here, where the answer is a diff rather than a
 * modal. This is not a parser: it is a set of structural claims that a
 * correct pbxproj satisfies and every malformed one this kind of edit produces
 * violates.
 *
 *   node scripts/verify-pbxproj.mjs
 *
 * A green run does not prove the project BUILDS — only Xcode can say that, and
 * `.github/workflows/ios-build.yml` is what asks it on every push. It proves
 * the file is well-formed and internally consistent, which is the failure this
 * kind of change actually produces.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
const IOS_ROOT = join(root, "ios", "App");

const source = readFileSync(PROJECT, "utf8");
const problems = [];
const fail = (message) => problems.push(message);

// ── 1. Braces and parentheses balance ───────────────────────────────────────
// A pbxproj is one nested dictionary. An unbalanced delimiter is the single
// most likely outcome of a bad edit and the one Xcode reports least usefully.
{
  const counted = (open, close) => {
    let depth = 0;
    let lowest = 0;
    for (const ch of source) {
      if (ch === open) depth += 1;
      else if (ch === close) depth -= 1;
      if (depth < lowest) lowest = depth;
    }
    return { depth, lowest };
  };
  for (const [open, close] of [
    ["{", "}"],
    ["(", ")"],
  ]) {
    const { depth, lowest } = counted(open, close);
    if (depth !== 0) fail(`unbalanced ${open}${close}: ends at depth ${depth}`);
    if (lowest < 0) fail(`unbalanced ${open}${close}: closes before it opens`);
  }
}

// ── 2. Every section that opens is closed ───────────────────────────────────
{
  const opened = [...source.matchAll(/\/\* Begin (\w+) section \*\//g)].map((m) => m[1]);
  const closed = [...source.matchAll(/\/\* End (\w+) section \*\//g)].map((m) => m[1]);
  for (const name of opened) {
    if (!closed.includes(name)) fail(`section ${name} is opened and never closed`);
  }
  for (const name of closed) {
    if (!opened.includes(name)) fail(`section ${name} is closed and never opened`);
  }
  const duplicates = opened.filter((name, i) => opened.indexOf(name) !== i);
  for (const name of new Set(duplicates)) {
    fail(`section ${name} is opened twice — Xcode keeps one and silently drops the other`);
  }
}

// ── 3. Every object id is defined exactly once ──────────────────────────────
// `<24 hex> /* comment */ = {` or `<24 hex> = {` at the head of a definition.
const defined = new Map();
for (const match of source.matchAll(/^\t\t([0-9A-F]{24})(?: \/\*.*?\*\/)? = \{/gm)) {
  const id = match[1];
  defined.set(id, (defined.get(id) ?? 0) + 1);
}
for (const [id, count] of defined) {
  if (count > 1) fail(`object ${id} is defined ${count} times`);
}
if (defined.size === 0) fail("no objects found at all — the file shape is not what this expects");

// ── 4. Every id that is referenced is defined ───────────────────────────────
// Anything that looks like an object id anywhere in the file. Over-inclusive
// on purpose: a false positive here is a hex string somebody typed on purpose,
// which is worth looking at anyway.
{
  const referenced = new Set();
  for (const match of source.matchAll(/\b([0-9A-F]{24})\b/g)) referenced.add(match[1]);
  const rootObject = source.match(/rootObject = ([0-9A-F]{24})/)?.[1];
  if (!rootObject) fail("no rootObject");
  else if (!defined.has(rootObject)) fail(`rootObject ${rootObject} is not defined`);

  for (const id of referenced) {
    if (!defined.has(id)) fail(`${id} is referenced but never defined`);
  }
}

/** The ids inside one `/* Begin X section *​/ … /* End X section *​/` block. */
function idsInSection(name) {
  const body = source.match(
    new RegExp(`/\\* Begin ${name} section \\*/([\\s\\S]*?)/\\* End ${name} section \\*/`),
  )?.[1];
  return new Set([...(body ?? "").matchAll(/^\t\t([0-9A-F]{24})/gm)].map((m) => m[1]));
}

// ── 5. Every build file points at a file reference or a package product ─────
{
  // A variant group is a legitimate build-file target and is not a file
  // reference: the two localised storyboards in this project are exactly that,
  // and a check that does not know it reports them forever until somebody
  // stops reading its output.
  const fileRefs = new Set([...idsInSection("PBXFileReference"), ...idsInSection("PBXVariantGroup")]);
  const section = source.match(
    /\/\* Begin PBXFileReference section \*\/([\s\S]*?)\/\* End PBXFileReference section \*\//,
  )?.[1];

  const buildFiles = source.match(
    /\/\* Begin PBXBuildFile section \*\/([\s\S]*?)\/\* End PBXBuildFile section \*\//,
  )?.[1];
  for (const line of (buildFiles ?? "").split("\n")) {
    const id = line.match(/^\t\t([0-9A-F]{24})/)?.[1];
    if (!id) continue;
    const ref = line.match(/fileRef = ([0-9A-F]{24})/)?.[1];
    const product = line.match(/productRef = ([0-9A-F]{24})/)?.[1];
    if (!ref && !product) fail(`build file ${id} has neither a fileRef nor a productRef`);
    if (ref && !fileRefs.has(ref)) fail(`build file ${id} points at ${ref}, which is not a file reference`);
  }
}

// ── 6. Every target is reachable from the project, and has a config list ────
{
  const targets = [...source.matchAll(/^\t\t([0-9A-F]{24}) \/\* (.+?) \*\/ = \{\n\t\t\tisa = PBXNativeTarget;/gm)];
  const listed = source.match(/targets = \(([\s\S]*?)\);/)?.[1] ?? "";
  for (const [, id, name] of targets) {
    if (!listed.includes(id)) fail(`target ${name} (${id}) is not in the project's targets list`);
  }
  if (targets.length === 0) fail("no native targets");

  for (const listId of source.matchAll(/buildConfigurationList = ([0-9A-F]{24})/g)) {
    const id = listId[1];
    const block = source.match(new RegExp(`\\t\\t${id}[^\\n]*= \\{\\n\\t\\t\\tisa = XCConfigurationList;`));
    if (!block) fail(`buildConfigurationList ${id} is not an XCConfigurationList`);
  }
}

// ── 7. Every path a file reference names actually exists ────────────────────
// The one check that catches the opposite mistake from the rest: a project
// that is perfectly well-formed and points at a file nobody wrote.
{
  /** What `cap sync` produces, taken from ios/.gitignore rather than guessed. */
  const generated = readFileSync(join(root, "ios", ".gitignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    // Everything in that file is relative to `ios/`, and every path this check
    // builds is relative to `ios/App/`. Strip the one directory they differ by.
    .map((line) => line.replace(/^App\//, ""));

  /*
   * Resolve a file reference through its parent groups, which is the only way
   * a `<group>`-relative path means anything.
   *
   * Variant groups count as parents. They carry no path of their own — a
   * localised storyboard's `Base` reference holds the whole `Base.lproj/…`
   * path — so they contribute nothing to the prefix and everything to finding
   * the group above them.
   */
  const groups = new Map();
  const groupSection = ["PBXGroup", "PBXVariantGroup"]
    .map(
      (name) =>
        source.match(
          new RegExp(`/\\* Begin ${name} section \\*/([\\s\\S]*?)/\\* End ${name} section \\*/`),
        )?.[1] ?? "",
    )
    .join("\n");
  for (const block of groupSection.split(/\n\t\t(?=[0-9A-F]{24})/)) {
    const id = block.match(/^([0-9A-F]{24})/)?.[1];
    if (!id) continue;
    const path = block.match(/\n\t\t\tpath = "?([^";\n]+)"?;/)?.[1] ?? "";
    const children = [...block.matchAll(/\n\t\t\t\t([0-9A-F]{24})/g)].map((m) => m[1]);
    groups.set(id, { path, children });
  }

  const parentOf = new Map();
  for (const [id, group] of groups) {
    for (const child of group.children) parentOf.set(child, id);
  }
  const prefixFor = (id) => {
    const parts = [];
    let cursor = parentOf.get(id);
    while (cursor) {
      const group = groups.get(cursor);
      if (group?.path) parts.unshift(group.path);
      cursor = parentOf.get(cursor);
    }
    return parts;
  };

  const refSection = source.match(
    /\/\* Begin PBXFileReference section \*\/([\s\S]*?)\/\* End PBXFileReference section \*\//,
  )?.[1];
  for (const line of (refSection ?? "").split("\n")) {
    const id = line.match(/^\t\t([0-9A-F]{24})/)?.[1];
    if (!id) continue;
    // Built products do not exist until something builds them.
    if (line.includes("sourceTree = BUILT_PRODUCTS_DIR")) continue;
    if (line.includes("sourceTree = SOURCE_ROOT")) continue;
    const path = line.match(/ path = "?([^";]+)"?;/)?.[1];
    if (!path) continue;
    const parts = [...prefixFor(id), path];
    // `cap sync` writes these; a fresh clone legitimately has none of them,
    // and ios/.gitignore is the list of what that means. Reading it rather
    // than hardcoding the three names is what keeps this check honest the day
    // a fourth is added.
    if (generated.some((pattern) => parts.join("/").includes(pattern))) continue;
    const full = join(IOS_ROOT, ...parts);
    if (!existsSync(full)) fail(`file reference ${id} points at ${full}, which does not exist`);
  }
}

// ── 8. The claims this particular change makes ──────────────────────────────
// Named rather than generic, because these are the things that are silently
// wrong rather than structurally wrong: an extension that builds and is never
// embedded, or is embedded in the wrong folder, installs and does nothing.
{
  const claims = [
    [/productType = "com\.apple\.product-type\.app-extension"/, "the widget target is an app extension"],
    [/dstSubfolderSpec = 13;/, "the extension is embedded in PlugIns (subfolder spec 13)"],
    [/isa = PBXTargetDependency;/, "the app depends on the widget target"],
    [/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/, "the app declares its entitlements"],
    [
      /CODE_SIGN_ENTITLEMENTS = NovusWidgets\/NovusWidgets\.entitlements;/,
      "the widget declares its entitlements",
    ],
    [/SKIP_INSTALL = YES;/, "the extension is not installed as a product of its own"],
  ];
  for (const [pattern, what] of claims) {
    if (!pattern.test(source)) fail(`missing: ${what}`);
  }

  // Both halves of the App Group have to be the identical string, and the
  // Swift that reads it has to agree. A group the app can write and the widget
  // cannot read fails silently and looks like a widget nobody published to.
  const groupIds = new Set();
  for (const file of [
    join(IOS_ROOT, "App", "App.entitlements"),
    join(IOS_ROOT, "NovusWidgets", "NovusWidgets.entitlements"),
  ]) {
    if (!existsSync(file)) {
      fail(`${file} does not exist`);
      continue;
    }
    const match = readFileSync(file, "utf8").match(/<string>(group\.[^<]+)<\/string>/);
    if (!match) fail(`${file} declares no application group`);
    else groupIds.add(match[1]);
  }
  const store = join(IOS_ROOT, "Shared", "OutsideStore.swift");
  if (existsSync(store)) {
    const match = readFileSync(store, "utf8").match(/appGroup = "(group\.[^"]+)"/);
    if (match) groupIds.add(match[1]);
    else fail("OutsideStore.swift declares no appGroup");
  }
  if (groupIds.size > 1) {
    fail(`the App Group is spelled ${groupIds.size} different ways: ${[...groupIds].join(", ")}`);
  }
}

// ── Report ──────────────────────────────────────────────────────────────────

if (problems.length) {
  console.error("✗ ios/App/App.xcodeproj/project.pbxproj\n");
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error(`\n  ${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
  process.exit(1);
}

const targets = [...source.matchAll(/isa = PBXNativeTarget;/g)].length;
console.log(
  `✓ project.pbxproj — ${defined.size} objects, ${targets} targets, every reference resolved`,
);
