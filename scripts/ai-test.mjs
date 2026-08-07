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

/**
 * What ElevenLabs actually objected to.
 *
 * Its errors carry a slug in `detail.status`, and that slug is the difference
 * between four unrelated problems that all present as HTTP 401.
 */
async function elevenDetail(res) {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return { message: body.detail };
    return { status: body?.detail?.status, message: body?.detail?.message };
  } catch {
    return {};
  }
}

const EXPLAIN_ELEVEN = {
  invalid_api_key:
    "The key itself is wrong — re-copy it from elevenlabs.io → Profile → API Keys.",
  missing_permissions:
    "The key is VALID but lacks a permission. Edit it and enable voices_read (and text_to_speech).",
  detected_unusual_activity:
    "ElevenLabs has flagged the account — free tiers get this from VPN or cloud IPs. It needs a paid plan or an appeal to them.",
  quota_exceeded: "The character quota for this billing period is spent.",
};

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
      if (res.ok) {
        const body = await res.json();
        const count = body?.voices?.length ?? 0;
        check("key accepted", true);
        check(`${count} voice(s) on the account`, count > 0, "an account with no voices cannot speak");
      } else {
        // HTTP 401 alone is not an answer: it covers a mistyped key, a valid key
        // without `voices_read`, and a free tier flagged for unusual activity —
        // and the fix is different for all three. The slug in the body says
        // which, so print it rather than the status code that hides it.
        const detail = await elevenDetail(res);
        check(
          "can list the account's voices",
          false,
          `HTTP ${res.status}` +
            (detail.status ? ` · ${detail.status}` : "") +
            (detail.message ? ` — ${detail.message}` : ""),
        );
        const hint = EXPLAIN_ELEVEN[detail.status];
        if (hint) console.log(`    → ${hint}`);

        // Listing and speaking are separate permissions, so the failure above
        // does not settle whether the game has a voice. Ask the question that
        // does, with two characters of speech, against a premade voice.
        const spoke = await fetch(
          "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
          {
            method: "POST",
            headers: {
              "xi-api-key": eleven,
              "content-type": "application/json",
              accept: "audio/mpeg",
            },
            body: JSON.stringify({
              text: "ok",
              model_id: process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5",
            }),
          },
        );
        const spokeDetail = spoke.ok ? null : await elevenDetail(spoke);
        check(
          "can synthesise speech, which is what the panel actually needs",
          spoke.ok,
          spoke.ok
            ? ""
            : `HTTP ${spoke.status}` +
                (spokeDetail?.status ? ` · ${spokeDetail.status}` : "") +
                (spokeDetail?.message ? ` — ${spokeDetail.message}` : ""),
        );
        if (spoke.ok) {
          console.log("    → The key speaks but cannot list voices. /api/tts handles this");
          console.log("      by falling back to a premade voice, so the panel has a real");
          console.log("      voice; add voices_read to cast per character from your account.");
        }
      }
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

  const voiceProbe = await tts.GET();
  check("the voice probe reports not configured", (await voiceProbe.json()).configured === false);

  const all = await import(pathToFileURL(join(root, "app/api/ai/route.ts")).href);
  const overview = await (await all.GET()).json();
  check(
    "/api/ai says plainly that no keys are set, and that this is allowed",
    /No AI keys are set/.test(overview.summary) && /supported state/.test(overview.summary),
    overview.summary,
  );
  check("and contacts no provider to find that out", lastRequest === null);

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

{
  // The regression this round exists to fix, and the reason a correctly
  // configured deploy still played the browser voice.
  //
  // An ElevenLabs key carries granular permissions, and `voices_read` is a
  // separate one from text-to-speech. A key that may SPEAK but may not LIST got
  // a 401 at the voice lookup, which was the only source of a voice id, so the
  // whole feature fell back — sounding exactly like a deploy with no key at all.
  const fresh = await import(pathToFileURL(join(root, "app/api/tts/route.ts")).href + `?perm=${Date.now()}`);
  handler = (url) =>
    url.includes("/v1/voices")
      ? Response.json(
          { detail: { status: "missing_permissions", message: "missing the permission voices_read" } },
          { status: 401 },
        )
      : new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
  const res = await fresh.POST(json("http://localhost/api/tts", { text: "hi", speaker: "chair" }));
  check("still speaks with a key that may synthesise but not list voices", res.status === 200, `HTTP ${res.status}`);
  check("reaches synthesis with a premade voice to do it", lastRequest.url.includes("/v1/text-to-speech/"));
}

{
  // A premade guess that is genuinely absent from the account answers 404, and
  // that is the one refusal worth another attempt.
  const fresh = await import(pathToFileURL(join(root, "app/api/tts/route.ts")).href + `?rotate=${Date.now()}`);
  const tried = [];
  handler = (url) => {
    if (url.includes("/v1/voices")) return new Response("forbidden", { status: 403 });
    tried.push(url);
    return tried.length < 3
      ? Response.json({ detail: { status: "voice_not_found" } }, { status: 404 })
      : new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "audio/mpeg" } });
  };
  const res = await fresh.POST(json("http://localhost/api/tts", { text: "hi", speaker: "chair" }));
  check(
    "tries the next premade voice when one is not on the account",
    res.status === 200 && tried.length === 3,
    `HTTP ${res.status} after ${tried.length} attempt(s)`,
  );
  check("and does not try the same voice twice", new Set(tried).size === tried.length);
}

{
  // The probe exists so that "the key is set but you hear the robot" is a
  // question answerable from outside, without a redeploy or a log dig.
  const fresh = await import(pathToFileURL(join(root, "app/api/tts/route.ts")).href + `?probe=${Date.now()}`);
  handler = () =>
    Response.json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, { status: 401 });
  const body = await (await fresh.GET()).json();
  check("the probe reports a key that is set but rejected", body.configured === true && body.listStatus === 401, JSON.stringify(body));
  check("the probe names the provider's own reason", body.lastError?.status === "invalid_api_key", JSON.stringify(body.lastError));
  check("the probe leaks no key material", !JSON.stringify(body).includes("test-eleven"));
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

// ── The Tank · substance, not statistics ────────────────────────────────────
// The failure this section exists to catch was reported by players and is the
// worst kind: the room LOOKED like it was listening. Sharks asked real
// questions about the real company, the founder answered "I like pickles", and
// the money arrived anyway — because the offer maths priced any string of
// English at 0.4 and a good balance sheet did the rest. These are the tests
// that make "the sharks read the answers" a claim with a failing state.
console.log("\nThe Tank  ·  what the sharks actually pay for");

const { scoreAnswer, scoreAnswers, scorePitchContent, DEFENCE_FLOOR } = await import(
  pathToFileURL(join(root, "lib/ai/pitch-content.ts")).href
);
const { localOfferTurn } = await import(pathToFileURL(join(root, "lib/ai/panel-local.ts")).href);

const CHURN_Q =
  "You're losing 9% of customers every month. Do you know why they leave, or are you guessing?";
const SCALE_Q = "What breaks first when you triple the volume? Be specific.";
const WORTH_Q = "Run your own math with me: what is this company actually worth?";

{
  check("a joke is not an answer", scoreAnswer(CHURN_Q, "i like pickles").quality === 0);
  check("neither is a shrug", scoreAnswer(CHURN_Q, "it'll be fine").quality === 0);
  check("neither is keyboard mash", scoreAnswer(CHURN_Q, "asdf asdf asdf").quality === 0);
  check(
    "neither is a fluent sentence about something else",
    scoreAnswer(CHURN_Q, "My favourite colour is blue and I have a dog called Rex.").quality === 0,
  );
  check(
    "reading the question back adds nothing",
    scoreAnswer(
      "You keep 38 cents on the dollar before you've paid anybody. Where does the rest go?",
      "You keep 38 cents on the dollar before you've paid anybody",
    ).quality === 0,
  );

  const good = scoreAnswer(
    CHURN_Q,
    "Most of them leave after the first month because setup takes a week, so we rebuilt onboarding.",
  );
  check("a real answer scores as one", good.quality >= 0.7, String(good.quality));
  // The whole point of scoring topic rather than vocabulary: this answer
  // repeats none of the question's words and is still an answer to it.
  const terse = scoreAnswer(CHURN_Q, "About 9%, mostly the free-trial cohort.");
  check("four numerate words beat a paragraph of nothing", terse.quality >= 0.5, String(terse.quality));
  // Brand Law 5 lives here too: the scorer must not prefer the fluent one.
  const plain = scoreAnswer(CHURN_Q, "they leave becuase the app is slow, we fixing it now");
  check(
    "imperfect English is still a real answer",
    plain.quality > 0 && !plain.offTopic,
    JSON.stringify(plain),
  );
}

{
  const same = "We are a hoodie brand for teenagers with a 62% gross margin and growing fast.";
  const read = scoreAnswers([
    { question: CHURN_Q, answer: same },
    { question: SCALE_Q, answer: same },
    { question: WORTH_Q, answer: same },
  ]);
  check("one prepared sentence is one answer, not three", read.answered <= 1, JSON.stringify(read.answered));
  check("and it does not clear the floor", read.held < DEFENCE_FLOOR, String(read.held));
}

{
  // A company with genuinely excellent books. Under the old maths this is
  // exactly the run that got funded no matter what the founder said.
  const ctx = {
    founderName: "Ana",
    company: {
      name: "Loop", industry: "Consumer goods", stage: "Growth", year: 3,
      cash: 900_000, burnMonthly: 20_000, runwayMonths: 24, revenueAnnual: 2_400_000,
      grossMarginPt: 72, netMarginPt: 18, valuation: 8_000_000, founderEquityPct: 80,
      employees: 12, customerSatisfaction: 88,
    },
    brief: { companyType: "brand", whatItDoes: "hoodies", usp: "in-house printing", whyCustomers: "cheaper", mission: "", missing: false },
    metrics: { ltvCacRatio: 5.2, monthlyChurnPct: 2, growthYoyPct: 90, tam: 6e11, marketSharePct: 3 },
    competitors: [],
    attackPoints: [{ id: "scale", claim: "Capacity is one press.", question: SCALE_Q, owner: "dev", severity: 3 }],
    fairValuation: { low: 5_600_000, high: 11_600_000 },
    ask: { amountUsd: 500_000, equityPct: 6, impliedValuationUsd: 8_333_333 },
    coveredBeats: [],
  };
  const SHARKS = ["marcus", "serena", "dev", "lily", "viktor"];
  const room = (answers, score = 8) =>
    SHARKS.map((shark) =>
      localOfferTurn({
        shark,
        ctx,
        answers: answers.map((answer, i) => ({
          question: [CHURN_Q, SCALE_Q, WORTH_Q][i],
          answer,
          declined: !answer,
        })),
        offersOnTable: [],
        score,
      }).decision,
    );

  const jokes = room(["i like pickles", "pickles are nice", "lol idk"]);
  check(
    "a perfect balance sheet buys nothing when the answers are jokes",
    jokes.every((d) => d === "out"),
    jokes.join(","),
  );
  const offTopic = room([
    "We are a hoodie brand for teenagers.",
    "We print them ourselves in Leeds.",
    "Teenagers really like the designs.",
  ]);
  check(
    "and nothing when the founder answers a different question each time",
    offTopic.every((d) => d === "out"),
    offTopic.join(","),
  );
  const real = room([
    "About 2%, mostly the free-trial cohort, because setup takes a week — we rebuilt onboarding and it's down to 1.4%.",
    "The heat press. At triple volume we need a second one, which is 40k, and one more operator.",
    "The books say 8 million and I'm asking at 8.3 because revenue grew 90% on a 72% margin.",
  ]);
  check(
    "a founder who answers the questions still gets offers",
    real.filter((d) => d === "offer").length >= 4,
    real.join(","),
  );
  // The pitch still matters — this is a rebalance, not a replacement.
  const weakPitch = real.filter((d) => d === "offer").length;
  const strongPitch = room(
    [
      "About 2%, mostly the free-trial cohort, because setup takes a week — we rebuilt onboarding and it's down to 1.4%.",
      "The heat press. At triple volume we need a second one, which is 40k, and one more operator.",
      "The books say 8 million and I'm asking at 8.3 because revenue grew 90% on a 72% margin.",
    ],
    2,
  ).filter((d) => d === "offer").length;
  check("the pitch score still moves the room", strongPitch <= weakPitch, `${strongPitch} vs ${weakPitch}`);
}

{
  // The pitch itself. Keyword bingo and one line on a loop are the two cheapest
  // ways to beat a keyword scorer, and both used to work.
  const books = {
    stats: {
      burnMonthly: 20_000, revenueAnnual: 240_000, grossMarginPt: 62, cash: 90_000,
      csat: 71, morale: 66, qual: 60, valuation: 1_200_000, employees: 4, netMarginPt: 5,
    },
  };
  const loop = Array(24).fill("i like pickles").join(" ");
  check("a pitch that is one line on a loop scores nothing", scorePitchContent(loop, books).score === 0);
  check(
    "a pitch that is not language scores nothing",
    scorePitchContent("asdf asdf qwer qwer zxcv zxcv hjkl hjkl asdf qwer zxcv hjkl", books).score === 0,
  );
  const realPitch =
    "We make hoodies for school sports teams. Our customers are parents and school clubs, and we charge 34 dollars a hoodie at a 62% gross margin. Revenue is 240,000 a year and growing. I'm raising 150,000 for 12% to buy a second printer and hire one person.";
  check(
    "a real pitch is unaffected",
    scorePitchContent(realPitch, books).score >= 7,
    String(scorePitchContent(realPitch, books).score),
  );
}

{
  // The pitch score card, and the sentence a player quoted back: "I am the
  // pickle man… Pickles are in the supermarket. I want money" came back as
  // 2.5/10 having covered Solution, Market and Traction. Market was awarded
  // for the word SUPERmarket.
  const { beatsCovered, saidIn, PITCH_FRAMEWORK } = await import(
    pathToFileURL(join(root, "lib/engine/company-brief.ts")).href
  );

  check("a marker is a word, not a substring", saidIn("Pickles are in the supermarket", "market") === false);
  check("but the word itself still counts", saidIn("our addressable market is huge", "market") === true);
  check("\"sincere\" is not \"since\"", saidIn("he was sincere about it", "since") === false);
  check("\"soldier\" is not \"sold\"", saidIn("a soldier bought one", "sold") === false);
  check("\"workshop\" is not \"shop\"", saidIn("I went to the workshop", "shop") === false);
  // Brand Law 5: a marker list written in textbook English must not quietly
  // score grammar. Same claim, second-language phrasing, same beat.
  check("\"we make\" is found in \"we is making\"", saidIn("we is making hoodie", "we make") === true);
  check("and in \"we are selling\"", saidIn("we are selling to schools", "we sell") === true);
  check("but not across a negation", saidIn("we do not make anything", "we make") === false);

  const named = (tx) => PITCH_FRAMEWORK.filter((b) => beatsCovered(tx)[b.n]).map((b) => b.title);
  const junk = "I am the pickle man. I like pickles. We sell pickles. Customers like pickles. Pickles are in the supermarket. I want money.";
  check("the pickle man covers no beats at all", named(junk).length === 0, named(junk).join(","));

  const books = {
    stats: {
      burnMonthly: 20_000, revenueAnnual: 240_000, grossMarginPt: 62, cash: 90_000,
      csat: 71, morale: 66, qual: 60, valuation: 1_200_000, employees: 4, netMarginPt: 5,
    },
  };
  check("and scores nothing", scorePitchContent(junk, books).score === 0, String(scorePitchContent(junk, books).score));
  const weekend =
    "hello hello my name is bob and i went to the shop yesterday and it was quite sunny outside so i had a nice time thanks";
  check(
    "neither does fluent English about someone's weekend",
    scorePitchContent(weekend, books).score === 0,
    String(scorePitchContent(weekend, books).score),
  );
  check(
    "and it is told there was no business in it",
    /no business in that/.test(scorePitchContent(weekend, books).findings[0]?.note ?? ""),
  );

  // The other direction, which matters just as much: a real pitch must not be
  // caught by any of this — terse, unpunctuated, or in imperfect English.
  const terse = "We sell hoodies to schools. Customers reorder every term. Revenue is 240k. I'm asking for 150k for 12%.";
  const spoken =
    "so we make hoodies for school sports teams the customers are parents and school clubs we charge 34 dollars each and keep 62 percent revenue is 240 thousand a year im raising 150 thousand for 12 percent to buy another printer";
  const esl =
    "we is making hoodie for the school team. the parent and club they buy from us. we charge 34 dollar and keep 62 percent. i want 150 thousand for 12 percent to buy machine";
  check("a terse real pitch still scores", scorePitchContent(terse, books).score >= 6, String(scorePitchContent(terse, books).score));
  check("an unpunctuated spoken pitch still scores", scorePitchContent(spoken, books).score >= 6, String(scorePitchContent(spoken, books).score));
  check("and one in imperfect English still covers beats", named(esl).includes("Solution"), named(esl).join(","));
}

{
  // The cold call is the other surface that turns a pitch into money, and it
  // had the same hole: a strong company and a good reputation cleared an easy
  // caller's bar with a transcript that said nothing at all.
  const { resolveCallLocally, CALLERS } = await import(
    pathToFileURL(join(root, "lib/ai/callers.ts")).href
  );
  const easiest = [...CALLERS].sort((a, b) => a.difficulty - b.difficulty)[0];
  const run = {
    seed: 7, year: 2, month: 4, industry: "food", stage: 1, founderEquityPct: 90,
    companyName: "Loop", founderName: "Ana", brief: null,
    stats: {
      burnMonthly: 0, revenueAnnual: 2_400_000, grossMarginPt: 88, cash: 2_000_000,
      csat: 95, morale: 95, qual: 95, brand: 95, respect: 100, invsent: 6,
      valuation: 8_000_000, employees: 12, netMarginPt: 30,
    },
  };
  const nonsense = resolveCallLocally(
    { transcript: Array(24).fill("i like pickles").join(" "), seconds: 90, spoken: true },
    easiest,
    run,
  );
  check(
    "the easiest caller still says no to a pitch that said nothing",
    nonsense.accepted === false,
    JSON.stringify(nonsense.accepted),
  );
}

{
  // The live room, overridden. A model charmed by good books does not get to
  // hand out a cheque the offline room would have refused.
  const panel = await import(pathToFileURL(join(root, "app/api/panel/route.ts")).href);
  const offered = {
    spoken: "I love this. I'm in.",
    decision: "offer",
    amount_usd: 500_000,
    equity_pct: 6,
    deal_type: "equity",
    conditions: [],
    join_with: "",
    reason: "Great margins.",
    private_notes: "",
  };
  handler = () => Response.json({ choices: [{ message: { content: JSON.stringify(offered) } }] });

  const call = (answers) =>
    panel.POST(
      json("http://localhost/api/panel", {
        phase: "offer",
        shark: "marcus",
        pitchTranscript: "We make hoodies for school teams and I'm raising 150,000 for 12%.",
        context: { fairValuation: { low: 5_600_000, high: 11_600_000 } },
        answers,
      }),
    );

  const jokeBody = await (
    await call([
      { question: CHURN_Q, answer: "i like pickles" },
      { question: SCALE_Q, answer: "pickles are nice" },
      { question: WORTH_Q, answer: "lol idk" },
    ])
  ).json();
  check("the server overrides an offer the answers did not earn", jokeBody.decision === "out", JSON.stringify(jokeBody.decision));
  check("and says why in the private notes", /Answer substance/.test(jokeBody.private_notes ?? ""), jokeBody.private_notes);

  const realBody = await (
    await call([
      { question: CHURN_Q, answer: "About 2%, mostly the free-trial cohort, because setup takes a week." },
      { question: SCALE_Q, answer: "The heat press. A second one is 40k and one more operator." },
      { question: WORTH_Q, answer: "The books say 8 million and I'm asking at 8.3 on 90% growth." },
    ])
  ).json();
  check("and leaves an earned offer alone", realBody.decision === "offer", JSON.stringify(realBody.decision));

  await call([{ question: CHURN_Q, answer: "About 2%, from the free-trial cohort." }]);
  const brief = JSON.parse(JSON.parse(lastRequest.init.body).messages[1].content);
  check(
    "the shark is told how much of the questioning the founder stood up to",
    typeof brief.evaluator_notes.how_much_of_the_questioning_they_stood_up_to?.score_0_to_1 === "number",
    JSON.stringify(brief.evaluator_notes.how_much_of_the_questioning_they_stood_up_to),
  );
  check(
    "and told the floor below which nobody invests",
    brief.evaluator_notes.how_much_of_the_questioning_they_stood_up_to.below_this_nobody_invests ===
      DEFENCE_FLOOR,
  );

  const rules = (await import(pathToFileURL(join(root, "lib/ai/server/panel-prompts.ts")).href)).sharkSystemPrompt("marcus");
  check("and told in the prompt that good numbers are not a defence", /GOOD NUMBERS ARE NOT A DEFENCE/.test(rules));
}

// ── Five investors, or one investor with five faces ─────────────────────────
// The reported failure: "in certain situations their answers are completely
// identical." They were. The defence-floor override in app/api/panel/route.ts
// put ONE sentence in all five mouths in a row, and the offline negotiate turn
// drew every line from a single pool shared by the whole panel — so the room
// most obviously broke exactly when all five sharks agreed, which is the moment
// a founder most needs to believe five people got there separately.
//
// The other half of the same problem: nobody in this room had ever
// acknowledged that anybody else was in it. Panel Rulebook rule 2 asks for it,
// every persona file has a PANEL DYNAMICS line, and none of it reached a model
// or the offline room.
console.log("\nThe Tank  ·  five investors, not one in five voices");

const SHARKS = ["marcus", "serena", "dev", "lily", "viktor"];

{
  const { localQuestionTurn, localNegotiateTurn } = await import(
    pathToFileURL(join(root, "lib/ai/panel-local.ts")).href
  );
  const { relationOf, lastOtherBeat, whoWalked, resolveShark } = await import(
    pathToFileURL(join(root, "lib/ai/panel-dynamics.ts")).href
  );
  const { CAST } = await import(pathToFileURL(join(root, "lib/ai/panel-cast.ts")).href);

  const ctx = {
    founderName: "Ama",
    company: {
      name: "Kettle & Co",
      industry: "Food",
      stage: "Garage",
      year: 2,
      cash: 40_000,
      burnMonthly: 9_000,
      runwayMonths: 4,
      revenueAnnual: 120_000,
      grossMarginPt: 38,
      netMarginPt: 2,
      valuation: 600_000,
      founderEquityPct: 100,
      employees: 3,
      customerSatisfaction: 51,
    },
    brief: { companyType: "", whatItDoes: "", usp: "", whyCustomers: "", mission: "", missing: false },
    metrics: { growthYoyPct: 20, tam: 4e9, monthlyChurnPct: 8, mrr: 10_000, ltvCacRatio: 1.8 },
    competitors: [],
    attackPoints: [
      { id: "runway", claim: "Runway is 4 months.", question: "What happens in month five?", owner: "viktor", severity: 10 },
      { id: "margin", claim: "Gross margin is 38%.", question: "Where do the other 62 cents go?", owner: "marcus", severity: 7 },
      { id: "churn", claim: "Monthly churn is 8%.", question: "Do you know why they leave?", owner: "lily", severity: 6 },
      { id: "csat", claim: "Satisfaction is 51/100.", question: "What is the complaint you hear most?", owner: "dev", severity: 5 },
      { id: "flat", claim: "Growth is slowing.", question: "Is that the market or the product?", owner: "serena", severity: 5 },
    ],
    fairValuation: { low: 420_000, high: 870_000 },
    ask: { amountUsd: 150_000, equityPct: 15, impliedValuationUsd: 1_000_000 },
    coveredBeats: [],
  };

  /** A company good enough that the room bids rather than walks. */
  const jointCtx = {
    ...ctx,
    company: { ...ctx.company, grossMarginPt: 58, runwayMonths: 14, customerSatisfaction: 78, valuation: 900_000 },
    metrics: { growthYoyPct: 90, tam: 6e11, monthlyChurnPct: 3, mrr: 35_000, ltvCacRatio: 4 },
    fairValuation: { low: 630_000, high: 1_300_000 },
  };

  // Everybody walks for the same reason: three questions, three jokes.
  const nothing = [
    { question: CHURN_Q, answer: "i like pickles", declined: false },
    { question: SCALE_Q, answer: "pickles are nice", declined: false },
    { question: WORTH_Q, answer: "lol idk", declined: false },
  ];

  {
    // The offline room, walking one seat at a time — each one reading the log
    // the ones before it left behind.
    const log = [];
    const spoken = [];
    for (const shark of SHARKS) {
      const turn = localOfferTurn({ shark, ctx, answers: nothing, offersOnTable: [], log, score: 3 });
      spoken.push(turn.spoken);
      log.push({ speaker: shark, spoken: turn.spoken, decision: turn.decision, offer: turn.offer });
    }
    check("all five walk when nothing was answered", log.every((l) => l.decision === "out"));
    check(
      "and no two of them say it in the same words",
      new Set(spoken).size === 5,
      JSON.stringify(spoken.filter((s, i) => spoken.indexOf(s) !== i)),
    );
    check(
      "the ones who follow acknowledge the ones who went first, by name",
      spoken.slice(1).some((s) => SHARKS.some((id) => s.includes(id[0].toUpperCase() + id.slice(1)))),
      spoken.slice(1).join(" | "),
    );
    check("the log knows who folded", whoWalked(log).length === 5);
  }

  {
    // The counter nobody made. This was one hardcoded string for the whole panel.
    const current = { amount_usd: 120_000, equity_pct: 20, implied_valuation_usd: 600_000, deal_type: "equity", conditions: [] };
    const silent = SHARKS.map((shark) => localNegotiateTurn({ shark, ctx, current, counter: "" }).spoken);
    check("a founder who doesn't counter hears five different replies", new Set(silent).size === 5, JSON.stringify(silent));

    const vague = SHARKS.map((shark) => localNegotiateTurn({ shark, ctx, current, counter: "I want more" }).spoken);
    check("and so does one who counters without a number", new Set(vague).size === 5, JSON.stringify(vague));

    const moved = SHARKS.map((shark) => localNegotiateTurn({ shark, ctx, current, counter: "180k for 12%" }).spoken);
    check("and one who counters with terms", new Set(moved).size === 5, JSON.stringify(moved));
    check("every revision is still a real move on the equity", moved.every((s) => /%/.test(s)));

    /*
     * A revised offer's arithmetic has to tie out, and for a long time it did
     * not: `equity_pct` was rounded to one decimal while
     * `implied_valuation_usd` was computed from the unrounded 15.8399…%, so the
     * beat row printed "$2.7M ÷ 15.8% = $17,045,455" — which is not what that
     * division equals. This is a game that teaches a teenager to read a
     * valuation; the worked example on screen cannot be wrong.
     */
    const ties = [];
    for (const equity_pct of [3, 4.7, 15.83, 22.5, 31.1, 45, 59.9]) {
      for (const amount_usd of [7_500, 120_000, 2_700_000, 48_000_000]) {
        const revised = localNegotiateTurn({
          shark: "serena", ctx, counter: "200k for 10%",
          current: { amount_usd, equity_pct, implied_valuation_usd: 0, deal_type: "equity", conditions: [] },
        }).offer;
        ties.push(
          revised.implied_valuation_usd === Math.round(revised.amount_usd / (revised.equity_pct / 100)),
        );
      }
    }
    check("a revised offer's division ties out at every size", ties.every(Boolean), `${ties.filter((t) => !t).length} of ${ties.length} did not`);
  }

  {
    // The first voice in the room has nobody to agree with, and must not
    // pretend otherwise — the tell that gives the whole device away.
    const opening = localQuestionTurn({ shark: "viktor", ctx, usedIds: [], askedQuestions: [], log: [], round: 1 });
    check(
      "the first shark to speak references nobody",
      !SHARKS.some((id) => id !== "viktor" && opening.spoken.includes(id[0].toUpperCase() + id.slice(1))),
      opening.spoken,
    );

    // ...and the ones after them do. Sampled across the seats because whether
    // a given turn cross-talks is a die roll by design: a shark who reacts to
    // the room EVERY time is a tic, and a tic is the thing being fixed.
    const log = [
      { speaker: "viktor", spoken: opening.spoken, questions: [opening.questions[0]] },
    ];
    const followers = SHARKS.filter((s) => s !== "viktor").map((shark) =>
      localQuestionTurn({ shark, ctx, usedIds: ["runway"], askedQuestions: [opening.questions[0]], log, round: 2 }).spoken,
    );
    check(
      "the sharks who follow take a position on the one before them, by name",
      followers.some((s) => s.includes("Viktor")),
      followers.join(" | "),
    );
    check(
      "and none of them reacts to somebody who has not spoken",
      !followers.some((s) => /Marcus|Serena|Dev|Lily/.test(s.replace(/Viktor/g, ""))),
      followers.join(" | "),
    );
    check("nobody agrees with themselves", lastOtherBeat(log, "viktor") === null);
  }

  {
    /*
     * ── Two names on one cheque ─────────────────────────────────────────────
     *
     * Panel Rulebook rule 3 has always allowed a joint offer, the schema has
     * always carried `decision: "join"` and `join_with`, and no screen, scorer
     * or state ever read the field — the offline room hardcoded it empty and
     * the route emitted a name nobody looked at. Dev calls this his favourite
     * play and Serena and Lily split brand deals; the room could not do it.
     */
    const defended = [
      { question: CHURN_Q, answer: "About 3% a month, mostly the free-trial cohort, because setup took a week and we fixed it.", declined: false },
      { question: SCALE_Q, answer: "The heat press. A second one is 40k plus one more operator, and I have the quote.", declined: false },
      { question: WORTH_Q, answer: "The books say 900 thousand and I'm asking at a million on 90 percent growth.", declined: false },
    ];

    let joins = 0;
    const pairs = new Set();
    let jointTermsTieOut = true;
    let neverStacked = true;
    let alwaysNamed = true;

    for (let year = 1; year <= 60; year += 1) {
      const ctx = { ...jointCtx, company: { ...jointCtx.company, year } };
      const onTable = [];
      for (const shark of SHARKS) {
        const turn = localOfferTurn({ shark, ctx, answers: defended, offersOnTable: [...onTable], log: [], score: 8 });
        if (turn.decision === "join") {
          joins += 1;
          pairs.add(`${shark}->${turn.join_with}`);
          const target = onTable.find((o) => o.shark === turn.join_with);
          // A joint offer must name a seat that is actually holding a solo
          // offer right now. Anything else puts a deal on screen in the name
          // of somebody the founder never saw bid.
          if (!target || target.with || turn.join_with === shark) neverStacked = false;
          if (!turn.spoken.includes(CAST[turn.join_with]?.name ?? " ")) alwaysNamed = false;
          const o = turn.offer;
          if (o.implied_valuation_usd !== Math.round(o.amount_usd / (o.equity_pct / 100))) {
            jointTermsTieOut = false;
          }
          // Joining means coming in at the price the first shark already set.
          if (target && o.amount_usd <= target.offer.amount_usd) jointTermsTieOut = false;
          const i = onTable.findIndex((e) => e.shark === turn.join_with && !e.with);
          if (i >= 0) onTable[i] = { shark: turn.join_with, offer: o, with: shark };
        } else if (turn.offer) {
          onTable.push({ shark, offer: turn.offer });
        }
      }
    }

    check("sharks propose joint offers at all", joins > 0, String(joins));
    check("and only to a seat actually holding a solo offer", neverStacked);
    check("the joint line names the partner out loud", alwaysNamed);
    check("the combined cheque is bigger than the one it joined", jointTermsTieOut);
    check(
      "Dev joins Marcus, which his persona calls his favourite play",
      pairs.has("dev->marcus"),
      [...pairs].join(", "),
    );
    check(
      "Lily joins Serena — she buys the reach, Lily builds the love",
      pairs.has("lily->serena"),
      [...pairs].join(", "),
    );
    check(
      "Viktor never joins anybody, exactly as his persona says",
      ![...pairs].some((p) => p.startsWith("viktor->")),
      [...pairs].join(", "),
    );
  }

  {
    // The relationships are the persona files, not invention: Marcus trusts
    // Viktor's diligence and needles Serena, and the code has to agree.
    check("Marcus and Viktor are allies, per their persona files", relationOf("marcus", "viktor").stance === "ally");
    check("Marcus and Serena are not", relationOf("marcus", "serena").stance === "spar");
    check("Serena and Lily are the brand-led alliance", relationOf("serena", "lily").stance === "ally");
    check(
      "and every ordered pair has a read the prompt can ship",
      SHARKS.every((a) => SHARKS.filter((b) => b !== a).every((b) => relationOf(a, b).read.length > 20)),
    );
  }
}

{
  // The live room. Same override, same requirement — and the model gets told
  // who else is at the table, which is the thing that made rule 2 unusable.
  const panel = await import(pathToFileURL(join(root, "app/api/panel/route.ts")).href);
  handler = () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              spoken: "I love this. I'm in.",
              decision: "offer",
              amount_usd: 500_000,
              equity_pct: 6,
              deal_type: "equity",
              conditions: [],
              join_with: "",
              reason: "Great margins.",
              private_notes: "",
            }),
          },
        },
      ],
    });

  const nothing = [
    { question: CHURN_Q, answer: "i like pickles" },
    { question: SCALE_Q, answer: "pickles are nice" },
    { question: WORTH_Q, answer: "lol idk" },
  ];

  const log = [];
  const spoken = [];
  for (const shark of SHARKS) {
    const body = await (
      await panel.POST(
        json("http://localhost/api/panel", {
          phase: "offer",
          shark,
          pitchTranscript: "We make hoodies for school teams.",
          context: { fairValuation: { low: 5_600_000, high: 11_600_000 } },
          answers: nothing,
          log,
        }),
      )
    ).json();
    spoken.push(body.spoken);
    log.push({ speaker: shark, spoken: body.spoken, decision: body.decision, offer: body.offer });
  }
  check("the server still overrides every offer the answers did not earn", log.every((l) => l.decision === "out"));
  check(
    "but no longer in one sentence spoken five times",
    new Set(spoken).size === 5,
    JSON.stringify(spoken.filter((s, i) => spoken.indexOf(s) !== i)),
  );

  // What the model is actually handed about the other four.
  await panel.POST(
    json("http://localhost/api/panel", {
      phase: "questions",
      shark: "serena",
      pitchTranscript: "We make hoodies for school teams.",
      context: { fairValuation: { low: 1_000, high: 2_000 } },
      log: [
        { speaker: "marcus", spoken: "Give me the margin.", questions: ["What is your gross margin?"] },
      ],
    }),
  );
  const brief = JSON.parse(JSON.parse(lastRequest.init.body).messages[1].content);
  check("the shark is introduced to the other four by name", brief.the_room.the_other_four.length === 4);
  check(
    "and told what each of them cares about",
    brief.the_room.the_other_four.every((s) => s.they_care_about?.length > 10),
  );
  check(
    "and how this particular shark reads them",
    /rearview mirror/.test(
      brief.the_room.the_other_four.find((s) => s.name.startsWith("Marcus")).how_you_read_them,
    ),
  );
  check(
    "and handed the exact line spoken immediately before theirs",
    brief.the_room.who_spoke_immediately_before_you.their_exact_words === "Give me the margin.",
  );
  check(
    "and what that shark just did",
    brief.the_room.who_spoke_immediately_before_you.what_they_did === "asked the founder a question",
  );
  check(
    "the panel log carries names, not just database ids",
    brief.panel_log[0].speaker_name === "Marcus Cole",
  );

  await panel.POST(
    json("http://localhost/api/panel", {
      phase: "questions",
      shark: "marcus",
      pitchTranscript: "We make hoodies for school teams.",
      context: { fairValuation: { low: 1_000, high: 2_000 } },
      log: [],
    }),
  );
  const first = JSON.parse(JSON.parse(lastRequest.init.body).messages[1].content);
  check(
    "the first shark to speak is told there is nobody to react to yet",
    typeof first.the_room.who_spoke_immediately_before_you.nobody_yet === "string",
    JSON.stringify(first.the_room.who_spoke_immediately_before_you),
  );

  const rules = (await import(pathToFileURL(join(root, "lib/ai/server/panel-prompts.ts")).href)).sharkSystemPrompt("serena");
  check("and told in the prompt to talk to the other four", /TALK TO EACH OTHER/.test(rules));
  check("and told not to reuse another shark's words", /NOBODY ELSE'S WORDS/.test(rules));

  /*
   * The log is now READ by the server rather than merely forwarded — it decides
   * who has folded and who spoke last. That makes it an input, and an input
   * parsed off the wire has to survive being wrong. A `log: [null]` used to
   * throw inside the reader and take the route to a 500; the round is supposed
   * to degrade to the offline shark on any failure, never to a stack trace.
   */
  const junkLogs = [
    [null],
    [undefined],
    [{}],
    [{ speaker: 42 }],
    "not an array",
    [{ speaker: "ghost", decision: "banana", offer: "nope" }],
    Array(400).fill({ speaker: "lily", spoken: "x", decision: "out" }),
  ];
  let survived = 0;
  for (const log of junkLogs) {
    try {
      const res = await panel.POST(
        json("http://localhost/api/panel", {
          phase: "questions",
          shark: "dev",
          pitchTranscript: "We make hoodies.",
          context: { fairValuation: { low: 1_000, high: 2_000 } },
          log,
        }),
      );
      if (res.status < 500) survived += 1;
    } catch {
      /* counted as a failure below */
    }
  }
  check("a malformed panel log never 500s the route", survived === junkLogs.length, `${survived}/${junkLogs.length}`);

  const unknownShark = await panel.POST(
    json("http://localhost/api/panel", {
      phase: "questions",
      shark: "../../etc/passwd",
      pitchTranscript: "We make hoodies.",
      context: { fairValuation: { low: 1_000, high: 2_000 } },
    }),
  );
  check("and an unknown shark id falls back to a real seat", unknownShark.status < 500, `HTTP ${unknownShark.status}`);

  /*
   * ── The tic guard ──────────────────────────────────────────────────────
   *
   * "Roughly two turns in three" is not an instruction a model follows. Left
   * alone it reads the roster and opens EVERY turn with "I agree with Serena",
   * which is a new tic wearing the old one's clothes — and a fair complaint
   * about this change rather than a fix for the original one. The correction is
   * measured off what the room just did and stated only when it is true.
   */
  const briefWith = async (log) => {
    await panel.POST(
      json("http://localhost/api/panel", {
        phase: "questions",
        shark: "viktor",
        pitchTranscript: "We make hoodies.",
        context: { fairValuation: { low: 1_000, high: 2_000 } },
        log,
      }),
    );
    return JSON.parse(JSON.parse(lastRequest.init.body).messages[1].content);
  };
  const chatty = await briefWith([
    { speaker: "marcus", spoken: "Serena is pricing a story. I'm pricing a company." },
    { speaker: "lily", spoken: "Marcus is counting. I'd like to ask who's being counted." },
  ]);
  check(
    "two room-facing openings in a row and the next shark is told to stop",
    typeof chatty.the_room.cadence_correction === "string",
    JSON.stringify(chatty.the_room.cadence_correction),
  );
  const calm = await briefWith([
    { speaker: "marcus", spoken: "Give me the margin, in a number." },
    { speaker: "lily", spoken: "Marcus is counting. I'd like to ask who's being counted." },
  ]);
  check("and is not nagged when the room is not doing it", calm.the_room.cadence_correction === undefined);

  /*
   * ── A joint offer with somebody who never made one ─────────────────────
   *
   * `join_with` is free text from a model. Unbounded, a shark names somebody
   * who went out five turns ago and a deal appears on screen in the name of an
   * investor the founder just watched leave. Same "bound it rather than trust
   * it" rule the deal terms get.
   */
  const joinBody = async (joinWith, offersOnTable) => {
    handler = () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                spoken: "I'll come in with them.",
                decision: "join",
                amount_usd: 200_000,
                equity_pct: 12,
                deal_type: "equity",
                conditions: [],
                join_with: joinWith,
                reason: "Better together.",
                private_notes: "",
              }),
            },
          },
        ],
      });
    return (
      await panel.POST(
        json("http://localhost/api/panel", {
          phase: "offer",
          shark: "dev",
          pitchTranscript: "We make hoodies.",
          context: { fairValuation: { low: 900_000, high: 1_900_000 } },
          answers: [
            { question: CHURN_Q, answer: "About 2%, from the free-trial cohort, setup took a week." },
            { question: SCALE_Q, answer: "The heat press. A second one is 40k and one more operator." },
          ],
          offersOnTable,
        }),
      )
    ).json();
  };

  const standing = [{ shark: "marcus", amount_usd: 150_000, equity_pct: 15 }];
  const ok = await joinBody("Marcus Cole", standing);
  check("a join names a seat that really is on the table", ok.decision === "join", JSON.stringify(ok.decision));
  check("and the partner comes back as a seat id, not free text", ok.join_with === "marcus", JSON.stringify(ok.join_with));

  const ghost = await joinBody("Viktor Reyes", standing);
  check("joining a shark who never bid degrades to a plain offer", ghost.decision === "offer", JSON.stringify(ghost.decision));
  check("and carries no partner", ghost.join_with === "");

  const itself = await joinBody("dev", [{ shark: "dev", amount_usd: 1, equity_pct: 1 }]);
  check("a shark cannot join itself", itself.decision === "offer", JSON.stringify(itself.decision));

  const stacked = await joinBody("marcus", [
    { shark: "marcus", with: "lily", amount_usd: 150_000, equity_pct: 15 },
  ]);
  check("and nobody stacks a third name on one cheque", stacked.decision === "offer", JSON.stringify(stacked.decision));

  const nonsense = await joinBody("the guy in the blue jacket", standing);
  check("an unresolvable partner is refused rather than guessed", nonsense.decision === "offer", JSON.stringify(nonsense.decision));
}

// ── Nobody says the sentence above them ─────────────────────────────────────
// The house rules ask a shark not to restate what the shark before it just
// said. This is the check, and it is the same pattern the repeated-question
// guard already uses: a prompt carries the whole log and a prompt is still not
// a guarantee, so an echo falls to the offline shark, whose lines are per seat
// and cannot echo by construction.
console.log("\nThe Tank  ·  nobody parrots the seat above them");

{
  const { sharkOfferTurn } = await import(pathToFileURL(join(root, "lib/ai/panel.ts")).href);
  const said = "The margin is thin and the runway is short. I'm out.";

  const session = (log) => ({
    ctx: {
      founderName: "Ama",
      company: { name: "Kettle & Co", industry: "Food", stage: "Garage", year: 4, cash: 90_000, burnMonthly: 9_000, runwayMonths: 12, revenueAnnual: 420_000, grossMarginPt: 58, netMarginPt: 9, valuation: 900_000, founderEquityPct: 100, employees: 4, customerSatisfaction: 78 },
      brief: { companyType: "", whatItDoes: "", usp: "", whyCustomers: "", mission: "", missing: false },
      metrics: { growthYoyPct: 90, tam: 6e11, monthlyChurnPct: 3, mrr: 35_000, ltvCacRatio: 4 },
      competitors: [],
      attackPoints: [{ id: "a", claim: "Churn is 3%.", question: "Why do they leave?", owner: "lily", severity: 5 }],
      fairValuation: { low: 630_000, high: 1_300_000 },
      ask: { amountUsd: 150_000, equityPct: 15, impliedValuationUsd: 1_000_000 },
      coveredBeats: [],
    },
    pitchTranscript: "We make hoodies for school teams.",
    score: 8,
    log,
    askedQuestions: [],
    usedAttackIds: [],
    answers: [
      { question: CHURN_Q, answer: "About 3% a month, mostly the free-trial cohort, setup took a week and we fixed it.", declined: false },
      { question: SCALE_Q, answer: "The heat press. A second one is 40k plus one more operator.", declined: false },
    ],
    offersOnTable: [],
  });

  /*
   * This stubs /api/panel itself, not the provider behind it. `sharkOfferTurn`
   * is the CLIENT half — it calls the route and decides whether to keep the
   * answer — so the stub has to speak the route's response shape, which is the
   * already-shaped turn rather than an OpenRouter completion.
   */
  const reply = (spoken) => {
    handler = () =>
      Response.json({
        spoken,
        decision: "offer",
        offer: {
          amount_usd: 150_000,
          equity_pct: 15,
          implied_valuation_usd: 1_000_000,
          deal_type: "equity",
          conditions: [],
        },
        join_with: "",
        reason: "Fine business.",
        private_notes: "",
      });
  };

  reply("I'll put in $150K for 15% because the cohort retention convinced me.");
  const fresh = await sharkOfferTurn({ shark: "serena", session: session([{ speaker: "marcus", spoken: said }]) });
  check("a shark with something of its own to say goes through live", fresh.source === "api", fresh.source);

  reply(said);
  const parrot = await sharkOfferTurn({ shark: "serena", session: session([{ speaker: "marcus", spoken: said }]) });
  check("one that repeats the seat above it falls to the offline shark", parrot.source === "local", parrot.source);
  check("and the offline line is not the echo", parrot.spoken !== said, parrot.spoken);

  reply("The runway is short, the margin is thin, and I am out of this one.");
  const reworded = await sharkOfferTurn({ shark: "serena", session: session([{ speaker: "marcus", spoken: said }]) });
  check("rewording it is still parroting", reworded.source === "local", reworded.source);

  reply(said);
  const older = await sharkOfferTurn({
    shark: "serena",
    session: session([
      { speaker: "marcus", spoken: said },
      { speaker: "dev", spoken: "Walk me through the heat press." },
      { speaker: "lily", spoken: "Tell me about your hundredth customer." },
    ]),
  });
  check(
    "but a callback to something said three turns ago is a room with a memory",
    older.source === "api",
    older.source,
  );
}

// ── The empty shelf ─────────────────────────────────────────────────────────
// A founded company owns nothing and the tutorial sends every new player
// straight to the emptiest screen in the game. The three suggestions have to be
// LEGAL for the industry — a name the field will hold, a price inside the band,
// a tag the sim knows how to price — or tapping one produces an item the
// portfolio cannot reason about.
console.log("\nProduct suggestions  ·  three things you could sell");

{
  const { localSuggestions } = await import(
    pathToFileURL(join(root, "lib/ai/products.ts")).href
  );
  const { SPECS } = await import(pathToFileURL(join(root, "lib/engine/industries/index.ts")).href);

  const runFor = (industry, seed = 42) => ({
    seed, industry, year: 1, companyName: "Loop", portfolio: { items: [] },
  });

  let illegal = [];
  let contradictory = [];
  for (const [code, spec] of Object.entries(SPECS)) {
    const ideas = localSuggestions(runFor(code), spec);
    if (ideas.length !== 3) illegal.push(`${code}: ${ideas.length} ideas`);
    for (const i of ideas) {
      if (i.price < spec.priceMin || i.price > spec.priceMax) illegal.push(`${code}: $${i.price}`);
      if (i.name.length > 28) illegal.push(`${code}: name ${i.name.length} chars`);
      if (i.tags.some((t) => !spec.tags.includes(t))) illegal.push(`${code}: tag ${i.tags}`);
      // A priced thing tagged "free" is a suggestion arguing with itself.
      if (i.tags.some((t) => /free|f2p/i.test(t))) contradictory.push(`${code}: ${i.name}`);
    }
    // The spread IS the lesson the launch flow teaches.
    const tiers = ideas.map((i) => i.investTier).join("");
    if (tiers !== "012") illegal.push(`${code}: tiers ${tiers}`);
  }
  check("every industry gets three legal ideas", illegal.length === 0, illegal.slice(0, 3).join(" | "));
  check("and none of them argues with its own price", contradictory.length === 0, contradictory.slice(0, 3).join(" | "));

  // Two companies must not be handed the same shelf — the fixture problem this
  // codebase has already paid for twice.
  const shelves = [1, 2, 3, 4].map((seed) =>
    localSuggestions(runFor("FOOD", seed), SPECS.FOOD).map((i) => i.name).join("|"),
  );
  check("different companies get different shelves", new Set(shelves).size > 1, shelves.join(" / "));
  // …but the SAME company gets the same one on every render, or the list
  // reshuffles under the player's thumb.
  const twice = [0, 1].map(() =>
    localSuggestions(runFor("FOOD", 7), SPECS.FOOD).map((i) => i.name).join("|"),
  );
  check("and one company gets the same shelf twice", twice[0] === twice[1], twice.join(" / "));
}

{
  // The route, with a model that answers. The client refuses anything under
  // three ideas and falls back, so the route must return what it was given.
  const products = await import(pathToFileURL(join(root, "app/api/products/route.ts")).href);
  const payload = {
    ideas: [
      { name: "Midnight Chili Oil", price: 9, invest_tier: 0, tags: ["spicy"], why: "Cheap to make." },
      { name: "House Noodles", price: 13, invest_tier: 1, tags: ["vegetarian"], why: "Middle of the road." },
      { name: "Signature Bowl", price: 24, invest_tier: 2, tags: ["invented-tag"], why: "Costs more." },
    ],
  };
  handler = () => Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });

  const res = await products.POST(
    json("http://localhost/api/products", {
      companyName: "Loop",
      industry: "FOOD",
      noun: "Menu item",
      tags: ["spicy", "vegetarian"],
      priceMin: 3,
      priceMax: 40,
      baselinePrice: 13,
    }),
  );
  const body = await res.json();
  check("the route returns three ideas", body.ideas?.length === 3, JSON.stringify(body.ideas?.length));
  check("and drops a tag the industry does not have", body.ideas[2].tags.length === 0, JSON.stringify(body.ideas[2].tags));
  check("and keeps one it does", body.ideas[0].tags[0] === "spicy", JSON.stringify(body.ideas[0].tags));

  const bad = await products.POST(json("http://localhost/api/products", {}));
  check("and refuses a call with no company", bad.status === 400, `HTTP ${bad.status}`);
}

// ── /api/ai ─────────────────────────────────────────────────────────────────
// The whole-picture endpoint. Exists because "the key is set and it still
// sounds wrong" needed a redeploy to answer, three times running.
console.log("\n/api/ai  ·  the one URL that answers everything");

{
  const fresh = await import(pathToFileURL(join(root, "app/api/ai/route.ts")).href + `?ok=${Date.now()}`);
  handler = (url) => {
    if (url.includes("elevenlabs")) return Response.json({ voices: [{ voice_id: "v-a" }] });
    if (url.includes("deepgram")) return Response.json({ projects: [] });
    return Response.json({ data: { limit_remaining: 5 } });
  };
  const body = await (await fresh.GET()).json();
  check("reports all three providers", Object.keys(body.providers).length === 3, JSON.stringify(Object.keys(body.providers ?? {})));
  check("says plainly that they are answering", /All 3 configured provider/.test(body.summary), body.summary);
  check("names the variable that turns each one on", body.providers.voice.key === "ELEVENLABS_API_KEY");
  check("counts the account's voices", /1 voice/.test(body.providers.voice.detail ?? ""), body.providers.voice.detail);
}

{
  // The case that actually happened in production, and the reason this file
  // grew an endpoint: a key that is set, rejected, and silent about why.
  const fresh = await import(pathToFileURL(join(root, "app/api/ai/route.ts")).href + `?bad=${Date.now()}`);
  handler = (url) => {
    if (url.includes("elevenlabs")) {
      return Response.json(
        { detail: { status: "missing_permissions", message: "missing the permission voices_read" } },
        { status: 401 },
      );
    }
    if (url.includes("deepgram")) return Response.json({ projects: [] });
    return Response.json({ data: { limit_remaining: 5 } });
  };
  const body = await (await fresh.GET()).json();
  check("counts a key that can do neither as failing", /1 of 3 configured provider\(s\) are FAILING/.test(body.summary), body.summary);
  check("passes the provider's own slug through", body.providers.voice.reason === "missing_permissions", JSON.stringify(body.providers.voice));
  check("turns the slug into an instruction", /voices_read/.test(body.providers.voice.detail ?? ""), body.providers.voice.detail);
  check("leaks no key material", !JSON.stringify(body).includes("test-eleven"));
}

{
  // The state this deploy is actually in, and the one that must NOT read as a
  // failure: the key cannot LIST voices but can SPEAK with them. The panel has
  // a real voice; what it lacks is casting. Calling that "FAILING" while the
  // sharks are audibly talking is the false alarm that gets a diagnostic
  // ignored, and then the next real failure is invisible again.
  const fresh = await import(pathToFileURL(join(root, "app/api/ai/route.ts")).href + `?degraded=${Date.now()}`);
  handler = (url) => {
    if (url.includes("/v1/voices")) {
      return Response.json({ detail: { status: "missing_permissions" } }, { status: 401 });
    }
    if (url.includes("/v1/text-to-speech/")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    if (url.includes("deepgram")) return Response.json({ projects: [] });
    return Response.json({ data: { limit_remaining: 5 } });
  };
  const body = await (await fresh.GET()).json();
  check("does not call a speaking key FAILING", !/FAILING/.test(body.summary), body.summary);
  check("reports it as degraded instead", body.providers.voice.degraded === true && body.providers.voice.ok === true, JSON.stringify(body.providers.voice));
  check("says the summary line out loud", /1 is running degraded/.test(body.summary), body.summary);
  check("and explains that what is missing is casting, not voice", /casting/.test(body.providers.voice.detail ?? ""), body.providers.voice.detail);
}

{
  // A valid OpenRouter key with an empty wallet fails at the first cold call
  // and nowhere earlier, which is a miserable way to find out.
  const fresh = await import(pathToFileURL(join(root, "app/api/ai/route.ts")).href + `?broke=${Date.now()}`);
  handler = (url) => {
    if (url.includes("elevenlabs")) return Response.json({ voices: [{ voice_id: "v-a" }] });
    if (url.includes("deepgram")) return Response.json({ projects: [] });
    return Response.json({ data: { limit_remaining: 0 } });
  };
  const body = await (await fresh.GET()).json();
  check("catches an OpenRouter key with no credit left", body.providers.verdict.ok === false, JSON.stringify(body.providers.verdict));
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
