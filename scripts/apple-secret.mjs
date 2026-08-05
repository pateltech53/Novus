#!/usr/bin/env node
/**
 * Signs the client secret Apple's OAuth flow needs.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Google hands you a client secret and you paste it. Apple does not: what
 * every OAuth client calls "the secret" is, for Apple, a short-lived ES256 JWT
 * that you sign yourself with the `.p8` key from the developer portal. Some
 * Supabase dashboard versions take the Team ID, Key ID and key contents and
 * sign it for you; others want the finished token. This is for the second
 * case, and for the day the first case's copy expires.
 *
 * No dependency — Node's crypto signs ES256 directly, given
 * `dsaEncoding: "ieee-p1363"`. That flag is the whole trick: OpenSSL's default
 * for an EC signature is DER, and JWS requires the raw r‖s pair. A DER
 * signature here produces a token that looks perfectly well-formed and is
 * rejected by Apple with `invalid_client`, which is a bad afternoon.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/apple-secret.mjs AuthKey_ABCD123456.p8 TEAMID1234 ABCD123456 com.novuspitch.web
 *                                 └─ the downloaded key   └─ Team  └─ Key ID  └─ Services ID
 *
 * Paste what it prints into Supabase → Authentication → Providers → Apple →
 * "Secret Key (for OAuth)".
 *
 * ── It expires ────────────────────────────────────────────────────────────
 *
 * Apple caps these at six months and this script asks for the maximum. The
 * expiry date is printed rather than left implicit, because the failure mode
 * is every Apple sign-in breaking at once, on a date nobody wrote down. Put it
 * in a calendar the moment you generate one.
 */

import { readFileSync } from "node:fs";
import { createPrivateKey, sign } from "node:crypto";

const [, , keyPath, teamId, keyId, servicesId] = process.argv;

if (!keyPath || !teamId || !keyId || !servicesId) {
  console.error(`
Usage:
  node scripts/apple-secret.mjs <AuthKey_XXXX.p8> <TeamID> <KeyID> <ServicesID>

Where to find each one, in the Apple developer portal:
  AuthKey_XXXX.p8  Keys → the key you made → Download (once, and only once)
  TeamID           top right of the portal, or Membership details — 10 chars
  KeyID            Keys → your key — 10 chars, also in the .p8 filename
  ServicesID       Identifiers → Services IDs — e.g. com.novuspitch.web
`);
  process.exit(1);
}

const base64url = (input) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let privateKey;
try {
  privateKey = createPrivateKey(readFileSync(keyPath, "utf8"));
} catch (error) {
  console.error(`\nCould not read ${keyPath} as a private key.`);
  console.error("It should be the .p8 exactly as downloaded, starting -----BEGIN PRIVATE KEY-----");
  console.error(`\n  ${error.message}\n`);
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
// Apple's ceiling is 6 months (15777000s). Asking for it is deliberate: a
// shorter token buys nothing here and costs a rotation nobody scheduled.
const exp = now + 15777000;

const header = { alg: "ES256", kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp,
  aud: "https://appleid.apple.com",
  // Apple's `sub` for a client secret is the client id — the Services ID for
  // the web flow. Not the bundle id, and not the Team ID.
  sub: servicesId,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
const signature = sign("sha256", Buffer.from(signingInput), {
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});

const token = `${signingInput}.${signature.toString("base64url")}`;

console.log(`\n${token}\n`);
console.log(`  Services ID : ${servicesId}`);
console.log(`  expires     : ${new Date(exp * 1000).toISOString().slice(0, 10)}  ← calendar this`);
console.log(`\n  Paste into Supabase → Authentication → Providers → Apple`);
console.log(`  → "Secret Key (for OAuth)".\n`);
