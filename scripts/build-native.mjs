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
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
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

const nativeEnv = {
  NEXT_PUBLIC_NATIVE: "1",
  // Where the server routes live once the app is on a phone. Overridable so a
  // staging build can be pointed at a staging origin.
  NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN || "https://novuspitch.com",
};

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

copyFileSync(join(root, "native", "boot.html"), join(out, "boot.html"));
console.log("\n  · boot.html installed as the app entry point");

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
