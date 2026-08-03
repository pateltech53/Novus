#!/usr/bin/env node
/**
 * Runs the SQL suites in supabase/tests against a real Postgres.
 *
 *   npm run test:db
 *   DATABASE_URL=postgres://user:pass@host:5432/postgres npm run test:db
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Nearly every security argument in this codebase ends at row-level security.
 * The route handlers say so out loud — "everything runs as the signed-in
 * player, so RLS is the access check", "there is no code path in this file
 * that can touch another player's row" — and they are right to, because that
 * IS where the enforcement lives.
 *
 * The suites that check it were written and then never run again. They opened
 * with `\set ON_ERROR_STOP 0` and printed, so they could not fail; nothing in
 * CI invoked them; and half of what they proved was that a statement is
 * refused, which in that form looked identical to a statement that broke.
 * A leaderboard for children whose access control is verified by a file
 * somebody might read is not verified.
 *
 * So: every suite now asserts (see _supabase_shim.sql), and this runs them on
 * a fresh database each, on every pull request.
 *
 * ── Fresh database per suite ────────────────────────────────────────────────
 *
 * The suites share fixture ids and each ends by deleting a player to prove the
 * cascade. Sharing a database would make them order-dependent, and an
 * order-dependent security test is one that passes for the wrong reason.
 *
 * ── All five migrations, every time ─────────────────────────────────────────
 *
 * Each suite targets one migration, but they run against the whole stack
 * because that is what production is. A policy in 0001 that a later migration
 * quietly widens — a GRANT to `authenticated`, a SECURITY DEFINER function
 * left executable — would pass a suite applied only up to 0001 and fail here.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const TESTS = join(ROOT, "supabase", "tests");

const SUITES = [
  "schema_test.sql",
  "moderation_test.sql",
  "billing_test.sql",
  "accounts_test.sql",
  "throttle_test.sql",
  "submit_test.sql",
  "chapters_test.sql",
];

/** Every migration, in the order their filenames give. */
const migrationFiles = () =>
  readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS, f));

// ── Connecting ───────────────────────────────────────────────────────────────

/**
 * The admin connection, from DATABASE_URL or the standard PG* variables.
 *
 * psql reads PG* itself, so the no-DATABASE_URL path is simply "pass nothing
 * and let libpq do what it always does" — which is what makes `npm run
 * test:db` work against a developer's local socket with no configuration.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "";

/** psql args that point at the admin database (for CREATE/DROP DATABASE). */
const adminTarget = () => (DATABASE_URL ? ["-d", DATABASE_URL] : []);

/** psql args that point at one of our scratch databases. */
function suiteTarget(name) {
  if (!DATABASE_URL) return ["-d", name];
  const url = new URL(DATABASE_URL);
  url.pathname = `/${name}`;
  return ["-d", url.toString()];
}

const QUIET = ["-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];

function psql(args, { capture = true } = {}) {
  return spawnSync("psql", args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function requirePsql() {
  try {
    execFileSync("psql", ["--version"], { stdio: "ignore" });
  } catch {
    fail(
      "psql is not on PATH.\n" +
        "  macOS:  brew install libpq && brew link --force libpq\n" +
        "  Debian: sudo apt-get install -y postgresql-client",
    );
  }
}

function requireServer() {
  const probe = psql([...adminTarget(), ...QUIET, "-c", "select 1"]);
  if (probe.status !== 0) {
    fail(
      "Could not reach a Postgres server.\n" +
        (DATABASE_URL
          ? `  DATABASE_URL=${DATABASE_URL}\n`
          : "  No DATABASE_URL set, so the standard PG* variables were used.\n") +
        "  Start one, or point DATABASE_URL at one:\n" +
        "    docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16\n" +
        "    DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db\n" +
        `\n${(probe.stderr || "").trim()}`,
    );
  }
}

function fail(message) {
  process.stderr.write(`\n✘ ${message}\n`);
  process.exit(1);
}

// ── Running one suite ────────────────────────────────────────────────────────

/**
 * psql writes assertions to stderr as NOTICE lines and section headers to
 * stdout, each carrying a `psql:file:line:` prefix. Stripping it and dropping
 * the blank lines a `select test.eq(…)` leaves behind turns the two streams
 * into one readable transcript.
 */
const tidy = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/^psql:[^:]*:\d+:\s*/, "").replace(/^NOTICE:\s{2}/, ""))
    .filter((line) => line.trim() !== "")
    .join("\n");

function runSuite(suite) {
  const db = `novus_test_${suite.replace(/\.sql$/, "")}`;

  psql([...adminTarget(), ...QUIET, "-c", `drop database if exists ${db}`]);
  const created = psql([...adminTarget(), ...QUIET, "-c", `create database ${db}`]);
  if (created.status !== 0) fail(`could not create ${db}:\n${created.stderr}`);

  const target = suiteTarget(db);
  const setup = [join(TESTS, "_supabase_shim.sql"), ...migrationFiles()];

  for (const file of setup) {
    const applied = psql([...target, ...QUIET, "-f", file]);
    if (applied.status !== 0) {
      return { suite, ok: false, output: tidy(applied.stderr), stage: `applying ${file}` };
    }
  }

  const run = psql([...target, ...QUIET, "-f", join(TESTS, suite)]);
  const output = tidy(`${run.stdout}\n${run.stderr}`);

  // Belt and braces on the exit code: a suite that ended early without an
  // error — an editor truncating a file, a `\q` left in — would otherwise
  // report as a pass with fewer checks, which is the failure mode this whole
  // exercise exists to remove.
  const finished = output.includes("all checks passed");

  psql([...adminTarget(), ...QUIET, "-c", `drop database if exists ${db}`]);

  return {
    suite,
    ok: run.status === 0 && finished,
    output,
    stage: run.status === 0 && !finished ? "suite ended before its final marker" : null,
    checks: (output.match(/^ {2}ok {3}/gm) ?? []).length,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────

requirePsql();
requireServer();

const verbose = process.argv.includes("--verbose");
let failed = 0;
let checks = 0;

for (const suite of SUITES) {
  const result = runSuite(suite);
  checks += result.checks ?? 0;

  if (result.ok) {
    process.stdout.write(`✓ ${suite.padEnd(22)} ${result.checks} checks\n`);
    if (verbose) process.stdout.write(`${result.output}\n\n`);
  } else {
    failed += 1;
    process.stdout.write(`✘ ${suite}${result.stage ? ` — ${result.stage}` : ""}\n`);
    process.stdout.write(`${result.output}\n\n`);
  }
}

if (failed) {
  process.stderr.write(`\n${failed} of ${SUITES.length} suites failed.\n`);
  process.exit(1);
}

process.stdout.write(`\n${SUITES.length} suites, ${checks} checks, all passed.\n`);
