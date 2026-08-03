/**
 * Does the AI tier actually work?
 *
 *   node scripts/ai-test.mjs          — contract tests, no network, no keys
 *   node scripts/ai-test.mjs --live   — calls the real providers with your keys
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * The failure this file is here to catch already happened once, and it was
 * invisible: three API keys were added to a deploy and nothing changed, because
 * no code read those names and every AI feature degrades SILENTLY by design —
 * the browser voice, the browser transcriber and the offline resolver are all
 * complete, so "not configured" and "configured wrong" look identical from the
 * outside. A feature that cannot fail loudly needs somewhere that can.
 *
 * The default run stubs `fetch` and drives the three route handlers through
 * their whole contract, so it needs no keys, spends no money and is safe in CI.
 * `--live` is the one that answers "are MY keys good", and it is the check to
 * run after setting them.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const live = process.argv.includes("--live");
/** Set by the child process this script spawns of itself. See the end of the
 *  contract tests for why that is a process and not another import. */
const unconfigured = process.env.NOVUS_AI_TEST_UNCONFIGURED === "1";

// ── .env.local, because a plain node script gets none of Next's loading ──────
// Skipped in the unconfigured child, whose entire purpose is to have no keys —
// reading them back off disk would defeat it.
if (!unconfigured) {
  loadEnv(join(root, ".env.local"));
  loadEnv(join(root, ".env"));
}

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (value && process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

let failures = 0;
let passes = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passes += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ═══ live ══════════════════════════════════════════════════════════════════
// Calls each provider directly, with the smallest request that proves the key
// is real. Deliberately does NOT go through the route handlers: the question
// here is "is this key good", and a route in the way only adds ways to be
// confused about the answer.

if (live) {
  console.log("\nLive check — calling the real providers with your keys.\n");

  const eleven = process.env.ELEVENLABS_API_KEY;
  console.log("ElevenLabs (shark and narrator voices)");
  if (!eleven) {
    console.log("  · ELEVENLABS_API_KEY not set — the panel uses the browser voice.");
  } else {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": eleven },
      });
      const body = res.ok ? await res.json() : null;
      const count = body?.voices?.length ?? 0;
      check("key accepted", res.ok, `HTTP ${res.status}`);
      check(`${count} voice(s) on the account`, count > 0, "an account with no voices cannot speak");
    } catch (err) {
      check("reachable", false, String(err.message ?? err));
    }
  }

  const deepgram = process.env.DEEPGRAM_API_KEY;
  console.log("\nDeepgram (pitch transcription)");
  if (!deepgram) {
    console.log("  · DEEPGRAM_API_KEY not set — the browser transcribes, or the player types.");
  } else {
    try {
      // One second of silence, as a real WAV. Deepgram returns an empty
      // transcript for it, which is a success: the key was accepted.
      const res = await fetch("https://api.deepgram.com/v1/listen?model=" +
        encodeURIComponent(process.env.DEEPGRAM_MODEL || "nova-3"), {
        method: "POST",
        headers: { Authorization: `Token ${deepgram}`, "content-type": "audio/wav" },
        body: silentWav(),
      });
      check("key accepted", res.ok, `HTTP ${res.status}${res.ok ? "" : " — " + (await res.text()).slice(0, 160)}`);
    } catch (err) {
      check("reachable", false, String(err.message ?? err));
    }
  }

  const openrouter = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-haiku-4.5";
  console.log(`\nOpenRouter (cold-call verdicts · ${model})`);
  if (!openrouter) {
    console.log("  · OPENROUTER_API_KEY not set — the offline resolver judges every call.");
  } else {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${openrouter}`,
          "content-type": "application/json",
          "x-title": "Novus",
        },
        body: JSON.stringify({
          model,
          max_tokens: 20,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
        }),
      });
      const body = res.ok ? await res.json() : await res.text();
      check("key accepted", res.ok, res.ok ? "" : `HTTP ${res.status} — ${String(body).slice(0, 200)}`);
      if (res.ok) {
        const said = body?.choices?.[0]?.message?.content ?? "";
        check(`model "${model}" answered`, said.trim().length > 0, "empty completion — check the model id");
      }
    } catch (err) {
      check("reachable", false, String(err.message ?? err));
    }
  }

  console.log(`\n${failures === 0 ? "All configured providers answered." : `${failures} problem(s) above.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

// ═══ contract tests ════════════════════════════════════════════════════════
// Every key is set to a dummy so the routes take their configured path, and
// `fetch` is replaced so nothing leaves the machine.

if (!unconfigured) {
  process.env.ELEVENLABS_API_KEY = "test-eleven";
  process.env.DEEPGRAM_API_KEY = "test-deepgram";
  process.env.OPENROUTER_API_KEY = "test-openrouter";
}
// Not set, so `throttle` fails open and no Supabase call is attempted.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

register("./ts-loader.mjs", import.meta.url);
register("./route-loader.mjs", import.meta.url);

const { NextRequest } = await import("next/server.js");
const tts = await import(pathToFileURL(join(root, "app/api/tts/route.ts")).href);
const stt = await import(pathToFileURL(join(root, "app/api/stt/route.ts")).href);
const pitch = await import(pathToFileURL(join(root, "app/api/pitch/route.ts")).href);

const realFetch = globalThis.fetch;
let lastRequest = null;
let handler = () => new Response("unstubbed", { status: 500 });
globalThis.fetch = async (url, init) => {
  lastRequest = { url: String(url), init };
  return handler(String(url), init);
};

const json = (url, body) =>
  new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// ── the fresh-deploy path, run in a child process with no keys ──────────────
// Every route answers 501 before it reads the body, so the request shape does
// not matter here — only that nothing reaches a provider.
if (unconfigured) {
  handler = () => new Response("a provider was called with no key", { status: 500 });

  const a = await tts.POST(json("http://localhost/api/tts", { text: "hi", speaker: "chair" }));
  const b = await stt.POST(json("http://localhost/api/stt", {}));
  const c = await pitch.POST(json("http://localhost/api/pitch", {}));

  check("/api/tts answers 501, not 500 — nothing is broken, it is off", a.status === 501, `HTTP ${a.status}`);
  check("/api/stt answers 501", b.status === 501, `HTTP ${b.status}`);
  check("/api/pitch answers 501", c.status === 501, `HTTP ${c.status}`);
  check("says so in a body the client can read", (await a.json()).configured === false);
  check("contacts no provider at all", lastRequest === null);

  // The probe must say no here, because it is the only thing standing between
  // an unconfigured deploy and a recording of a child's voice being uploaded.
  const probe = await stt.GET();
  check("the pre-upload probe reports not configured", (await probe.json()).configured === false);

  globalThis.fetch = realFetch;
  console.log(`RESULT ${passes} ${failures}`);
  process.exit(0);
}

console.log("\nContract tests — no network, no keys spent.\n");

// ── /api/tts ────────────────────────────────────────────────────────────────
console.log("/api/tts  ·  what lib/ai/speech.ts expects back");

handler = (url) =>
  url.includes("/v1/voices")
    ? Response.json({ voices: [{ voice_id: "v-b" }, { voice_id: "v-a" }] })
    : new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });

{
  const res = await tts.POST(json("http://localhost/api/tts", { text: "The numbers hold.", speaker: "marcus" }));
  const bytes = new Uint8Array(await res.arrayBuffer());
  check("speaks a line", res.status === 200, `HTTP ${res.status}`);
  check("returns audio/mpeg, which is what the client wraps in an <Audio>", res.headers.get("content-type") === "audio/mpeg");
  check("passes the audio through unaltered", bytes.length === 4 && bytes[0] === 0x49);
  check("picks a voice with no casting configured", lastRequest.url.includes("/v1/text-to-speech/v-"));
}

{
  // Casting is per character: two sharks must not land on the same voice.
  const seen = new Set();
  for (const speaker of ["marcus", "serena"]) {
    await tts.POST(json("http://localhost/api/tts", { text: "x", speaker }));
    seen.add(lastRequest.url);
  }
  check("gives two sharks two different voices", seen.size === 2);
}

{
  const res = await tts.POST(json("http://localhost/api/tts", { text: "", speaker: "chair" }));
  check("refuses an empty line", res.status === 400, `HTTP ${res.status}`);
}

{
  const res = await tts.POST(json("http://localhost/api/tts", { text: "x".repeat(900), speaker: "chair" }));
  check("refuses an oversized line", res.status === 413, `HTTP ${res.status}`);
}

{
  handler = () => new Response("nope", { status: 401 });
  const res = await tts.POST(json("http://localhost/api/tts", { text: "hi", speaker: "chair" }));
  check("passes a bad key through as 401, which latches the client to the local voice", res.status === 401, `HTTP ${res.status}`);
}

{
  // The same wrong key, but before any voice has been cached — so the failure
  // happens at the voice LIST rather than at synthesis. This used to answer
  // 502, which the client reads as transient and retries once per spoken line.
  const fresh = await import(pathToFileURL(join(root, "app/api/tts/route.ts")).href + `?cold=${Date.now()}`);
  handler = () => new Response("unauthorised", { status: 401 });
  const res = await fresh.POST(json("http://localhost/api/tts", { text: "hi", speaker: "chair" }));
  check("reports a wrong key as 401 even before a voice is cached", res.status === 401, `HTTP ${res.status}`);
}

{
  // A real key on an account with no voices is a configuration to fix, not a
  // transport error — and it must not be reported as a bad key.
  const fresh = await import(pathToFileURL(join(root, "app/api/tts/route.ts")).href + `?empty=${Date.now()}`);
  handler = () => Response.json({ voices: [] });
  const res = await fresh.POST(json("http://localhost/api/tts", { text: "hi", speaker: "chair" }));
  check("reports an account with no voices as 502, not 401", res.status === 502, `HTTP ${res.status}`);
}

// ── /api/stt ────────────────────────────────────────────────────────────────
console.log("\n/api/stt  ·  what lib/ai/transcribe.ts expects back");

handler = () =>
  Response.json({
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: "Um, we make eleven points of gross margin.",
              words: [
                { word: "um", punctuated_word: "Um,", start: 0.1, end: 0.34 },
                { word: "we", punctuated_word: "we", start: 0.4, end: 0.55 },
                { word: "make", punctuated_word: "make", start: 0.56, end: 0.81 },
              ],
            },
          ],
        },
      ],
    },
  });

const audioForm = () => {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(64)], { type: "audio/webm" }), "pitch.webm");
  form.append("durationSeconds", "92");
  return new NextRequest("http://localhost/api/stt", { method: "POST", body: form });
};

{
  const res = await stt.POST(audioForm());
  const body = await res.json();
  check("transcribes a recording", res.status === 200, `HTTP ${res.status}`);
  check("returns the text field the client reads", body.text.startsWith("Um, we make"));
  check("returns word timings in {w,start,end} form", body.words[1].w === "we" && body.words[1].start === 0.4);
  check("flags fillers for the coach's reported figure", body.words[0].filler === true && body.words[1].filler === false);
  check("keeps punctuation in the displayed word", body.words[0].w === "Um,");
  check("forwards the audio to Deepgram, not a file path", lastRequest.url.startsWith("https://api.deepgram.com/v1/listen"));
  check("asks for filler words, which the coach needs", lastRequest.url.includes("filler_words=true"));
}

{
  handler = () => Response.json({ results: { channels: [{ alternatives: [{ transcript: "  " }] }] } });
  const res = await stt.POST(audioForm());
  const body = await res.json();
  check("treats silence as an empty transcript, not an error", res.status === 200 && body.text === "");
}

{
  const form = new FormData();
  form.append("durationSeconds", "10");
  const res = await stt.POST(new NextRequest("http://localhost/api/stt", { method: "POST", body: form }));
  check("refuses a request with no audio", res.status === 400, `HTTP ${res.status}`);
}

{
  // The probe the client makes before it packs a recording. Its whole purpose
  // is that an unconfigured deploy never receives a child's voice at all.
  const res = await stt.GET();
  const body = await res.json();
  check("answers the pre-upload probe", res.status === 200 && body.configured === true);
  check("does not let a CDN cache the probe", res.headers.get("cache-control") === "no-store");
}

// ── /api/pitch ──────────────────────────────────────────────────────────────
console.log("\n/api/pitch  ·  what lib/ai/callers.ts expects back");

const call = (overrides = {}) =>
  json("http://localhost/api/pitch", {
    caller: {
      id: "a1",
      name: "Rae Whitcombe",
      title: "Angel",
      temperament: "numbers",
      wants: "Gross margin and burn, in that order.",
      difficulty: 3,
      ...(overrides.caller ?? {}),
    },
    company: { name: "Tally", industry: "software", cash: 40, burnMonthly: 6, grossMarginPt: 62 },
    pitch: { seconds: 88, spoken: true, transcript: "We charge forty a seat and keep sixty-two points." },
    constraints: {
      neverScore: ["accent", "pitch of voice", "energy level", "speech rhythm"],
      scoreOnly: ["substance", "whether the numbers hold up", "answering what the caller asked"],
    },
  });

const modelSays = (payload) => () =>
  Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });

{
  handler = modelSays({ accepted: true, reply: "The margin holds. Send the paperwork." });
  const res = await pitch.POST(call());
  const body = await res.json();
  check("returns a verdict", res.status === 200, `HTTP ${res.status}`);
  check("carries the model's decision", body.accepted === true);
  check("carries the caller's words", body.reply.startsWith("The margin holds"));
  check("pays the difficulty-3 cheque from the table (7)", body.cashS === 7, `got ${body.cashS}`);
  check("takes the difficulty-3 dilution from the table (7%)", body.dilutionPct === 7, `got ${body.dilutionPct}`);
  check("awards respect equal to difficulty", body.respect === 3, `got ${body.respect}`);
  check("counts one investor sentiment point", body.invsent === 1);
}

{
  // The guard that keeps the balance curve honest: the harness never calls this
  // route, so a number the model invented would be a shift nothing can measure.
  handler = modelSays({ accepted: true, reply: "In.", cashS: 9999, dilutionPct: 0, respect: 99, invsent: 50 });
  const body = await (await pitch.POST(call())).json();
  check("ignores a cheque the model tried to write", body.cashS === 7, `got ${body.cashS}`);
  check("ignores dilution the model tried to set", body.dilutionPct === 7, `got ${body.dilutionPct}`);
  check("ignores respect the model tried to award", body.respect === 3, `got ${body.respect}`);
  check("ignores investor sentiment the model tried to award", body.invsent === 1, `got ${body.invsent}`);
}

{
  handler = modelSays({ accepted: false, reply: "The margin doesn't work yet." });
  const body = await (await pitch.POST(call())).json();
  check("a decline pays nothing", body.cashS === 0 && body.dilutionPct === 0);
  check("a decline moves no reputation", body.respect === 0 && body.invsent === 0);
}

{
  for (const [difficulty, cash, dilution] of [[1, 2, 3], [5, 16, 12]]) {
    handler = modelSays({ accepted: true, reply: "In." });
    const body = await (await pitch.POST(call({ caller: { difficulty } }))).json();
    check(
      `difficulty ${difficulty} pays ${cash} for ${dilution}%, same as the offline resolver`,
      body.cashS === cash && body.dilutionPct === dilution,
      `got ${body.cashS}/${body.dilutionPct}`,
    );
  }
}

{
  handler = () => Response.json({ choices: [{ message: { content: "Sure! Here's my answer:" } }] });
  const res = await pitch.POST(call());
  check("rejects prose instead of showing it to the player", res.status === 502, `HTTP ${res.status}`);
}

{
  handler = modelSays({ accepted: true, reply: "In." });
  await pitch.POST(call());
  const sent = JSON.parse(lastRequest.init.body);
  const system = sent.messages[0].content;
  const user = JSON.parse(sent.messages[1].content);
  check("sends the Brand Law 5 prohibition in the prompt text", /[Nn]ever score.*accent|Never score, mention/.test(system) && system.includes("speech rhythm"));
  check("forbids writing the founder's lines in the prompt text", /NEVER write the founder's lines/.test(system));
  check("repeats the prohibition as data the model can read", user.never_judge.includes("speech rhythm"));
  check("asks for a strict JSON schema", sent.response_format?.json_schema?.strict === true);
  check("sends the transcript, which is the whole input", user.their_pitch.words.includes("sixty-two points"));
}

{
  const res = await pitch.POST(json("http://localhost/api/pitch", { caller: {} }));
  check("refuses an incomplete call", res.status === 400, `HTTP ${res.status}`);
}

globalThis.fetch = realFetch;

// ── unconfigured ────────────────────────────────────────────────────────────
// The state every deploy starts in. 501 is what the clients latch on, so
// getting it wrong means a request per line, per pitch, forever.
//
// A CHILD PROCESS, not a second import. Keys are read once, when the module is
// loaded, so re-importing a route inside this process would still see the keys
// set at the top of the file — its `providers` import is already resolved and
// cached. Only a fresh process observes the fresh-deploy path honestly, and a
// test that quietly checks something else is worse than no test.
console.log("\nNo keys set  ·  the state a fresh deploy is in");

{
  const env = { ...process.env };
  for (const key of ["ELEVENLABS_API_KEY", "DEEPGRAM_API_KEY", "OPENROUTER_API_KEY"]) delete env[key];
  env.NOVUS_AI_TEST_UNCONFIGURED = "1";

  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env,
    encoding: "utf8",
    cwd: root,
  });
  process.stdout.write(child.stdout.split("\n").filter((l) => l.startsWith("  ")).join("\n") + "\n");
  const [, childPasses, childFailures] = child.stdout.match(/RESULT (\d+) (\d+)/) ?? [];
  passes += Number(childPasses ?? 0);
  failures += Number(childFailures ?? 0);
  if (childPasses === undefined) {
    failures += 1;
    console.log(`  ✗ the unconfigured check did not run — ${child.stderr.trim().slice(-300)}`);
  }
}

console.log(
  `\n${passes} passed, ${failures} failed.` +
    (failures === 0 ? "  Run with --live to check your own keys.\n" : "\n"),
);
process.exit(failures === 0 ? 0 : 1);

/** A one-second silent 8kHz mono WAV — the smallest thing that is a real
 *  recording rather than bytes an API is entitled to reject. */
function silentWav() {
  const rate = 8000;
  const samples = rate;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}
