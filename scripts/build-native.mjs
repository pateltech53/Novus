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
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
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

verifyApiOrigin(out);

copyFileSync(join(root, "native", "boot.html"), join(out, "boot.html"));
console.log("  · boot.html installed as the app entry point");

const mb = (dirSize(out) / 1024 / 1024).toFixed(1);
console.log(`  · bundle is ${mb} MB on device`);

if (!skipSync) {
  // `cap sync` also re-runs the native dependency install. On a machine
  // without CocoaPods that step fails after the copy has already succeeded,
  // which is fine for a CI job that only builds Android.
  try {
    run("npx", ["--no-install", "cap", "sync"]);
  } catch {
    console.warn(
      "\n  ! cap sync did not finish. The web assets are built; run `npx cap sync` " +
        "on a machine with the platform toolchains installed.",
    );
  }
}
