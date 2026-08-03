# AI setup

Three features in Novus can run on a hosted model. None of them has to.

| Feature | Provider | Key | Without the key |
|---|---|---|---|
| Shark and narrator voices | ElevenLabs | `ELEVENLABS_API_KEY` | The browser's built-in voice, shaped per character |
| Pitch transcription | Deepgram | `DEEPGRAM_API_KEY` | The browser's own recogniser, or the player types |
| Cold-call verdicts | OpenRouter | `OPENROUTER_API_KEY` | The offline resolver, reading the same transcript |

Each is independent — set one, get one. There is no all-or-nothing rule like the
one billing has, because every fallback above is a complete feature rather than
a degraded one. A missing key costs polish and never function.

---

## 1 · The failure this document exists to prevent

Setting the three keys used to do **nothing at all**, silently.

`lib/ai/speech.ts`, `lib/ai/transcribe.ts` and `lib/ai/callers.ts` were written
against *endpoints* — each reads a `NEXT_PUBLIC_*_ENDPOINT` URL and POSTs to it.
That is the correct shape, and the reason no key has ever reached a browser. But
nothing was ever built at the other end of those URLs, and no file in the repo
read `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY` or `OPENROUTER_API_KEY` by name.
So the keys sat in the environment, unread, while all three features quietly
stayed on their local fallbacks — and because "not configured" is a *normal*
state for each of them, nothing logged, nothing warned, and the app looked
exactly like a working deploy.

`app/api/tts`, `app/api/stt` and `app/api/pitch` are the missing other end. The
three clients now default to them, so **adding the key is sufficient** — you do
not need to set the endpoint variables at all.

The lesson generalises: a feature that degrades silently by design cannot report
its own misconfiguration. That is what `npm run test:ai -- --live` is for.

---

## 2 · Setting the keys

Exact spelling matters — nothing reads a near-miss, and a typo fails exactly the
same silent way described above.

```
ELEVENLABS_API_KEY=...
DEEPGRAM_API_KEY=...
OPENROUTER_API_KEY=...
```

Note `DEEPGRAM` (not `DEPPGRAM`) and `OPENROUTER` (not `OPENROUNTER`).

**Never prefix any of these with `NEXT_PUBLIC_`.** That prefix compiles the
value into the JavaScript every player downloads. These three are read by the
route handlers in `app/api/{tts,stt,pitch}/route.ts` and by nothing else.

Local work: put them in `.env.local`, which is gitignored. Production: set them
wherever your host keeps environment variables, then redeploy — a running
instance does not pick up a new variable.

Where to get them:

- **ElevenLabs** — elevenlabs.io → your profile → API key. Any tier, including
  free. The account needs at least one voice on it.

  **Check the key's permissions.** ElevenLabs keys are scoped, and a key can be
  issued that may synthesise speech but may not read the voice list — the two
  are separate toggles. `/api/tts` asks for the list first, to cast each shark
  from your own account, so a key without `voices_read` used to lose the voice
  entirely. It no longer does: the route falls back to a premade voice and the
  panel still speaks. But casting per character needs `voices_read`, so enable
  both it and `text_to_speech` when you create the key.
- **Deepgram** — console.deepgram.com → API keys. Read §3 before using this one
  in production.
- **OpenRouter** — openrouter.ai → Keys. Add credit; a cold call costs a
  fraction of a cent on the default model.

### Verify

```
npm run test:ai            # contract tests — no keys, no network, safe in CI
npm run test:ai -- --live  # calls the real providers with your keys
```

`--live` reports each provider separately: whether the key was accepted, how
many voices the ElevenLabs account has, and whether the OpenRouter model id
resolves. It is the check to run the moment a key is added, and the answer to
"I set it and nothing happened."

When ElevenLabs refuses, `--live` prints the provider's own reason rather than
the status code, because HTTP 401 covers four unrelated problems:

| What it says | What it means |
| --- | --- |
| `invalid_api_key` | The key is wrong. Re-copy it — and check for a typo in the variable NAME too. |
| `missing_permissions` | The key is valid but scoped too narrowly. Enable `voices_read` and `text_to_speech`. |
| `detected_unusual_activity` | The account is flagged. Free tiers get this from VPN and cloud IPs; it needs a paid plan or an appeal to ElevenLabs. |
| `quota_exceeded` | The character quota for the period is spent. |

### Asking a running deploy

**`GET /api/ai` is the one to open.** All three providers, one URL, from a
browser, a phone or `curl` — no keys, no redeploy, no log dig:

```
curl https://YOUR-HOST/api/ai
```

```json
{
  "summary": "All 3 configured provider(s) are answering, but 1 is running degraded — see below.",
  "providers": {
    "voice": {
      "key": "ELEVENLABS_API_KEY", "configured": true, "ok": true,
      "degraded": true, "http": 401, "reason": "missing_permissions",
      "detail": "The panel HAS a voice — synthesis works and /api/tts is using a
                 premade voice. What is missing is casting…"
    },
    "transcription": { "key": "DEEPGRAM_API_KEY", "ok": true, … },
    "verdict":       { "key": "OPENROUTER_API_KEY", "ok": true, … }
  }
}
```

Note the `degraded` distinction. Listing voices and synthesising speech are
separate ElevenLabs permissions, so a key that fails the first can still pass
the second — the panel has a real voice, it just cannot cast a different one per
shark. Reporting that as FAILING while the sharks are audibly talking is how a
diagnostic teaches you to ignore it, so this endpoint synthesises two characters
of speech before deciding.

It reports whether each variable is set, whether the provider accepted it, and
the provider's own machine-readable reason when it did not — plus the OpenRouter
case that otherwise only surfaces at the first cold call, a valid key with no
credit left. No key material, not even a length. Cached for a minute, so it
cannot be used to generate load.

The individual routes still answer too: `GET /api/tts` adds voice count and
casting source, `GET /api/stt` reports whether audio would leave the device.

### Seeing it fail from inside the app

`/api/ai` is the *server*. It cannot tell you whether the app is reaching that
server — and in the shipped iOS and Android builds, which are static bundles
calling an absolute origin, that is a real and separate failure mode that a
browser tab never reproduces.

So when a feature falls back, an amber banner appears at the bottom of the
screen naming the feature, the status, and what to do about it. Tap it to
expand. It renders **only** when something has actually fallen back — a healthy
deploy shows nothing — and on the web `window.__novusAi()` prints the same
table.

⚠️ **Set `NEXT_PUBLIC_AI_DEBUG=0` before putting the app in front of players.**
The fallbacks are complete features and a twelve-year-old mid-pitch should not
be shown a warning about someone else's API key. It is on by default because
the failure it catches is one an operator cannot see any other way, and a
diagnostic nobody remembers to switch on is the same as no diagnostic.

---

## 3 · The one that sends a child's voice somewhere

`DEEPGRAM_API_KEY` is different in kind from the other two, and the difference
is worth stopping on.

`lib/ai/transcribe.ts` states precisely what leaves the device, and the UI
repeats it: **video never does**, and **audio does in exactly one case** — this
key being set. `/api/stt` reads the recording out of the request, forwards it,
and drops it. Nothing is written to disk, to Supabase, or to a log, and the
transcript is returned rather than kept.

What this repo cannot decide for you is what Deepgram does with it afterwards.
That is your project's own data-retention setting. **Turn it off** in the
Deepgram console before pointing this at players, or leave the key unset and
accept the browser transcriber — which is genuinely good enough to score
content on, and is what the app has always used.

Any screen that says "never leaves this device" is talking about video. With
this key set, it would be overclaiming about audio.

---

## 4 · What the model is and is not allowed to decide

`/api/pitch` gives the model exactly two things to return: **accepted or not**,
and **what the caller says back**.

It does *not* set the cheque, the dilution, the respect gained, or the investor
sentiment. Those come from the same difficulty table `resolveLocally()` uses in
`lib/ai/callers.ts`, so an accepted call pays identically whether a model or the
offline resolver answered it.

This is deliberate and load-bearing. `scripts/simulate.mjs` is the balance
harness and it never calls an endpoint, so any number a model invented here
would be a balance change no simulation could observe — in a codebase whose
`DO-NOT-TOUCH.md` says a balance shift is a real regression, not a rounding
error. Giving the model no arithmetic to do removes the failure mode instead of
monitoring for it. `npm run test:ai` asserts it: a model that tries to write
itself a 9999 cheque gets the table's number.

Brand Law 5 — *never score accent, pitch of voice, energy level, or speech
rhythm* — is in the system prompt as a paragraph of prohibitions, and repeated
as structured data in the request. Both are asserted by the tests, because
BUILD-PROMPT §B is explicit that the prohibition goes in the prompt text and not
just in our intentions.

---

## 5 · Cost, and the caps that bound it

These endpoints spend real money on your bill and are reachable by anyone who
can find them. Two limits apply to each, both configurable in `.env.example`:

- **per address, per 15 minutes** — sized so a class of thirty behind one school
  NAT does not trip it.
- **a hard daily ceiling across everyone** — the wallet's limit rather than a
  player's.

Being throttled degrades to the local fallback rather than to an error, so a
capped player loses a nicer voice and never a turn. That is what makes capping
aggressively safe.

⚠️ **Both caps need `SUPABASE_SERVICE_ROLE_KEY` to work at all.** The counter
lives in Postgres because the app runs serverless and an in-process counter is
per-instance; with no service role key there is no admin client, so the throttle
fails open and there is no cap. That is the local-development case. Said plainly
here because a limit you assume you have is worse than one you know you do not.

Other things that keep the bill down, already in place:

- `/api/tts` sends `cache-control: public, max-age=86400, s-maxage=604800`.
  Stock shark lines, Chair framing and the going-out line are fixed strings, so
  the same text in the same voice is the same audio and your CDN can keep it.
- The clients latch. A 501, 401, 404 or 429 marks the feature down for the rest
  of the session rather than re-asking once per spoken line.
- `temperature: 0.4` and `max_tokens: 400` on the cold call. Judging against a
  fixed rubric wants consistency, not surprise.

---

## 6 · Casting the voices

With no casting configured, `/api/tts` asks the ElevenLabs account which voices
it has and assigns each character a different one, deterministically — so five
sharks get five voices and marcus sounds like marcus every time.

That is a working default, not a good one. `lib/ai/voices.ts` carries the
direction each part needs — *"Low, unhurried, never raises it. The pause before
the number is the threat."* — and casting to it is a real improvement:

```
ELEVENLABS_VOICE_MARCUS=...
ELEVENLABS_VOICE_SERENA=...
ELEVENLABS_VOICE_DEV=...
ELEVENLABS_VOICE_LILY=...
ELEVENLABS_VOICE_VIKTOR=...
ELEVENLABS_VOICE_CHAIR=...
ELEVENLABS_VOICE_NARRATOR=...
```

Setting `elevenVoiceId` in `lib/ai/voices.ts` also works and takes priority —
the client sends it when present. The environment variables exist so casting
does not require a code change.

---

## 7 · Model ids

Defaults, all overridable:

| Variable | Default | Why |
|---|---|---|
| `ELEVENLABS_MODEL` | `eleven_turbo_v2_5` | The cheap tier. Latency matters more than timbre in a game that also prints every line on screen. |
| `DEEPGRAM_MODEL` | `nova-3` | Word timings and filler words, which the coach panel reports. |
| `OPENROUTER_MODEL` | `anthropic/claude-haiku-4.5` | Judging a two-minute pitch against a fixed rubric is not a frontier task, and the local resolver is a defensible answer when it fails. |

Override when a provider retires one. `npm run test:ai -- --live` tells you
whether the id you set actually resolves.

---

## 8 · The native apps

The iOS and Android builds are a static export with no server of their own, so
they call these routes at the real origin — the same path auth, sync and billing
already take through `apiUrl()` in `lib/native/origin.ts`. `NEXT_PUBLIC_API_ORIGIN`
must be the canonical host with no redirect in front of it; a 308 breaks the
CORS preflight and every call fails before it is sent.

Nothing extra is needed for the AI routes: `middleware.ts` matches `/api/:path*`
and already answers their preflights.

---

## 9 · Pointing a feature somewhere else

`NEXT_PUBLIC_TTS_ENDPOINT`, `NEXT_PUBLIC_STT_ENDPOINT` and
`NEXT_PUBLIC_PITCH_ENDPOINT` still work and still take priority. They are now
only for sending a feature somewhere *other* than this app's own route — a
shared voice cache, a school's own proxy, a different model gateway.

Unset, each client calls `/api/tts`, `/api/stt` and `/api/pitch` respectively.
That default is what makes setting a key sufficient on its own, and it is the
part that was missing.
