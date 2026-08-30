#!/usr/bin/env node
/**
 * Builds the bundle the iOS and Android apps ship.
 *
 * Same source as the web build. `NEXT_PUBLIC_NATIVE=1` switches next.config.ts
 * to a static export with trailing slashes, so the shell's file server can
 * resolve a route to its index.html.
 *
 * ── Why app/api moves ────────────────────────────────────────────────────────
 *
 * `output: "export"` refuses to build a route handler that is dynamic, and all
 * seven of ours are: they read cookies, sign Stripe webhooks and talk to
 * Supabase. There is no per-route opt-out — `dynamic = "force-static"` is the
 * only escape hatch and it is a lie for these routes.
 *
 * Narrowing `pageExtensions` to `.tsx` looks like the tidy answer (every page
 * here is .tsx, every route handler .ts) and it does drop them — along with
 * Next's own resolution of its `private-next-app-dir` page aliases, which
 * stops the build entirely. So the directory moves aside for the run, and moves
 * back in a `finally` that also runs on Ctrl-C. If a previous run was killed
 * hard enough to skip even that, the next one puts it back before it starts.
 *
 * Usage:  node scripts/build-native.mjs [--no-sync]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skipSync = process.argv.includes("--no-sync");

const API_DIR = join(root, "app", "api");
const PARKED = join(root, ".native-build", "app-api");

function run(cmd, args, extraEnv = {}) {
  process.stdout.write(`\n\x1b[2m$ ${cmd} ${args.join(" ")}\x1b[0m\n`);
  execFileSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: process.platform === "win32",
  });
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}

/** The biggest `n` top-level entries of `dir`, for the failure message below. */
function largestEntries(dir, n) {
  return readdirSync(dir, { withFileTypes: true })
    .map((e) => {
      const full = join(dir, e.name);
      return { name: e.name, size: e.isDirectory() ? dirSize(full) : statSync(full).size };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, n)
    .map((e) => `      ${(e.size / 1024 / 1024).toFixed(1).padStart(6)} MB  ${e.name}`)
    .join("\n");
}

/**
 * Drops what the export produced that a phone cannot reach.
 *
 * `output: "export"` writes every static route and copies `public/` whole. Both
 * are correct for the web deploy and wrong for a store binary, where every byte
 * is a download the player waits through once and then carries forever.
 *
 * Each entry below is unreachable ON THE DEVICE specifically — not merely
 * unused-looking. Anything whose reachability depends on a runtime branch that
 * could go either way stays.
 */
const PRUNE = [
  {
    path: ["vendor", "mediapipe", "pose_landmarker_lite.task"],
    why: "pose model — delivery-coach.ts:482 skips it when `(pointer: coarse)` matches, which is every Capacitor webview",
  },
  {
    path: ["admin"],
    why: "operator console — no native surface links to it, and robots.ts already disallows it",
  },
  { path: ["og.png"], why: "social card — nothing on device renders an OpenGraph image" },
  /*
   * The briefcase art the GAME never asks for.
   *
   * Of the seven folders under public/briefcase, exactly two are reachable
   * from app code: `skins` (MySkins and the reveal card) and `models` (the
   * rotating case). The rest — the case renders, the props, the effect
   * sprites, the key art and the manifest that indexes them — are read by one
   * screen, /admin/assets, and that screen is pruned three entries above. So
   * on device they are not merely unused-looking, they are unreachable: the
   * only code that names them is already gone by the time this runs.
   */
  { path: ["briefcase", "cases"], why: "case renders — only /admin/assets draws them, and it is pruned above" },
  { path: ["briefcase", "props"], why: "prop art — same, review-only" },
  { path: ["briefcase", "fx"], why: "effect sprites — same, review-only" },
  { path: ["briefcase", "keys"], why: "key art — same, review-only" },
  { path: ["briefcase", "manifest.json"], why: "the index /admin/assets fetches — nothing else reads it" },
];

function pruneBundle(outDir) {
  let freed = 0;
  for (const { path, why } of PRUNE) {
    const full = join(outDir, ...path);
    if (!existsSync(full)) continue;
    const size = statSync(full).isDirectory() ? dirSize(full) : statSync(full).size;
    rmSync(full, { recursive: true, force: true });
    freed += size;
    console.log(`  · pruned ${path.join("/")} — ${(size / 1024 / 1024).toFixed(1)} MB (${why})`);
  }
  if (freed) console.log(`  · ${(freed / 1024 / 1024).toFixed(1)} MB pruned from the device bundle`);
}

/**
 * Reads the API origin back out of the bundle that was just built.
 *
 * `apiUrl()` bakes NEXT_PUBLIC_API_ORIGIN — or the default beside it — into the
 * chunks at build time, and there was no signal anywhere when the value that
 * landed was not the value intended. That is not hypothetical: this script
 * carried a second copy of the default and silently overrode the real one, so
 * a correction to lib/native/origin.ts shipped in source and reached no
 * binary. The build was green, the export was fresh, and every call the app
 * made still went to a host that redirects.
 *
 * So this asserts against the artifact rather than the configuration. Anything
 * that can override the origin — env, config, a well-meaning line in here —
 * has to survive being read back off disk.
 */
function verifyApiOrigin(outDir) {
  const declared = readFileSync(join(root, "lib", "native", "origin.ts"), "utf8").match(
    /NEXT_PUBLIC_API_ORIGIN\s*\|\|\s*"([^"]+)"/,
  );
  if (!declared) {
    throw new Error(
      "lib/native/origin.ts no longer declares its default the way this check reads it. " +
        "Fix the check rather than deleting it — it exists because the origin was wrong once " +
        "and nothing noticed.",
    );
  }
  const expected = (process.env.NEXT_PUBLIC_API_ORIGIN || declared[1]).replace(/\/$/, "");

  let hits = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && readFileSync(full, "utf8").includes(expected)) hits += 1;
    }
  };
  walk(join(outDir, "_next", "static", "chunks"));

  if (hits === 0) {
    console.error(
      `\n  ✗ The app will not call ${expected}.\n` +
        "    That string is in no chunk of the export, so something overrode it after\n" +
        "    lib/native/origin.ts declared it. Every request from the phone will go\n" +
        "    somewhere else and fail as a bare 'network error'.\n",
    );
    process.exit(1);
  }
  console.log(`\n  · the app will call ${expected}`);
  return expected;
}

/**
 * Installs the shell's entry document, and warms the connection it will need.
 *
 * `boot.html` reads two localStorage keys and hands the webview to a route —
 * one parse, no framework. But the very next thing the app does on that route
 * is talk to the API origin over HTTPS to a DIFFERENT host than the one it is
 * served from: in the store build the pages come off Capacitor's local file
 * server, so there is no warm connection to reuse and the first request pays a
 * full DNS + TCP + TLS handshake before a byte of it moves.
 *
 * The preconnect is injected here rather than written into native/boot.html
 * because the origin is resolved from the built artifact directly above. A
 * hardcoded second copy of that value in a static file is exactly the failure
 * verifyApiOrigin exists to catch — see its note.
 */
function installBootDocument(outDir, origin) {
  const src = readFileSync(join(root, "native", "boot.html"), "utf8");
  const hint =
    `    <link rel="preconnect" href="${origin}" crossorigin />\n` +
    `    <link rel="dns-prefetch" href="${origin}" />\n`;
  if (!src.includes("</head>")) {
    throw new Error("native/boot.html has no </head> to inject the preconnect before.");
  }
  writeFileSync(join(outDir, "boot.html"), src.replace("</head>", `${hint}  </head>`));
  console.log(`  · boot.html installed, preconnecting to ${origin}`);
}

function parkApiRoutes() {
  if (!existsSync(API_DIR)) return false;
  mkdirSync(dirname(PARKED), { recursive: true });
  if (existsSync(PARKED)) {
    throw new Error(
      `${PARKED} already exists and app/api does too. Refusing to overwrite; ` +
        "delete whichever copy is stale and run again.",
    );
  }
  renameSync(API_DIR, PARKED);
  return true;
}

function restoreApiRoutes() {
  if (!existsSync(PARKED)) return;
  if (existsSync(API_DIR)) return;
  renameSync(PARKED, API_DIR);
}

// Recover from a run that was killed before its own restore could fire.
restoreApiRoutes();

/*
 * Only the switch. The API origin is deliberately NOT set here.
 *
 * This used to carry its own copy of the default — `https://novuspitch.com` —
 * which meant that when the default in lib/native/origin.ts was corrected to
 * the canonical `www.` host (the non-www one 308s, and a browser will not
 * follow a redirect on a CORS preflight), this line quietly overrode the fix
 * on every single native build. The correction shipped in source and reached
 * no binary.
 *
 * A default written in two places is a default that will eventually disagree
 * with itself, and the half that loses is the one nobody is looking at. It
 * lives in lib/native/origin.ts now, and only there. Setting
 * NEXT_PUBLIC_API_ORIGIN in the environment still points a staging build
 * wherever it likes — `run()` passes the whole environment through.
 */
const nativeEnv = { NEXT_PUBLIC_NATIVE: "1" };

run("node", ["scripts/parse-events.mjs"]);
run("node", ["scripts/validate-events.mjs"]);
run("node", ["scripts/validate-activities.mjs"]);
run("node", ["scripts/validate-tokens.mjs"]);

const onSignal = () => {
  restoreApiRoutes();
  process.exit(130);
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

const parked = parkApiRoutes();
try {
  run("npx", ["--no-install", "next", "build"], nativeEnv);
} finally {
  if (parked) restoreApiRoutes();
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);
}

const out = join(root, "out");
if (!existsSync(out)) {
  console.error("\nout/ is missing — the export did not run. Aborting.");
  process.exit(1);
}

const apiOrigin = verifyApiOrigin(out);

installBootDocument(out, apiOrigin);

pruneBundle(out);

const bytes = dirSize(out);
const mb = (bytes / 1024 / 1024).toFixed(1);
console.log(`  · bundle is ${mb} MB on device`);

/*
 * ── The number was measured and then thrown away ────────────────────────────
 *
 * This line printed the bundle size for a long time and did nothing with it,
 * which is the whole reason there was 6.7 MB of provably dead .mp4 in
 * `public/` to find: `docs/BASELINE.md` recorded those files as unreferenced,
 * `docs/BUILD-PROMPT.md` instructed their deletion, and they shipped in every
 * store binary anyway — because a printed number is a number nobody reads and
 * no build has ever failed over.
 *
 * So it fails now. The ceiling is deliberately loose: it is not a target, it is
 * a tripwire for the next 7 MB that arrives without anyone deciding it should.
 * Raising it is a legitimate thing to do — a real asset that earns its weight
 * should move this line, in a commit that says so. Silently growing past it is
 * what this exists to prevent.
 *
 * ── Where 46 comes from, and where it should go ─────────────────────────────
 *
 * The bundle measures 43.5 MB today, after the prune above. A tripwire has to
 * sit just above the real number or it is not a tripwire, it is a broken
 * build — this was set to 32 first, which is the figure the asset work is
 * AIMED at rather than the one it has reached, and it failed the native build
 * on the first run.
 *
 * It should come down twice more, and both are known:
 *
 *   · `scripts/make-clips.mjs` re-encodes the 9.0 MB of onboarding video.
 *     ffmpeg is required and was not available where this was written, so the
 *     saving is scripted rather than taken. Expect ~4–5 MB back.
 *   · `vendor` is 22.1 MB, over half the bundle, and 9.4 MB of it is
 *     `vision_wasm_nosimd_internal.wasm` — the no-SIMD twin, needed only below
 *     iOS 16.4. Raising IPHONEOS_DEPLOYMENT_TARGET drops it, and that is a
 *     product decision about which phones to support, not a build tweak.
 *
 * Lower this line as each lands.
 *
 * ── 50, and where the 4 MB went ─────────────────────────────────────────────
 *
 * The briefcase art. `skins` is 6.6 MB and `models` 1.1 MB, and both are
 * reachable on device — the reveal card and MY SKINS draw every design, and
 * the case that rotates through the three taps is a glb. The 1.9 MB of
 * review-only art that came with them is pruned above rather than counted.
 *
 * A design is 640² and ~39 kB, which is the right size rather than a generous
 * one: the reveal card is 224 px wide and a 3× phone asks for 672. Sixteen
 * designs are still unrendered, so expect skins to reach ~7.9 MB — 50 is set
 * to hold that too, and is not somewhere to spend again.
 *
 * There is a third reduction to add to the two above, and it is the largest:
 *
 *   · `skins` need not be in the binary at all. Every /api/rewards route 404s
 *     without the beta flag, so the wardrobe cannot be claimed, opened or even
 *     listed offline — 6.6 MB of art is being carried for a feature that
 *     already requires the network. Serving it from the origin instead needs
 *     an absolute URL and a CSP entry, which is a deliberate change and not
 *     one to smuggle into the commit that adds the feature.
 */
const CEILING_MB = 50;
if (bytes / 1024 / 1024 > CEILING_MB) {
  console.error(
    `\n  ✗ bundle is ${mb} MB, over the ${CEILING_MB} MB ceiling.\n` +
      `    Largest entries:\n${largestEntries(out, 8)}\n` +
      `    Either drop what grew, or raise CEILING_MB in scripts/build-native.mjs\n` +
      `    in the same commit — deliberately, with the reason in the message.`,
  );
  process.exit(1);
}

if (!skipSync) {
  /*
   * ── The copy and the update are not the same job ────────────────────────
   *
   * `cap sync` is two things: copy the web assets into each native project,
   * then reinstall that project's native dependencies. Only the second half
   * needs a toolchain — CocoaPods, an Android SDK — and only the second half
   * is allowed to fail on a machine that does not have one. That distinction
   * used to be lost, because the whole of `sync` sat in one try/catch that
   * swallowed everything and printed a warning.
   *
   * What that cost is worth writing down. When the sync failed, the app kept
   * whatever `public/` it already had — so a build that had just been made
   * shipped a bundle from days ago. If that stale copy predated a route, the
   * shell could not resolve it and fell back to `index.html`, which in this
   * app is the marketing page: the app opened on a page it is never meant to
   * show, and every navigation out of it came back to the same place, because
   * every one of them resolved to the same fallback. An infinite loop between
   * a screen and itself, produced entirely by a warning nobody saw — printed,
   * on top of that, AFTER the "bundle is N MB on device" line that reads like
   * the build succeeded.
   *
   * So the copy runs on its own and is allowed to fail the build, the update
   * keeps its warning, and the result is checked rather than assumed.
   */
  run("npx", ["--no-install", "cap", "copy"]);

  try {
    run("npx", ["--no-install", "cap", "sync"]);
  } catch {
    console.warn(
      "\n  ! cap sync did not finish its native dependency step. The web assets " +
        "are copied and the app will run; re-run `npx cap sync` on a machine " +
        "with the platform toolchains installed if a plugin was added.",
    );
  }

  verifyCopied();
}

/**
 * Proves the app is actually holding the bundle that was just built.
 *
 * Every failure this catches looks like a working build from the outside: the
 * export is fine, the console is green, and the thing on the phone is old. The
 * two files checked are the two whose absence is unrecoverable — `boot.html`
 * is the entry point the shell is pointed at, and `play/index.html` is the
 * route it sends most players to. Byte-compared rather than merely present,
 * because a stale copy is the failure mode, not an empty one.
 */
function verifyCopied() {
  const PLATFORMS = [
    ["iOS", join(root, "ios", "App", "App", "public"), join(root, "ios", "App", "App")],
    [
      "Android",
      join(root, "android", "app", "src", "main", "assets", "public"),
      join(root, "android", "app", "src", "main", "assets"),
    ],
  ];
  const MUST_MATCH = ["boot.html", join("play", "index.html")];

  const stale = [];
  for (const [name, dir, configDir] of PLATFORMS) {
    // A platform that was never added is not a failure — plenty of checkouts
    // carry one and not the other.
    if (!existsSync(dirname(dirname(dir)))) continue;
    if (!existsSync(dir)) {
      stale.push(`${name}: ${dir} does not exist — nothing was copied`);
      continue;
    }
    for (const file of MUST_MATCH) {
      const there = join(dir, file);
      if (!existsSync(there)) {
        stale.push(`${name}: ${file} is missing from the app bundle`);
      } else if (!readFileSync(there).equals(readFileSync(join(out, file)))) {
        stale.push(`${name}: ${file} in the app does not match the one just built`);
      }
    }

    /*
     * The config is checked separately because losing it fails differently,
     * and worse. `appStartPath` lives ONLY in this generated file — nothing in
     * the Xcode project carries it — so an app without it does not fail to
     * start, it starts somewhere else: Capacitor's default, `index.html`,
     * which in this repo is the marketing page. Missing web assets at least
     * look broken. This looks like a design decision.
     */
    const config = join(configDir, "capacitor.config.json");
    if (!existsSync(config)) {
      stale.push(`${name}: capacitor.config.json was not generated — appStartPath is lost`);
    } else if (!JSON.parse(readFileSync(config, "utf8")).server?.appStartPath) {
      stale.push(`${name}: capacitor.config.json carries no appStartPath`);
    }
  }

  if (!stale.length) {
    console.log("  · verified: the app bundles hold this build");
    return;
  }

  console.error("\n\x1b[31m  ✗ the native projects are NOT holding this build\x1b[0m");
  for (const line of stale) console.error(`      ${line}`);
  console.error(
    "\n  The app will keep running whatever it copied last time, which is how a\n" +
      "  route goes missing and the shell falls back to the marketing page.\n" +
      "  Fix the copy before building in Xcode:  npx cap copy\n",
  );
  process.exit(1);
}
