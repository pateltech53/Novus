#!/usr/bin/env node
/**
 * The app front door resolves live ownership, not a saved role. Exercise the
 * real GET and cold-start document with isolated database/storage boundaries:
 * no live account is used, and no role or billing setting is written.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
const read = (file) => readFileSync(new URL(file, root), 'utf8');
function load(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console, ...globals, require(id) {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  } }, { filename: fileURLToPath(new URL(file, root)) });
  return exports;
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log(`  ✓ ${name}`); }
const plain = (value) => JSON.parse(JSON.stringify(value));
let state;
function reset() {
  state = { configured: true, signedIn: true, anonymous: false, key: 'fixture',
    profile: { role: 'player', display_name: 'Founder' }, chapters: [],
    profileError: null, chapterError: null, reads: 0, queries: [] };
}
const session = { userId: 'own-account', get anonymous() { return state.anonymous; },
  supabase: { from(table) {
    const calls = [table]; state.queries.push(calls);
    const result = () => table === 'profiles'
      ? { data: state.profile, error: state.profileError }
      : { data: state.chapters, error: state.chapterError };
    const query = { then: (yes, no) => Promise.resolve(result()).then(yes, no),
      maybeSingle: async () => result() };
    for (const method of ['select', 'eq', 'is', 'order']) query[method] = (...args) => {
      calls.push([method, ...args]); return query;
    };
    return query;
  } } };
const route = load('app/api/home/route.ts', {
  'next/server': { NextResponse: { json: (body, options) => ({ body, ...options }) } },
  '@/lib/supabase/config': { configured: () => state.configured },
  '@/lib/supabase/route': {
    sessionFromRequest: async () => { state.reads++; return state.signedIn ? session : null; },
    withSession: (response, current) => ({ ...response, refreshed: current === session }),
  },
  '@/lib/stripe/config': { get SUPABASE_SERVICE_ROLE_KEY() { return state.key; } },
});
await check('signed-out and anonymous accounts cannot discover a console', async () => {
  for (const kind of ['signedOut', 'anonymous']) {
    reset(); if (kind === 'anonymous') state.anonymous = true; else state.signedIn = false;
    const r = await route.GET({});
    assert.deepEqual(plain(r.body), { configured: true, signedIn: false, admin: false, chapter: null });
    assert.equal(state.queries.length, 0);
    assert.equal(r.refreshed, kind === 'anonymous');
  }
});
await check('unconfigured builds retain local play without reading a session', async () => {
  reset(); state.configured = false;
  assert.equal((await route.GET({})).body.configured, false);
  assert.equal(state.reads, 0);
});
await check('ordinary members get no administrative entry and only own-account reads', async () => {
  reset(); const r = await route.GET({});
  assert.equal(r.body.admin, false); assert.equal(r.body.chapter, null);
  assert.equal(state.reads, 1); assert.equal(r.refreshed, true);
  assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.deepEqual(plain(state.queries), [
    ['profiles', ['select', 'role, display_name'], ['eq', 'id', 'own-account']],
    ['chapters', ['select', 'name, status'],
      ['is', 'deleted_at', null], ['order', 'created_at', { ascending: false }]],
  ]);
});
await check('platform admins and owners retain their respective console choices', async () => {
  reset(); state.profile.role = 'admin';
  assert.equal((await route.GET({})).body.admin, true);
  state.chapters = [{ name: 'Enterprise', status: 'active' }];
  let r = await route.GET({}); assert.equal(r.body.admin, true); assert.equal(r.body.chapter.name, 'Enterprise');
  state.profile.role = 'player';
  r = await route.GET({}); assert.equal(r.body.admin, false); assert.equal(r.body.chapter.name, 'Enterprise');
});
await check('active ownership wins over newer lapsed records; lapsed-only still has management', async () => {
  reset(); state.chapters = [{ name: 'Old', status: 'lapsed' }, { name: 'Current', status: 'active' }];
  assert.equal((await route.GET({})).body.chapter.name, 'Current');
  state.chapters.pop(); assert.equal((await route.GET({})).body.chapter.status, 'lapsed');
});
await check('revoked privileges and deleted ownership disappear on the next read', async () => {
  reset(); state.profile.role = 'admin'; state.chapters = [{ name: 'School', status: 'active' }];
  await route.GET({}); state.profile.role = 'player'; state.chapters = [];
  const r = await route.GET({}); assert.equal(r.body.admin, false); assert.equal(r.body.chapter, null);
});
await check('missing operator configuration does not advertise a working operator console', async () => {
  reset(); state.profile.role = 'admin'; state.key = '';
  assert.equal((await route.GET({})).body.admin, false);
});
await check('database failures are retryable and preserve the rotated session', async () => {
  for (const field of ['profileError', 'chapterError']) {
    reset(); state[field] = { message: 'private database detail' };
    const r = await route.GET({}); assert.equal(r.status, 503); assert.equal(r.refreshed, true);
    assert.equal(r.headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(r.body).includes('private database detail'));
    assert.equal(r.body.admin, undefined);
  }
});
let native = false; let fetchOptions;
const entry = load('lib/entry.ts', {
  '@/lib/native/platform': { isNative: () => native },
  '@/lib/engine/save': { hasAnySavedRun: () => true, loadProfile: () => null },
});
const home = load('lib/home.ts', {
  '@/lib/native/origin': { API_CREDENTIALS: 'include', apiUrl: (path) => path },
}, { fetch: async (path, options) => { fetchOptions = { path, ...options };
  return { ok: true, json: async () => ({ signedIn: true }) }; } });
await check('native account entry resolves workspaces while web game entry stays intact', () => {
  assert.equal(entry.accountEntryRoute(), '/islands');
  native = true; assert.equal(entry.accountEntryRoute(), '/home');
});
await check('client reads include credentials, abort signal and bypass cached role data', async () => {
  const signal = new AbortController().signal;
  await home.readHomeAccess(signal);
  assert.deepEqual(fetchOptions, { path: '/api/home', credentials: 'include', cache: 'no-store', signal });
});
const script = read('public/boot.html').match(/<script>([\s\S]*?)<\/script>/)[1];
function boot(values = {}, denied = false) {
  let target;
  vm.runInNewContext(script, {
    localStorage: { getItem(key) { if (denied) throw Error('denied'); return values[key] ?? null; } },
    document: { documentElement: { setAttribute() {} } },
    location: { replace(path) { target = path; } },
  }); return target;
}
await check('cold starts resolve account roles even before a first island is created', () => {
  const account = { 'novus:account:v1': JSON.stringify({ displayName: 'Owner' }) };
  assert.equal(boot(account), '/home');
  assert.equal(boot({ ...account, 'novus:run:v1:49': '{}' }), '/home');
  assert.equal(boot({ ...account, 'novus:profile:v1': 'damaged' }), '/home');
});
await check('new, legacy, corrupt-account and storage-denied devices retain a usable entry', () => {
  assert.equal(boot(), '/welcome'); assert.equal(boot({}, true), '/welcome');
  assert.equal(boot({ 'novus:run:v1:49': '{}' }), '/');
  assert.equal(boot({ 'novus:run:v1': '{}', 'novus:account:v1': 'damaged' }), '/');
  assert.equal(boot({ 'novus:profile:v1': '{"onboarded":true}' }), '/');
});
console.log(`\n${passed} workspace entry contracts passed.`);
