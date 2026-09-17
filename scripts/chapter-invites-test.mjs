#!/usr/bin/env node
/**
 * Invitation handover regressions against the real route handlers and SDK.
 *
 * Every outbound request is intercepted below; an unrecognised destination
 * fails the test rather than reaching a mailbox, auth project, or database.
 * The assertions cover the observable handover: email failure cannot become
 * a sent timestamp, opening a link cannot claim a seat, and BOTH mailers
 * finish the claim only after a password succeeds. Storage checks exercise
 * refresh recovery without extending the tab's short credential lifetime.
 *
 *   node scripts/chapter-invites-test.mjs
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { execFileSync } from "node:child_process";
const fallback = process.argv.includes("--fallback");

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://novus-invite-test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.NEXT_PUBLIC_SITE_URL = "https://novus-test.invalid";
process.env.RESEND_API_KEY = fallback ? "" : "test-mail-key";
process.env.RESEND_FROM = "Novus <test@novus-test.invalid>";

register("./ts-loader.mjs", import.meta.url);
register("./route-loader.mjs", import.meta.url);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CHAPTER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "33333333-3333-4333-8333-333333333333";
const EMAIL = "student@novus-test.invalid";
const user = { id: USER_ID, email: EMAIL, aud: "authenticated", role: "authenticated", is_anonymous: false };
const makeJwt = (exp) => [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ sub: USER_ID, exp })).toString("base64url"),
  Buffer.from("test-signature").toString("base64url"),
].join(".");
const jwt = makeJwt(Math.floor(Date.now() / 1000) + 3600);
const session = { access_token: jwt, refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer", user };
let state;

const reset = (overrides = {}) => {
  state = {
    seat: null,
    setup: null,
    mailThrottled: false,
    setupReadFails: false,
    setupWriteFails: false,
    profileName: "Founder",
    existingAccount: false,
    mailFails: false,
    linkFails: false,
    passwordFails: false,
    samePassword: false,
    completionFails: false,
    incompleteProfile: false,
    removalFails: false,
    removedBeforeRpc: false,
    grantFails: false,
    entitlement: false,
    deletedUsers: 0,
    lookupFails: false,
    rotateRefresh: false,
    sent: 0,
    generated: 0,
    passwordWrites: 0,
    profileWrites: 0,
    grants: 0,
    requests: [],
    ...overrides,
  };
};
const pendingSeat = () => ({
  id: "44444444-4444-4444-8444-444444444444",
  chapter_id: CHAPTER_ID,
  profile_id: USER_ID,
  email: EMAIL,
  seat_name: null,
  origin: "invited",
  invite_token: TOKEN,
  created_by_invite: true,
  claimed_at: null,
  invite_sent_at: null,
});
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const matchesSeat = (params) => state.seat && [...params].every(([key, value]) => {
  if (["select", "order", "limit"].includes(key)) return true;
  if (value === "is.null") return state.seat[key] == null;
  if (value.startsWith("eq.")) return String(state.seat[key]) === value.slice(3);
  throw new Error(`Unhandled seat filter ${key}=${value}`);
});

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  state.requests.push({ path: url.pathname, method, body, query: url.searchParams });
  if (url.origin === "https://api.resend.com" && url.pathname === "/emails") {
    state.sent++;
    return state.mailFails ? json({ message: "test sender refused" }, 422) : json({ id: "test-message" });
  }
  assert.equal(url.origin, process.env.NEXT_PUBLIC_SUPABASE_URL, "no real network destination is allowed");
  if (url.pathname === "/auth/v1/token") return json(state.rotateRefresh ? { ...session, refresh_token: "rotated-refresh" } : session);
  if (url.pathname === "/auth/v1/user") {
    if (method === "PUT") {
      state.passwordWrites++;
      if (state.samePassword) return json({ code: "same_password", msg: "New password should be different from the old password." }, 422);
      if (state.passwordFails) return json({ code: "weak_password", msg: "Password rejected" }, 422);
    }
    return json(user);
  }
  if (url.pathname === "/auth/v1/admin/users") { state.existingAccount = true; return json({ user }); }
  if (url.pathname === "/auth/v1/invite") { state.existingAccount = true; return json(user); }
  if (url.pathname === "/auth/v1/recover") return json({});
  if (url.pathname === `/auth/v1/admin/users/${USER_ID}` && method === "DELETE") {
    state.deletedUsers++;
    state.seat = null;
    state.setup = null;
    state.entitlement = false;
    return json({ user });
  }
  if (url.pathname === "/auth/v1/admin/generate_link") {
    state.generated++;
    return state.linkFails ? json({ msg: "test link unavailable" }, 500) : json({
      ...user,
      action_link: "https://novus-invite-test.invalid/auth/v1/verify?token=test",
      email_otp: "123456", hashed_token: "test-hash", redirect_to: "https://novus-test.invalid/join/setup", verification_type: "recovery",
    });
  }
  if (url.pathname === "/rest/v1/rpc/claim_auth_attempt") return json(!state.mailThrottled);
  if (url.pathname === "/rest/v1/chapters") return json([{
    id: CHAPTER_ID, owner_profile_id: USER_ID, licence: "chapter_35", seats: 35,
    status: "active", source: "comp", current_period_end: null, created_at: "2026-01-01T00:00:00Z",
    name: state.incompleteProfile ? null : "Test School", organization_type: "school",
    contact_name: "Teacher", contact_email: "teacher@novus-test.invalid",
  }]);
  if (url.pathname === "/rest/v1/rpc/auth_user_id_for_email") return json(state.existingAccount ? USER_ID : null);
  if (url.pathname === "/rest/v1/rpc/grant_chapter_seat") {
    state.grants++;
    // A concurrent upgrade has already granted the newer tier. The stale
    // request's refusal must unwind that entitlement with the seat itself.
    state.entitlement = true;
    return state.grantFails ? json({ message: "stale chapter licence", code: "XX000" }, 400) : json(null);
  }
  if (url.pathname === "/rest/v1/rpc/remove_chapter_seat") {
    assert.deepEqual(body, { p_chapter: CHAPTER_ID, p_profile: USER_ID });
    if (state.removalFails) return json({ message: "test removal failed", code: "XX000" }, 500);
    if (state.removedBeforeRpc) { state.seat = null; return json(false); }
    const removed = state.seat !== null;
    state.seat = null;
    state.entitlement = false;
    return json(removed);
  }
  if (url.pathname === "/rest/v1/profiles") {
    if (method === "GET") return json([{ display_name: state.profileName }]);
    state.profileWrites++;
    if (body?.display_name) state.profileName = body.display_name;
    return json(null);
  }
  if (url.pathname === "/rest/v1/chapter_account_setup") {
    if (method === "GET") return state.setupReadFails ? json({ message: "setup unavailable" }, 500) : json(state.setup ? [state.setup] : []);
    if (state.setupWriteFails) return json({ message: "setup write failed" }, 500);
    if (method === "POST") state.setup = { profile_id: body.profile_id, completed_at: null };
    if (method === "PATCH" && state.setup) Object.assign(state.setup, body);
    return json(null);
  }
  if (url.pathname === "/rest/v1/chapter_seats") {
    if (method === "GET") {
      if (state.lookupFails) return json({ message: "test lookup failed", code: "XX000" }, 500);
      return json(matchesSeat(url.searchParams) ? [state.seat] : []);
    }
    if (method === "POST") { state.seat = { ...pendingSeat(), invite_token: null, ...body }; return json(null, 201); }
    if (method === "PATCH") {
      if (body.claimed_at && state.completionFails) return json({ message: "test completion failed", code: "XX000" }, 500);
      if (matchesSeat(url.searchParams)) Object.assign(state.seat, body);
      return json(null);
    }
  }
  throw new Error(`Unhandled test request ${method} ${url.pathname}`);
};

const { NextRequest } = await import("next/server");
const { POST: invite } = await import("../app/api/chapter/invites/route.ts");
const { POST: claim } = await import("../app/api/chapter/claim/route.ts");
const { POST: confirm } = await import("../app/api/auth/reset/confirm/route.ts");
const { POST: registerSeats, DELETE: removeSeat } = await import("../app/api/chapter/members/route.ts");
const request = (path, body, cookie = false) => new NextRequest(`https://novus-test.invalid${path}`, {
  method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie: "novus_sb=test-refresh" } : {}) }, body: JSON.stringify(body),
});
const inviteRequest = () => request("/api/chapter/invites", { invites: [{ email: EMAIL, name: "Student" }] }, true);
const claimRequest = () => request("/api/chapter/claim", { token: TOKEN, email: EMAIL, name: "Student" });
const confirmRequest = (name, tokens = { access: jwt, refresh: "test-refresh" }) => request("/api/auth/reset/confirm", {
  accessToken: tokens.access, refreshToken: tokens.refresh, password: "classroom-safe-password", ...(name ? { displayName: name } : {}),
});
const removeRequest = () => new NextRequest("https://novus-test.invalid/api/chapter/members", {
  method: "DELETE", headers: { "content-type": "application/json", cookie: "novus_sb=test-refresh" },
  body: JSON.stringify({ email: EMAIL }),
});
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`  ✓ ${name}`); };

if (fallback) {
  await check("Supabase fallback creates pending setup and delivers fresh invitation to setup", async () => {
    reset();
    assert.equal((await (await invite(inviteRequest())).json()).results[0].action, "invited");
    assert.equal(state.setup.completed_at, null);
    assert.equal(state.seat.claimed_at, null);
    assert.equal(state.requests.find(r => r.path === "/auth/v1/invite").query.get("redirect_to"), "https://novus-test.invalid/join/setup");
  });
  await check("Supabase fallback restores removed unfinished accounts through mailbox recovery", async () => {
    await removeSeat(removeRequest());
    assert.equal((await (await invite(inviteRequest())).json()).results[0].action, "invited");
    assert.equal(state.requests.find(r => r.path === "/auth/v1/recover").query.get("redirect_to"), "https://novus-test.invalid/join/setup");
    assert.equal(state.seat.claimed_at, null);
    assert.equal((await confirm(confirmRequest("Fallback Student"))).status, 200);
    assert.ok(state.setup.completed_at);
    assert.ok(state.seat.claimed_at);
  });
  process.exit(0);
}

await check("failed mail keeps the seat but never records a send", async () => {
  reset({ mailFails: true });
  const result = await (await invite(inviteRequest())).json();
  assert.equal(result.results[0].ok, true);
  assert.match(result.results[0].warning, /email failed/);
  assert.equal(state.seat.invite_sent_at, null);
  assert.equal(state.seat.claimed_at, null);
  assert.equal(state.grants, 1);
});
await check("successful mail alone stamps sent time", async () => {
  reset();
  const result = await (await invite(inviteRequest())).json();
  assert.equal(result.results[0].action, "invited");
  assert.ok(state.seat.invite_sent_at);
  assert.equal(state.seat.claimed_at, null);
  assert.equal(state.sent, 1);
});
await check("existing accounts receive a seat without an unsolicited email", async () => {
  reset({ existingAccount: true });
  const result = await (await invite(inviteRequest())).json();
  assert.equal(result.results[0].action, "granted");
  assert.equal(state.sent, 0);
  assert.equal(state.seat.created_by_invite, false);
});
await check("stale-licence grant failures atomically remove webhook-granted access on all admission paths", async () => {
  for (const path of ["existing invite", "new invite", "register"]) {
    reset({ grantFails: true, existingAccount: path === "existing invite" });
    const response = path === "register"
      ? await registerSeats(request("/api/chapter/members", { rows: [{ email: EMAIL, password: "classroom-safe-password" }] }, true))
      : await invite(inviteRequest());
    const result = await response.json();
    assert.equal(result.results[0].ok, false);
    assert.match(result.results[0].error, /stale chapter licence/);
    assert.equal(state.seat, null, path);
    assert.equal(state.entitlement, false, path);
    assert.equal(state.deletedUsers, path === "existing invite" ? 0 : 1, path);
    assert.equal(state.requests.filter((r) => r.path.endsWith("/remove_chapter_seat")).length, 1, path);
    assert.equal(state.requests.some((r) => r.path === "/rest/v1/chapter_seats" && r.method === "DELETE"), false);
  }
});
await check("an incomplete enterprise cannot invite or import accounts", async () => {
  reset({ incompleteProfile: true });
  assert.equal((await invite(inviteRequest())).status, 409);
  assert.equal((await registerSeats(request("/api/chapter/members", { rows: [{ email: EMAIL, password: "classroom-safe-password" }] }, true))).status, 409);
  assert.equal(state.seat, null);
  assert.equal(state.sent, 0);
});
await check("opening an invitation does not claim it before password setup", async () => {
  reset({ seat: pendingSeat() });
  const result = await (await claim(claimRequest())).json();
  assert.equal(result.ok, true);
  assert.equal(state.seat.claimed_at, null);
  assert.equal(state.seat.invite_token, TOKEN);
});
await check("a failed handover remains retryable through its original invitation", async () => {
  reset({ seat: pendingSeat(), linkFails: true });
  assert.equal((await claim(claimRequest())).status, 503);
  assert.equal(state.seat.claimed_at, null);
  state.linkFails = false;
  assert.equal((await claim(claimRequest())).status, 200);
});
await check("a completed account cannot be reopened even one second after claim", async () => {
  reset({ seat: { ...pendingSeat(), claimed_at: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await claim(claimRequest())).status, 403);
  assert.equal(state.generated, 0);
  assert.equal(state.profileWrites, 0);
});
await check("a rejected password never claims or invalidates a pending invite", async () => {
  reset({ seat: pendingSeat(), passwordFails: true });
  assert.equal((await confirm(confirmRequest())).status, 400);
  assert.equal(state.seat.claimed_at, null);
  assert.equal(state.seat.invite_token, TOKEN);
});
await check("Resend setup retires the invite only after saving the password", async () => {
  reset({ seat: pendingSeat() });
  const response = await confirm(confirmRequest());
  assert.equal((await response.json()).ok, true);
  assert.ok(state.seat.claimed_at);
  assert.equal(state.seat.invite_token, null);
  assert.match(response.headers.get("set-cookie"), /novus_sb=/);
  const changes = state.requests.filter((r) => r.method === "PUT" || r.method === "PATCH");
  assert.equal(changes[0].path, "/auth/v1/user");
});
await check("Supabase's direct invite also records completed setup and its name", async () => {
  reset({ seat: pendingSeat() });
  assert.equal((await confirm(confirmRequest("Direct Invite"))).status, 200);
  assert.ok(state.seat.claimed_at);
  assert.equal(state.seat.invite_token, null);
  assert.equal(state.seat.seat_name, "Direct Invite");
});
await check("a saved password plus failed seat write can finish by retrying the same password", async () => {
  reset({ seat: pendingSeat(), completionFails: true });
  const first = await confirm(confirmRequest());
  assert.equal(first.status, 503);
  const failed = await first.json();
  assert.match(failed.error, /password was saved/);
  assert.equal(first.headers.get("set-cookie"), null);
  state.completionFails = false;
  state.samePassword = true;
  assert.equal((await confirm(confirmRequest(undefined, failed.retryTokens))).status, 200);
  assert.ok(state.seat.claimed_at);
  assert.equal(state.seat.invite_token, null);
});
await check("ordinary password resets retain their same-password rejection", async () => {
  reset({ samePassword: true });
  assert.equal((await confirm(confirmRequest())).status, 400);
});
await check("no failed setup changes the previous browser identity", async () => {
  for (const fault of ["lookupFails", "passwordFails", "completionFails"]) {
    reset({ seat: pendingSeat(), [fault]: true });
    const response = await confirm(confirmRequest());
    assert.ok(response.status >= 400, fault);
    assert.equal(response.headers.get("set-cookie"), null, fault);
    assert.equal(response.headers.get("cache-control"), "no-store", fault);
    assert.deepEqual((await response.json()).retryTokens, { access: jwt, refresh: "test-refresh" });
  }
});
await check("an expired link session can rotate tokens on failure and then finish without swapping the browser account early", async () => {
  reset({ seat: pendingSeat(), completionFails: true, rotateRefresh: true });
  const first = await confirm(confirmRequest(undefined, {
    access: makeJwt(Math.floor(Date.now() / 1000) - 100), refresh: "test-refresh",
  }));
  assert.equal(first.status, 503);
  assert.equal(first.headers.get("set-cookie"), null);
  const failed = await first.json();
  assert.equal(failed.retryTokens.refresh, "rotated-refresh");
  state.completionFails = false;
  state.samePassword = true;
  const second = await confirm(confirmRequest(undefined, failed.retryTokens));
  assert.equal(second.status, 200);
  assert.match(second.headers.get("set-cookie"), /novus_sb=rotated-refresh/);
  assert.equal(state.seat.invite_token, null);
});
await check("member removal uses one scoped atomic RPC and preserves the session", async () => {
  reset({ seat: pendingSeat(), incompleteProfile: true });
  const response = await removeSeat(removeRequest());
  assert.deepEqual(await response.json(), { ok: true, email: EMAIL, removed: true });
  assert.match(response.headers.get("set-cookie"), /novus_sb=/);
  assert.equal(state.seat, null);
  assert.equal(state.requests.filter((r) => r.path.endsWith("/remove_chapter_seat")).length, 1);
  assert.equal(state.requests.some((r) => r.method === "DELETE" || r.path.endsWith("/revoke_chapter_seat")), false);
});
await check("repeated or concurrently completed removals succeed as no-ops", async () => {
  reset();
  const absent = await removeSeat(removeRequest());
  assert.deepEqual(await absent.json(), { ok: true, email: EMAIL, removed: false });
  assert.match(absent.headers.get("set-cookie"), /novus_sb=/);
  assert.equal(state.requests.some((r) => r.path.endsWith("/remove_chapter_seat")), false);
  reset({ seat: pendingSeat(), removedBeforeRpc: true });
  assert.deepEqual(await (await removeSeat(removeRequest())).json(), { ok: true, email: EMAIL, removed: false });
});
await check("failed atomic removal reports the error without changing the roster", async () => {
  reset({ seat: pendingSeat(), removalFails: true });
  const response = await removeSeat(removeRequest());
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /remove: test removal failed/);
  assert.match(response.headers.get("set-cookie"), /novus_sb=/);
  assert.ok(state.seat);
});

await check("fresh invitations send setup directly to the mailbox without a reusable token", async () => {
  reset();
  await invite(inviteRequest());
  assert.equal(state.seat.invite_token, null);
  assert.equal(state.setup.completed_at, null);
  const link = state.requests.find(r => r.path.endsWith("/generate_link"));
  assert.equal(link.query.get("redirect_to"), "https://novus-test.invalid/join/setup");
  const mail = state.requests.find(r => r.path === "/emails");
  assert.deepEqual(mail.body.to, [EMAIL]);
  assert.match(mail.body.text, /verify\?token=test/);
});
await check("removing and re-inviting an unfinished account sends setup and stays pending", async () => {
  reset();
  await invite(inviteRequest());
  await removeSeat(removeRequest());
  assert.ok(state.setup);
  const before = state.sent;
  const result = await (await invite(inviteRequest())).json();
  assert.equal(result.results[0].action, "invited");
  assert.equal(state.sent, before + 1);
  assert.equal(state.passwordWrites, 0);
  assert.equal(state.seat.created_by_invite, true);
  assert.equal(state.seat.claimed_at, null);
});
await check("completed setup survives removal without another setup email", async () => {
  reset();
  await invite(inviteRequest());
  await confirm(confirmRequest());
  assert.ok(state.setup.completed_at);
  await removeSeat(removeRequest());
  const before = state.sent;
  const result = await (await invite(inviteRequest())).json();
  assert.equal(result.results[0].action, "granted");
  assert.equal(state.sent, before);
});
await check("setup completion works after the pending seat has been removed", async () => {
  reset({ setup: { completed_at: null } });
  assert.equal((await confirm(confirmRequest())).status, 200);
  assert.ok(state.setup.completed_at);
});
await check("a failed account-setup write retries even after the seat was claimed", async () => {
  reset({ seat: pendingSeat(), setup: { completed_at: null }, setupWriteFails: true });
  assert.equal((await confirm(confirmRequest())).status, 503);
  assert.ok(state.seat.claimed_at);
  state.setupWriteFails = false;
  state.samePassword = true;
  assert.equal((await confirm(confirmRequest())).status, 200);
  assert.ok(state.setup.completed_at);
});
await check("unknown account setup fails closed before granting or changing passwords", async () => {
  reset({ existingAccount: true, setupReadFails: true });
  assert.equal((await (await invite(inviteRequest())).json()).results[0].ok, false);
  assert.equal(state.grants, 0);
  assert.equal((await confirm(confirmRequest())).status, 503);
  assert.equal(state.passwordWrites, 0);
});
await check("a failed re-invitation mail retains honest pending status for resend", async () => {
  reset({ existingAccount: true, setup: { completed_at: null }, mailFails: true });
  const result = await (await invite(inviteRequest())).json();
  assert.match(result.results[0].warning, /email failed/);
  assert.equal(state.seat.claimed_at, null);
  assert.equal(state.seat.invite_sent_at, null);
  state.mailFails = false;
  assert.equal((await (await invite(inviteRequest())).json()).results[0].action, "resent");
  assert.ok(state.seat.invite_sent_at);
});
await check("a concurrent legacy claim never returns credentials or overwrites a completed name", async () => {
  reset({ seat: pendingSeat(), setup: { completed_at: null } });
  const baseFetch = globalThis.fetch;
  let release, arrived;
  const reached = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url ?? String(input));
    if (url.pathname.endsWith("/generate_link")) { arrived(); await gate; }
    return baseFetch(input, init);
  };
  try {
    const pending = claim(claimRequest());
    await reached;
    assert.equal((await confirm(confirmRequest("Account Owner"))).status, 200);
    release();
    const response = await pending;
    assert.deepEqual(await response.json(), { ok: true, sent: true });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(state.profileName, "Account Owner");
    const mail = state.requests.find(r => r.path === "/emails");
    assert.deepEqual(mail.body.to, [EMAIL]);
    assert.equal(state.seat.invite_token, null);
  } finally { release(); globalThis.fetch = baseFetch; }
});
await check("legacy setup mail failure stays retryable without leaking the recovery link", async () => {
  reset({ seat: pendingSeat(), mailFails: true });
  const response = await claim(claimRequest());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).url, undefined);
  state.mailFails = false;
  assert.deepEqual(await (await claim(claimRequest())).json(), { ok: true, sent: true });
});

await check("legacy setup mail is rate-limited before minting another credential", async () => {
  reset({ seat: pendingSeat(), mailThrottled: true });
  assert.equal((await claim(claimRequest())).status, 429);
  assert.equal(state.generated, 0);
  assert.equal(state.sent, 0);
});
await check("the no-Resend mailer completes both initial and restored invitation setup", async () => {
  execFileSync(process.execPath, [new URL(import.meta.url).pathname, "--fallback"], { stdio: "inherit" });
});

const storage = new Map();
globalThis.sessionStorage = {
  setItem(key, value) { storage.set(key, value); },
  getItem(key) { return storage.get(key) ?? null; },
  removeItem(key) { storage.delete(key); },
};
const { rememberInviteSetup, readInviteSetup, forgetInviteSetup, replaceInviteSetup } = await import("../lib/auth/invite-setup.ts");
await check("refresh recovery is tab-scoped, bounded, and never extends its deadline", async () => {
  const realNow = Date.now;
  try {
    let now = realNow();
    Date.now = () => now;
    rememberInviteSetup({ access: "access", refresh: "refresh" });
    assert.deepEqual(readInviteSetup(), { access: "access", refresh: "refresh" });
    now += 14 * 60 * 1000;
    assert.ok(readInviteSetup());
    replaceInviteSetup({ access: "rotated-access", refresh: "rotated-refresh" });
    assert.deepEqual(readInviteSetup(), { access: "rotated-access", refresh: "rotated-refresh" });
    now += 60 * 1000;
    assert.equal(readInviteSetup(), null);
    assert.equal(storage.size, 0);
    rememberInviteSetup({ access: "another-access", refresh: "another-refresh" });
    forgetInviteSetup();
    assert.equal(readInviteSetup(), null);
  } finally { Date.now = realNow; }
});
await check("corrupt or blocked tab storage cannot crash invitation setup", async () => {
  storage.set("novus:invite:setup:v1", "{bad json");
  assert.equal(readInviteSetup(), null);
  globalThis.sessionStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  rememberInviteSetup({ access: "access", refresh: "refresh" });
  assert.equal(readInviteSetup(), null);
  forgetInviteSetup();
});
console.log(`\nPASS — ${checks} invitation checks; no external requests sent.`);
