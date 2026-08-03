# Mobile fixes & the Chapter (enterprise) tier — the plan

This document does two jobs. First it restates the raw feedback as a precise,
actionable spec (the "enhanced prompt"), because the original was a phone-typed
stream of six bugs and one large feature. Second it breaks that spec into
ordered parts, each grounded in the actual code — root causes are named with
file and line where they are already known, and open product decisions are
listed at the end rather than silently guessed at.

Read `docs/DO-NOT-TOUCH.md` before starting any part. Nothing below opens the
engine; competitions in particular reuse the leaderboard tape rather than
touching `lib/engine`.

---

## The enhanced prompt

What was reported, restated as the spec each part implements:

> **Mobile quality (iPhone).**
> 1. The app is laggy on iPhone — interactions and scrolling stutter.
> 2. Sound effects don't play correctly on tap — late, missing, or at the
>    wrong volume.
> 3. The Tank's ambient music is far too loud on iPhone, drowning dialogue.
> 4. Tapping ADVANCE MONTH scrolls the page down unexpectedly.
> 5. Speech-to-text (Deepgram) is not transcribing pitches.
> 6. "PLAY FREE" starts a session with no account. Playing should require an
>    account. *(Product decision — see Part 4; the current behaviour is
>    deliberate, not accidental.)*
>
> **Chapter tier (schools & companies).**
> 7. An organisation can buy a licence through Stripe checkout. Paying makes
>    the buyer an **org admin**.
> 8. The admin invites students via per-student invite codes. Redeeming a code
>    at sign-up joins the student to the org and grants **chapter status**
>    (the existing `Entitlements.chapter` — Pro for the licence year).
> 9. The admin dashboard shows a roster: each student's **life count** (runs
>    remaining today + whether their company is alive or in Chapter 7), and a
>    drill-in with a summary of every action in their company — pitch
>    transcript, pitch video, investor feedback, and the shark panel Q&A.
> 10. Admins can create **competitions**: pick a metric (longest-lasting
>     company or highest peak valuation), set a duration, and every student in
>     the org is enrolled and notified automatically. When time expires, the
>     full leaderboard is shown with a podium animation for the top three.

---

## Part 0 — Reproduce and measure (half a day, do first)

Before fixing, capture the baseline so "feels very buggy" becomes numbers:

- Run `npm run audit:phone` (`scripts/audit-phone.mjs`) and keep the report.
- On a physical iPhone via Safari Web Inspector: record a timeline of
  (a) the play screen with the log grown to a full year, (b) opening The Tank,
  (c) the landing page. Note long tasks > 100 ms and dropped frames.
- Hit `GET /api/ai` on the production deploy. It reports which AI keys are
  set and whether the provider accepted them — this alone likely explains
  Part 3 (Deepgram).
- Verify each bug on device and note iOS version. The sound and scroll bugs
  have known root causes below; confirm rather than re-derive them.

---

## Part 1 — Sound on iOS: rebuild `lib/sound.ts` on the Web Audio API

**One root cause explains two reported bugs** (clicks wrong *and* Tank music
too loud).

`lib/sound.ts` plays cues through `HTMLAudioElement` and mixes with the
`volume` property (`a.volume = GAIN[cue] * MASTER`, lib/sound.ts:109). **iOS
ignores `HTMLMediaElement.volume`** — the property is effectively read-only on
iPhone; only the hardware rocker changes loudness. So on iOS every cue plays at
100%:

- `click` is authored at 0.16 × 0.55 ≈ 9% and plays at full blast.
- `tank-ambient` is deliberately ducked to 0.10 × 0.55 ≈ 5.5% "so dialogue
  always wins" — and plays at 100%. That is exactly "shark tank music way too
  loud". (Started at `components/SharkPanel.tsx:321`.)

Two secondary defects: `preload="none"` means the first play of each cue
fetches and decodes an mp3 on tap (late or dropped first click), and rapid
retriggers reset the same element (`currentTime = 0`) instead of overlapping.

**Fix — same public API, new internals.** Keep `play/startLoop/stopLoop/
stopAll/setMuted/isMuted/unlockSound` and the `Cue` union exactly as they are
so no call site changes:

1. One `AudioContext`, created lazily. `unlockSound()` (already called from
   the first real gesture) now also calls `ctx.resume()` — that is the iOS
   unlock.
2. Cues become decoded `AudioBuffer`s (`fetch` + `decodeAudioData`), still
   lazy, but after the unlock gesture warm the incidental band (`click`,
   `tab`, `activity`, `success`) in the background so the first real tap is
   never the first fetch.
3. Each play is a fresh `AudioBufferSourceNode` → per-cue `GainNode` → master
   `GainNode`. Gain nodes work on iOS; the existing `GAIN`/`MASTER` tables
   move over unchanged. Overlapping plays come free.
4. Loops (`tank-ambient`) are a source with `loop = true` held by cue name so
   `stopLoop` can kill it; give start/stop a ~250 ms gain ramp so the bed
   fades instead of popping.
5. Handle iOS interruptions (phone call, Siri, backgrounding): on
   `statechange` to `interrupted`/`suspended`, resume on the next gesture.
6. Keep the `novus:sound:v1` mute key; mute now sets master gain to 0 and
   suspends the context.

Files: `lib/sound.ts` (rewrite internals), `components/native/` only if the
context needs a nudge on app-resume events.

**Accept when:** on a physical iPhone, a click is quiet and instant on every
tap including the first; Tank ambient sits audibly *under* shark dialogue;
mute silences everything and survives reload; Android/desktop unchanged.

---

## Part 2 — ADVANCE MONTH must not scroll the page

**Root cause found: `components/LifeLog.tsx:19`.** Whenever `lines.length`
changes, the log calls
`endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })`.
On the phone the play screen is one scrolling document — masthead, books, then
the life log (`capacitor.config.ts` documents this) — so `scrollIntoView`
scrolls the *whole page* to the log's tail. Advancing a month appends lines,
so every tap of ADVANCE MONTH yanks the viewport down.

**Fix — scroll only when the reader was already at the tail:**

1. Track whether `endRef` is currently visible with an `IntersectionObserver`
   (or a `getBoundingClientRect` check at append time).
2. If the tail was in view before the append, keep the existing smooth scroll
   — the player is *reading the feed* and wants to follow it.
3. If it was not (the normal case when tapping ADVANCE MONTH beside the
   masthead), append silently. No scroll, no jump.
4. Respect `prefers-reduced-motion` by swapping `smooth` for `auto`.

Also audit the other `scrollIntoView` call sites found in the same sweep
(`components/SharkPanel.tsx:329` scrolls its own log — verify it targets the
panel's scroll container, not the document).

**Accept when:** tapping ADVANCE MONTH with the viewport at the masthead
leaves the viewport exactly where it was; a player who has scrolled to the
feed's end still sees new lines arrive and follow.

---

## Part 3 — Deepgram transcription: diagnose config, then harden

The client code is defensive by design — every STT failure silently degrades
to browser `SpeechRecognition` or typed text, so a broken key *looks like* a
worse transcriber rather than an error. The chain, in order of likelihood:

1. **`DEEPGRAM_API_KEY` unset (or unpaid/revoked) on the production deploy.**
   It is server-only, read by `app/api/stt/route.ts`. The client probes
   `GET /api/stt` first and sends nothing when `configured:false`
   (`lib/ai/transcribe.ts:79`). Check `GET /api/ai` — it names exactly this.
2. **The `sttDown` latch** (`lib/ai/transcribe.ts:60`): one 401/404/429/501
   disables STT for the whole session. Correct behaviour, but it means a
   single rate-limit trip at session start reads as "Deepgram doesn't work".
   Rate limits (`claimAiCall`) also need `SUPABASE_SERVICE_ROLE_KEY` set.
3. **Native origin**: the app is a static export; API calls go to
   `NEXT_PUBLIC_API_ORIGIN`, baked at build (`lib/native/origin.ts`). A
   redirecting host kills the CORS preflight — already documented there as a
   past incident. Confirm the baked origin is the canonical host.
4. The iOS recorder path is already correct — `lib/media/recorder.ts` probes
   `audio/mp4` fallbacks via `isTypeSupported` and the route forwards
   `audio.type`, so iOS AAC recordings are labelled correctly.

**Work items:**

- Fix the deployment config (likely the whole bug), and add the checklist to
  `docs/AI-SETUP.md`: key set → `GET /api/ai` green → one recorded pitch
  returns a server transcript (`reportLive("transcription")` fires).
- Soften the latch: let `429` expire after ~10 minutes instead of latching
  for the session; keep 401/404/501 latched (those genuinely don't heal).
- Surface state honestly in dev: `AiStatusBanner` already exists — make sure
  a latched STT shows there when `NEXT_PUBLIC_AI_DEBUG=1`.
- Extend `scripts/ai-test.mjs` to post a known fixture through `/api/stt`
  against a configured environment.

**Accept when:** on the production deploy, a spoken pitch on iPhone returns a
Deepgram transcript with word timings (visible as filler counts in the coach
report), and `GET /api/ai` shows the key accepted.

---

## Part 4 — Require an account to play (product decision, then a small change)

**Current behaviour is deliberate.** The whole persistence layer is
local-first: "A player who never makes an account still gets the whole free
game on this device" (`components/landing/AccountGate.tsx` header), PLAY FREE
calls `enter()` → `entryRoute()` (`lib/entry.ts`) with no identity check, and
migration `0004_accounts.sql` exists precisely to clean up after the *removal*
of forced anonymous accounts.

Requiring an account is therefore a product change with real trade-offs to
sign off (see *Decisions*, D1): more friction before first play, and accounts
for minors carry COPPA/consent weight the current design avoids by collecting
nothing. The engineering itself is small:

1. `PLAY FREE` (`components/landing/Landing.tsx:500` area) routes into
   `AccountGate` (which already handles sign-up, sign-in, Turnstile, and
   post-auth routing via `entryRoute()`), instead of calling `enter()`.
2. Gate the play surface: on mount, `/play`, `/found`, `/welcome` check
   `identity()` (`lib/cloud/auth.ts`) and bounce unauthenticated visitors to
   the landing gate. Client-side, because the native build is a static export
   (`middleware.ts` never runs there).
3. Keep localStorage as the cache it already is — this changes *who may
   enter*, not the persistence architecture.
4. Recommended middle path if D1 lands on "soft": guest play stays, but
   closing year 1 requires creating an account to continue. One gate, at the
   moment the player is invested.

**Accept when:** with the hard gate on, a fresh device cannot reach `/play`
without a signed-in account, and an existing signed-in player's flow is
unchanged.

---

## Part 5 — iPhone performance pass

No single root cause; a budget and a checklist. Target: no long task > 100 ms
on tap, steady 60 fps scroll on an iPhone 12-class device.

- **Sound rework (Part 1) is itself a perf fix** — mp3 fetch+decode on the
  main thread at tap time is jank at the worst moment.
- **Glass layers**: `backdrop-filter` blur is the most expensive paint on
  iOS. Count layers on the play screen; flatten or cheapen (opacity tint, no
  blur) below the top two surfaces on phone.
- **WebGL**: cap canvas DPR at 2 (`SharkCanvas`, `LandingSharkCanvas`),
  pause render loops when covered or off-screen, and verify the existing
  `useScrolling()` (`lib/scroll.ts`) gate is applied to every decorative
  loop.
- **LifeLog growth**: a year of play renders hundreds of rows. Windowing (or
  simply capping rendered history with a "show earlier" reveal) bounds the
  layout cost that makes late-year months feel heavier than early ones.
- **Framer-motion**: prefer `transform`/`opacity`-only springs; check
  nothing animates `filter` or layout on the advance path.
- Re-run `npm run audit:phone` and the Web Inspector timeline; keep the
  before/after numbers in the PR description.

---

## Part 6 — Chapter licences: Stripe → org → seats (the enterprise core)

The scaffolding already exists and is documented as waiting for exactly this:
`lib/monetization.ts` defines `CHAPTER_LICENCES` ($299 / 35 seats, $599 / 100
seats, yearly), `Entitlements.chapter` is already honoured everywhere via
`isPro()` ("a chapter seat is Pro for the year"), and `0003_billing.sql` says
chapter SKUs are deliberately absent until a **seat-code feature** exists.
This part builds that feature.

**Schema (new migration `0007_orgs.sql`):**

```
organizations   id, name, owner_profile_id → profiles, licence ('chapter_35'|'chapter_100'),
                seats int, stripe_subscription_id, subscription_status, current_period_end,
                cancel_at_period_end, created_at, updated_at
org_members     org_id, profile_id, role ('admin'|'student'), invite_id, joined_at
                — unique(profile_id): one org per account, matching the single
                  `entitlements.chapter` slot
org_invites     id, org_id, code text unique, label (e.g. student name), created_by,
                expires_at, redeemed_by, redeemed_at, revoked_at
```

RLS follows the 0003 pattern: browser reads only through narrow policies
(admin sees own org + members + invites; student sees own membership);
all writes go through routes on the service role. Codes are short, unambiguous
(no 0/O/1/l), generated server-side.

**Stripe:**

- Two new yearly recurring SKUs, env `STRIPE_PRICE_CHAPTER_35` /
  `STRIPE_PRICE_CHAPTER_100`, added to `lib/stripe/catalogue.ts` with the
  same refuse-on-mismatch guard against `CHAPTER_LICENCES` prices.
- `app/api/billing/checkout` grows an org variant: requires a signed-in,
  non-anonymous account (same rule checkout already enforces), creates the
  subscription checkout; webhook (`app/api/billing/webhook`) on completion
  creates the `organizations` row, seats from the SKU, buyer as `admin`
  member. Renewal/cancel/past-due events update `subscription_status`
  exactly as `billing_customers` does today; a lapsed org suspends every
  seat's chapter entitlement.
- Buy surface: an "For schools & teams" section on the landing pricing block
  (the copy for chapter licences already exists in `docs/STRIPE-SETUP.md`).

**Seats & chapter status:**

- Redemption: `/join/[code]` page + a code field in `AccountGate` sign-up.
  Server route validates code (unredeemed, unexpired, org active, seats
  remaining), writes `org_members`, and sets `entitlements.chapter =
  <licence id>` with the service role — the entitlement path the whole app
  already reads. On next sync the student's device shows chapter status.
- Seat count enforced at redemption time: `count(members where student) <
  organizations.seats`.
- Admin can revoke a code (pre-redemption) or remove a member (clears
  `entitlements.chapter`).

**Accept when:** a test-mode Stripe purchase produces an org with the buyer
as admin; a generated code redeemed at sign-up gives that account chapter
status (Pro features on, "chapter" visible where entitlements surface);
the 36th redemption on a 35-seat licence is refused with a clear message;
cancelling the subscription in the Stripe portal suspends all seats.

---

## Part 7 — Admin dashboard: roster, life counts, and the action record

**Surface:** new authenticated route group `app/org/` (web-first; admins use
laptops — the game app stays the game). Guard: membership row with
`role='admin'`.

**7a. Roster.** One row per student: display name, **life count** — runs
remaining today (mirror the `novus:runledger:v1` day counter into the synced
prefs so the server can read it) — company status (alive / Chapter 7), current
year and month, valuation, last active. All but the run ledger is already in
the synced `RunState`; this is a read model over existing sync data plus one
small addition to the prefs payload (`lib/cloud/sync.ts`).

**7b. The per-student action record.** "A summary of every action" already
exists as a data structure: the leaderboard **tape**
(`lib/leaderboard/recorder.ts` records every commit — choices, activities,
transfers, dismissals — and `lib/leaderboard/replay.ts` can re-derive the
whole company from it). Reuse it: for org seats, upload the tape incrementally
with the normal sync debounce, and render it in the dashboard as a
human-readable timeline. No engine changes, no second event system.

What the tape does *not* carry — pitch transcript, pitch video, investor
feedback, shark Q&A — becomes a new `org_pitch_archives` table plus Supabase
Storage for video:

```
org_pitch_archives  id, org_id, profile_id, run_ref, kind ('year_end'|'cold_call'),
                    transcript jsonb, feedback jsonb, panel_qa jsonb,
                    video_path text null, duration_s, created_at
```

Client-side: after a pitch resolves, an org-seat client (and only an org-seat
client, and only after consent — see 7c) posts the transcript/feedback/Q&A it
already holds in memory, and uploads the recorded blob to Storage. The shark
Q&A is captured from the `SharkPanel` exchange log at debrief time.

**7c. The privacy line — this is the hard part, treat it as scope, not a
footnote.** The app currently promises, in code comments *and on screen*:
video **never** leaves the device (`lib/ai/transcribe.ts` header), and audio
is sent "for transcription only, and is not stored by this app"
(`app/api/stt/route.ts`). 7b changes both, for org seats only. Required:

1. Org seats get an explicit, unmissable consent screen at enrolment ("Your
   school/organisation admin can see: your pitch recordings, transcripts,
   and feedback"), and a per-pitch indicator whenever capture is on.
2. Video upload is an **org-level setting, default off** — transcript-only
   dashboards are still most of the value. An org that turns it on owns that
   choice in its own agreement with its students.
3. Non-org players are untouched: the promises stay literally true for them,
   and every capture path is gated on `entitlements.chapter` + consent.
4. `lib/legal/documents.tsx` and the privacy policy get an org-seat section;
   `playerAge` continues never to leave the device (existing rule,
   `docs/LEADERBOARD.md` §9.4).
5. Retention: archives delete with member removal and with org deletion
   (cascade), plus a fixed horizon (e.g. end of licence year + 90 days).

**Accept when:** an admin sees the roster with live life counts; drilling
into a student shows the timeline, a transcript, feedback, and shark Q&A for
a completed pitch (video only when the org enabled it and the student
consented); a non-org account generates zero rows in any of these tables.

---

## Part 8 — Competitions

The two requested metrics are, verbatim, the two boards the leaderboard
system already defines (`docs/LEADERBOARD.md`): **Survival**
(`years_survived`, a.k.a. Still Standing — "longest lasting company") and
**Valuation** (`peak_valuation` — "highest valued company"). A competition is
a *scoped, time-boxed instance* of an existing board, so it inherits the
anti-cheat replay verifier for free.

**Schema (`0008_competitions.sql`):**

```
org_competitions        id, org_id, name, metric ('survival'|'valuation'),
                        starts_at, ends_at, status ('scheduled'|'live'|'ended'),
                        created_by, created_at
org_competition_entries competition_id, profile_id, best_value numeric,
                        run_ref, verified bool, updated_at
                        — upsert keeps each student's best verified result
```

**Flow:**

1. Admin creates a competition in the dashboard: name, metric, duration
   (start/end). Every current org student is enrolled automatically —
   "invites" = a **BeeMail** in-game letter (`components/phone/BeeMail.tsx`
   pattern) announcing it, plus a dashboard banner; no acceptance step.
2. While live: runs that finish (or year-closes that raise a peak) inside the
   window submit through the existing leaderboard submission path
   (`app/api/leaderboard/submit`) with an org-competition scope; the replay
   verifier validates the tape before an entry counts. Students see a
   competition card with the current standings and a countdown.
3. At `ends_at` the competition freezes (`status='ended'`; entries after the
   deadline are rejected server-side — never trust the client clock).
4. **Results screen** (game side, for students; mirrored in the dashboard):
   the full final leaderboard, and a podium animation for the top three —
   staged reveal (3rd, 2nd, then 1st), gold/silver/bronze treatment,
   `celebrate` cue, honouring `prefers-reduced-motion` with a static podium.
   Announced by a results BeeMail to every participant.

**Brand Law 4 guard:** competition placement is earned only — nothing about
competitions may touch `NEVER_PURCHASABLE` (score, survival, revives, board
position). Entries replay-verify exactly like the public board.

**Accept when:** an admin schedules a 1-week valuation competition; students
receive the BeeMail; qualifying runs appear on the scoped board while it is
live; entries stop at the deadline; the results screen shows the full order
with the top-three animation; the verifier rejects a tampered tape.

---

## Sequencing

| Phase | Parts | Ship as |
|---|---|---|
| 1 — Mobile stability | 0, 1, 2, 3 | Three small PRs (sound; scroll; STT config+hardening). User-visible fixes land this week. |
| 2 — Perf + gate | 5, 4 | Perf PR with before/after numbers; account-gate PR **after D1 is decided**. |
| 3 — Chapter core | 6 | Migration + Stripe + invites + redemption. Feature-flag the buy surface until tested in Stripe test mode end-to-end. |
| 4 — Admin dashboard | 7 | Roster first (read model over existing sync), then archives behind the consent work — 7c blocks 7b, by design. |
| 5 — Competitions | 8 | After 6/7; reuses their org membership and the leaderboard verifier. |

Rough sizing: Phase 1 ≈ 2–4 days. Phase 2 ≈ 2–3 days. Phase 3 ≈ 1 week.
Phase 4 ≈ 1.5–2 weeks (consent/privacy included). Phase 5 ≈ 1 week.

---

## Decisions needed before the relevant phase starts

- **D1 (blocks Part 4):** Hard account wall, or soft gate (guest play, account
  required to close year 1)? Hard wall adds sign-up friction for minors and
  conflicts with the app's stated local-first stance; soft gate converts at
  the moment of investment. Recommendation: **soft gate**.
- **D2 (Part 6):** Are two fixed SKUs (35/100 seats) enough for "companies",
  or is per-seat quantity pricing needed? Recommendation: ship the two
  existing SKUs first; Stripe `quantity` pricing can be added as a third SKU
  later without schema change (`organizations.seats` is already an int).
- **D3 (Part 7):** Is video capture worth its privacy surface in v1?
  Recommendation: ship transcript + feedback + Q&A first (org video **off**
  by default), add video once a real org asks and signs the consent story.
- **D4 (Part 8):** May admins run competitions with prizes? If prizes are
  ever real-world, placement must still be replay-verified and nothing may
  cross into `NEVER_PURCHASABLE` territory.
- **D5 (Part 6):** One org per account is assumed (matches the single
  `entitlements.chapter` slot). A student in two classrooms would need a
  join table change — confirm one-org is acceptable for v1.
