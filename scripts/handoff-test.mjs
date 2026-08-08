#!/usr/bin/env node
/**
 * WHICH ACCOUNT IS BUYING — the claim, and the ways it must fail.
 *
 *   npm run test:handoff
 *
 * A store build cannot sell, so GET PRO opens the website in the player's own
 * browser, and that browser is a different session from the app. When the two
 * are different ACCOUNTS the purchase lands somewhere the phone will never see
 * it, and no amount of tapping Restore can mend it. lib/billing/handoff.ts is
 * the thing that notices; this is the file that makes sure it keeps noticing.
 *
 * Every case here is a way the check could go wrong quietly:
 *
 *   1. A forged or edited claim must not verify. This one is the whole point —
 *      a claim that could be edited would let anyone assert any account, and
 *      the check would enforce a lie instead of catching one.
 *   2. An expired claim must read as "nothing was claimed", NOT as a failure.
 *      A player who took forty minutes to find their password is the exact
 *      person this feature exists for, and refusing their purchase over a
 *      stale token would be the feature causing the failure it prevents.
 *   3. The masked address must be recognisable and must not be readable. It is
 *      shown to a browser that has NOT proved it owns the account.
 *
 * The secret is set here rather than read from a deployment: these are pure
 * functions over an HMAC, and what is being tested is the arithmetic.
 */

import { createHmac } from "node:crypto";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Read at module load by lib/stripe/config.ts, so it has to be set BEFORE the
// dynamic import below rather than anywhere further down the file.
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key-for-handoff";

register("./ts-loader.mjs", import.meta.url);

const { mintHandoff, readHandoff, maskEmail } = await import(
  join(root, "lib/billing/handoff.ts")
);

let passed = 0;
const failures = [];

function ok(condition, label, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const USER = "6f1b7f2e-0a2c-4c8e-9c3a-8b1d2e3f4a5b";
const OTHER = "11111111-2222-3333-4444-555555555555";

// ── 1 · a claim only the server can make ────────────────────────────────────
console.log("\n=== 1 · the round trip ===");

const token = mintHandoff(USER);
ok(typeof token === "string" && token.includes("."), "a claim is minted");
ok(readHandoff(token) === USER, "and reads back as the account it named");
ok(readHandoff(mintHandoff(OTHER)) === OTHER, "two accounts do not collide");

console.log("\n=== 2 · every way it must refuse ===");

ok(readHandoff(null) === null, "nothing is not a claim");
ok(readHandoff("") === null, "and neither is an empty string");
ok(readHandoff("not-a-token") === null, "nor a string with no signature");
ok(readHandoff(`${token}x`) === null, "a signature with a character added fails");
ok(readHandoff(token.replace(/.$/, "")) === null, "and one with a character removed");

/*
 * The forgery that matters: keep a real signature, swap the account it covers.
 * This is what an attacker with one legitimate token would try, and it is the
 * only reason the payload is signed rather than merely encoded.
 */
const [payload, signature] = token.split(".");
const forgedPayload = Buffer.from(
  JSON.stringify({ u: OTHER, x: Date.now() + 60_000 }),
  "utf8",
).toString("base64url");
ok(
  readHandoff(`${forgedPayload}.${signature}`) === null,
  "a real signature over a rewritten account is refused",
);
ok(readHandoff(`${payload}.${signature}`) === USER, "while the untouched pair still reads");

// Expiry. Built by hand rather than by waiting half an hour.
const stale = (() => {
  const body = Buffer.from(
    JSON.stringify({ u: USER, x: Date.now() - 1000 }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
})();
ok(
  readHandoff(stale) === null,
  "a correctly signed but expired claim reads as no claim at all",
);

// ── 3 · the address the signed-out browser is shown ─────────────────────────
console.log("\n=== 3 · the masked address ===");

const masked = maskEmail("founder@example.com");
ok(masked === "fou•••@example.com", "enough to recognise", String(masked));
ok(
  !masked.includes("founder"),
  "and not enough to learn an address you did not have",
  masked,
);
ok(maskEmail("a@b.com") === "a•••@b.com", "a one-character local part still masks");
ok(maskEmail(null) === null && maskEmail("nonsense") === null, "nothing in, nothing out");

console.log(
  `\n${passed} passed, ${failures.length} failed.` +
    (failures.length ? `\n  ${failures.join("\n  ")}\n` : "\n"),
);
process.exit(failures.length === 0 ? 0 : 1);
