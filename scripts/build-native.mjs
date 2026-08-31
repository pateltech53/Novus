#!/usr/bin/env node
/**
 * Builds and verifies what the iOS and Android apps actually ship — which,
 * since the shell went remote, is no longer the web app.
 *
 * ── What this script was, and what it is now ────────────────────────────────
 *
 * It used to produce the store bundle: a full static export, pruned, budgeted
 * against a 50 MB ceiling, with a boot document injected, all copied
 * byte-verified into both native projects. capacitor.config.ts now points the
 * shell at https://www.novuspitch.com directly (`server.url` — the config's
 * header essay records the decision), so the binaries carry exactly one
 * document: native/shell/index.html, the offline notice `server.errorPath`
 * falls back to. The prune list, the size ceiling and the boot injection are
 * gone with the bundle they governed — a ceiling on an artifact that no
 * longer ships is a check that can only cry wolf.
 *
 * What remains is worth being precise about:
 *
 *   1. The static export still builds. The Playwright probes (audit:phone,
 *      test:tap, test:exits …) serve out/ as a stand-in for the deploy, and
 *      the export doubles as a compile gate for the NEXT_PUBLIC_NATIVE path.
 *      app/api still moves aside for it — `output: "export"` refuses dynamic
 *      route handlers, and all of ours are (cookies, Stripe signatures,
 *      Supabase). The directory moves back in a `finally` that also runs on
 *      Ctrl-C; a run killed harder than that is repaired on the next start.
 *   2. The API origin is read back OUT of the artifact (verifyApiOrigin) —
 *      this script once overrode lib/native/origin.ts silently and shipped
 *      the wrong host, so the assertion is against what was built, not what
 *      was configured.
 *   3. The shell agreement is asserted: the retry link hardcoded in
 *      native/shell/index.html must point at the same origin as
 *      capacitor.config.ts's server.url, which must be the same host as the
 *      API origin. Three files, one value — this is where drift gets caught.
 *   4. The native projects are verified to hold this build's shell document
 *      and a generated config that carries server.url — losing that config
 *      does not fail, it quietly ships an app that opens on the bundled
 *      offline page forever.
 *   5. The iOS SPM manifest is verified to name every Capacitor plugin in
 *      package.json. Build 1.0(3) shipped from a machine whose
 *      CapApp-SPM/Package.swift predated @capgo/capacitor-social-login — the
 *      committed manifest never carried it, `cap sync`'s dependency step was
 *      allowed to fail with a console.warn, and whether the binary could sign
 *      players in depended on an uncommitted regeneration. Now it fails here.
 *
 * Usage:  node scripts/build-native.mjs [--no-sync]
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, readdirSync } from "node:fs";
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

/**
 * Reads the API origin back out of the export that was just built.
 *
 * `apiUrl()` bakes NEXT_PUBLIC_API_ORIGIN — or the default beside it — into
 * the chunks at build time, and there was no signal anywhere when the value
 * that landed was not the value intended. That is not hypothetical: this
 * script carried a second copy of the default and silently overrode the real
 * one, so a correction to lib/native/origin.ts shipped in source and reached
 * no binary. So this asserts against the artifact rather than the
 * configuration.
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
 * One origin, three files, no drift.
 *
 * capacitor.config.ts holds the remote shell's `server.url`;
 * native/shell/index.html hardcodes the same origin in its RETRY link
 * (a standalone document cannot import it); lib/native/origin.ts declares the
 * API origin the pages will call. The whole design of the remote shell is
 * that these are ONE host — same-origin is what lets the CSP, the CSRF guard
 * and the session cookie all pass untouched — so the moment any of the three
 * says something different, this build stops.
 */
function verifyShellAgreement(apiOrigin) {
  const config = readFileSync(join(root, "capacitor.config.ts"), "utf8");
  const url = config.match(/\burl:\s*"([^"]+)"/);
  if (!url) {
    console.error(
      "\n  ✗ capacitor.config.ts no longer declares server.url the way this check reads it.\n" +
        "    The shell would fall back to serving its webDir — one offline page — forever.\n",
    );
    process.exit(1);
  }
  const serverOrigin = url[1].replace(/\/$/, "");
  if (serverOrigin !== apiOrigin) {
    console.error(
      `\n  ✗ capacitor.config.ts loads the shell from ${serverOrigin}\n` +
        `    but the pages are built to call ${apiOrigin}.\n` +
        "    Those must be the same host — the remote shell's whole security story\n" +
        "    (connect-src 'self', Sec-Fetch-Site, the session cookie) is same-origin.\n",
    );
    process.exit(1);
  }

  const shellDoc = readFileSync(join(root, "native", "shell", "index.html"), "utf8");
  if (!shellDoc.includes(`${serverOrigin}/boot.html`)) {
    console.error(
      `\n  ✗ native/shell/index.html does not retry to ${serverOrigin}/boot.html.\n` +
        "    Its RETRY link is a hardcoded copy of server.url (a standalone document\n" +
        "    cannot read the config) — the two have drifted apart. Fix the shell page.\n",
    );
    process.exit(1);
  }

  if (!existsSync(join(root, "public", "boot.html"))) {
    console.error(
      "\n  ✗ public/boot.html is missing — the shell's appStartPath has nothing to load.\n" +
        "    Every cold start would land on the marketing page instead of the game.\n",
    );
    process.exit(1);
  }

  console.log(`  · shell, retry link and API agree on ${serverOrigin}`);
  return serverOrigin;
}

/**
 * Every Capacitor plugin in package.json must be in the committed iOS SPM
 * manifest, by name. The registry is derived, not listed here: a dependency
 * that ships a Package.swift is an SPM Capacitor plugin, which is exactly the
 * set `cap sync` writes into CapApp-SPM/Package.swift — so a plugin added to
 * package.json without the regenerated manifest being committed fails this
 * build instead of silently shipping a binary without it.
 */
function verifyNativePlugins() {
  const deps = Object.keys(
    JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies ?? {},
  );
  const plugins = deps.filter((d) => existsSync(join(root, "node_modules", d, "Package.swift")));
  const manifest = readFileSync(join(root, "ios", "App", "CapApp-SPM", "Package.swift"), "utf8");

  const missing = plugins.filter((d) => !manifest.includes(`node_modules/${d}`));
  if (missing.length) {
    console.error(
      "\n  ✗ ios/App/CapApp-SPM/Package.swift does not carry:\n" +
        missing.map((d) => `      ${d}`).join("\n") +
        "\n    The binary Xcode builds from this tree cannot reach that plugin — the\n" +
        "    button renders and every tap fails, which is how build 1.0(3) shipped a\n" +
        "    Sign in with Apple that could not open. Run `npx cap update ios` and\n" +
        "    commit the regenerated manifest.\n",
    );
    process.exit(1);
  }
  console.log(`  · iOS SPM manifest carries all ${plugins.length} Capacitor plugins`);
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
 * lives in lib/native/origin.ts now, and only there.
 *
 * Under the remote shell the env override is deliberately NOT enough on its
 * own for a native build: NEXT_PUBLIC_API_ORIGIN still repoints the export's
 * API calls, but verifyShellAgreement will then fail the build, on purpose —
 * the shell's server.url in capacitor.config.ts and the RETRY origin in
 * native/shell/index.html are hardcoded, and a staging SHELL that loads
 * production pages against staging APIs (or vice versa) is exactly the
 * split-brain the assertion exists to prevent. A staging shell edits all
 * three, and the check is what remembers the third one.
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
verifyShellAgreement(apiOrigin);
verifyNativePlugins();

if (!skipSync) {
  /*
   * ── The copy and the update are not the same job ────────────────────────
   *
   * `cap sync` is two things: copy the web assets into each native project,
   * then reinstall that project's native dependencies. Only the second half
   * needs a toolchain — CocoaPods, an Android SDK — and only the second half
   * is allowed to fail on a machine that does not have one. That distinction
   * used to be lost, because the whole of `sync` sat in one try/catch that
   * swallowed everything and printed a warning — which is precisely how a
   * binary once shipped without the sign-in plugin. The manifest check above
   * now catches that case regardless of what happens here, so the warning is
   * honest again: on THIS machine the dependency step may fail, but the
   * committed manifest is already proven right.
   */
  run("npx", ["--no-install", "cap", "copy"]);

  try {
    run("npx", ["--no-install", "cap", "sync"]);
  } catch {
    console.warn(
      "\n  ! cap sync did not finish its native dependency step. The shell assets " +
        "are copied and the committed SPM manifest is verified above; re-run " +
        "`npx cap sync` on a machine with the platform toolchains installed.",
    );
  }

  verifyCopied();
}

/**
 * Proves the native projects are holding this build's shell.
 *
 * Two things matter now, and losing either looks like a working build from
 * the outside. The shell document is the app's only offline surface — a stale
 * copy shows an old page precisely when nothing else can load. And the
 * generated capacitor.config.json is where `server.url` actually reaches the
 * binary: nothing in the Xcode or Gradle projects carries it, so an app whose
 * generated config went missing does not fail — it opens on the bundled
 * offline page and stays there, forever, looking like a design decision.
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

  const shellSource = readFileSync(join(root, "native", "shell", "index.html"));
  const bootSentinel = readFileSync(join(root, "native", "shell", "boot.html"));

  const stale = [];
  for (const [name, dir, configDir] of PLATFORMS) {
    // A platform that was never added is not a failure — plenty of checkouts
    // carry one and not the other.
    if (!existsSync(dirname(dirname(dir)))) continue;

    const there = join(dir, "index.html");
    if (!existsSync(there)) {
      stale.push(`${name}: the shell document was not copied — nothing answers offline`);
    } else if (!readFileSync(there).equals(shellSource)) {
      stale.push(`${name}: the copied shell document does not match native/shell/index.html`);
    }

    // iOS exits the process at launch when appStartPath names a file the
    // LOCAL webDir does not hold, even though the load itself goes to
    // server.url — CAPBridgeViewController.loadWebView() existence-checks
    // before it loads. The sentinel's absence is not "offline is broken",
    // it is "the app never opens".
    const sentinel = join(dir, "boot.html");
    if (!existsSync(sentinel)) {
      stale.push(`${name}: boot.html sentinel missing — iOS fatalLoadError()s at launch without it`);
    } else if (!readFileSync(sentinel).equals(bootSentinel)) {
      stale.push(`${name}: the copied boot.html sentinel does not match native/shell/boot.html`);
    }

    const config = join(configDir, "capacitor.config.json");
    if (!existsSync(config)) {
      stale.push(`${name}: capacitor.config.json was not generated — server.url is lost`);
    } else {
      const server = JSON.parse(readFileSync(config, "utf8")).server ?? {};
      if (!server.url) {
        stale.push(`${name}: capacitor.config.json carries no server.url — the app would serve its offline page as the whole game`);
      }
      if (!server.appStartPath) {
        stale.push(`${name}: capacitor.config.json carries no appStartPath — cold starts would open the marketing page`);
      }
      if (!server.errorPath) {
        stale.push(`${name}: capacitor.config.json carries no errorPath — offline would be a blank webview`);
      }
    }
  }

  if (!stale.length) {
    console.log("  · verified: the native projects hold this build's shell and config");
    return;
  }

  console.error("\n\x1b[31m  ✗ the native projects are NOT holding this build\x1b[0m");
  for (const line of stale) console.error(`      ${line}`);
  console.error("\n  Fix the copy before building in Xcode:  npx cap copy\n");
  process.exit(1);
}
