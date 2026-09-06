# Briefcases — the reward loop

Daily missions → a case whose tier you do not know → a ceremony → a wardrobe
identity. The design lives in the briefcase plan and build prompt; this is
what was built, where it lives, and what is not finished.

Everything is behind a per-account beta flag. Nothing below is reachable by a
player an operator has not switched on.

## Turning it on for someone

`/admin` → find the account → **BRIEFCASE BETA → TURN BETA ON**. Same band as
GIFT PRO and the same shape: a cell only an operator can write
(`entitlements.rewards_beta`), revocable in one tap. Every `/api/rewards/*`
route 404s for accounts without it — a feature that is off should not
advertise itself.

## The loop

| | |
|---|---|
| **Earn** | Complete one of the day's five missions. Everyone in the world gets the same five, recomputed from the date rather than stored. |
| **Claim** | The server rolls the tier and commits the case **before any animation plays**, so a browser that dies mid-ceremony has already banked it. |
| **Open** | Three taps, each of which might upgrade the case, then the reveal. |
| **Wear** | Skins land in MY SKINS; duplicates pay Shark Tokens instead. |

Two other things hand out cases. **Career milestones** — first deal, five
years, fiftieth pitch — are checked against the synced save on every visit, so
one earned offline or before the beta reached you is still waiting. And the
**token shop** sells a specific skin for tokens you earned, which arrives in a
case like everything else (rule 5) but through the short ceremony: the full
three-tap suspense is patronising on something you chose off a shelf.

### The 3 taps

Borrowed from Duolingo's chest, and it is **theatre over a decision already
made**. The final tier is rolled honestly from the published odds at claim
time; a start tier below it and the taps that pay are derived and stored on
the case. The client animates that path and cannot change it — a player who
skips the animation gets exactly the same case as one who taps all three.

The ground colour tracks the tier, so an upgrade repaints the whole screen.
That is what makes it feel like somewhere new instead of a label changing.

### The reveal

Borrowed from MadFut: silhouette → camera pull-back → the rarity in its own
colour → the name → a rising wave, and the card TURNS OVER onto the design.
Each beat answers one question in the order a player asks it — *is it good,
how good, what is it*. Legendary holds the screen 1.6× as long, gets the
loudest cue, and throws five times the confetti.

The card has two real faces with `backface-visibility`, rather than one card
spun 360°: a full spin passes through the mirror image, which is half a second
of backwards type at exactly the moment the player is finally reading the name.
Confetti is a canvas — one compositor layer instead of two hundred nodes, at
the point in the ceremony where a flip, a wash and a rising wave are already
running — and `prefers-reduced-motion` gets none of it.

## Where things live

| Path | What |
|---|---|
| `lib/rewards/tables.ts` | The published odds. **Ships to the browser on purpose** — §14.2 wants the rates visible in-app, and a second copy in a UI component is how a published table starts lying. |
| `lib/rewards/roll.ts` | Every random decision. Carries `server-only`, so a Client Component reaching for a tier roll fails the build. |
| `lib/rewards/daily.ts` | The deterministic day generator. Stores nothing. |
| `lib/rewards/templates.ts` | The 51 templates, the weekly pool, the lifetime milestones. |
| `lib/rewards/catalog.ts` | The non-skin reward pool. |
| `supabase/migrations/0017_rewards.sql` | Tables, RLS, and the RPCs that commit an open. |
| `supabase/migrations/0018_rewards_seed.sql` | **Generated** — `npm run rewards:seed`. |
| `components/rewards/Ceremony.tsx` | The taps and the reveal. |
| `components/rewards/CaseCanvas.tsx` | The rotating 3-D case. |
| `components/rewards/MySkins.tsx` | The collection, including what is not in it. |
| `components/rewards/BetaPanel.tsx` | The tester's shortcuts. |
| `components/rewards/TokenShop.tsx` | Spend tokens on a skin you picked. |
| `components/rewards/RewardsHome.tsx` | `/rewards` — today, vault, skins, shop, beta. |
| `components/rewards/ClosetRewards.tsx` | The same collection, inside the Closet. |
| `components/rewards/Confetti.tsx` | The burst. One canvas, not 240 divs. |
| `components/rewards/BetaAutopilot.tsx` | `/play?beta=tank` — drive a run to the panel. |
| `lib/rewards/progress.ts` | What a moment of play is worth, and which half of it is trusted. |
| `lib/rewards/report.ts` | The client end: batched, fire-and-forget, silent off-beta. |
| `lib/rewards/moments.ts` | Which activity counts as which moment. |
| `lib/rewards/latch.ts` | The two facts that have to survive between moments. |
| `app/api/rewards/*` | Twelve routes, all 404 without the flag. |
| `public/briefcase/models/*-v<n>.glb` | The eleven 3-D props — five cases, the Shark Token, five keys — from Meshy. Regenerated through `npm run art:models`; see [BRIEFCASE-MODELS.md](./BRIEFCASE-MODELS.md). |
| `components/rewards/PropCanvas.tsx` | The small turning prop (the coin beside a balance), and `fitToBox`. |
| `assets-src/briefcase/models.json` | The 3-D registry: slug, version, source art, prompts. |

## How playing moves a mission

There is no engine event bus — the build prompt assumed one. The sim is pure
TypeScript in the browser and what reaches the server is the SAVE. So the game
reports MOMENTS (`lib/rewards/report.ts`, batched, swallowing every failure)
and the server decides what they are worth.

The trust boundary is the interesting part, and it is written down in
`lib/rewards/progress.ts` rather than assumed:

- **`fromSave` facts** — the year reached, valuation, cash, net worth,
  industries played — are re-read from the synced save and the posted number is
  ignored. Lying means writing the lie into the save, which `/api/sync` already
  owns.
- **`fromEvent` facts** — a pitch score, a deal's equity — have no server-side
  record to check yet, so they are taken on trust and RATE-CAPPED per type per
  reward-day through a thin `reward_events` ledger. A pitch takes a minute;
  twenty in a minute is not a pitch.

Nothing hooks `lib/engine/*` or `lib/leaderboard/replay.ts`. The verifier
re-runs those same functions server-side, and a report inside one would fire
again for every tape it re-ran.

Two missions need a fact from an earlier moment — grow revenue year over year,
reject every offer then end the quarter cash-positive — and the engine keeps no
per-year history. Rather than grow the tape the verifier reads to serve a
cosmetic daily, the reward system remembers what it needs in `sessionStorage`
(`lib/rewards/latch.ts`). Nothing remembered reads as *not done*, never as a
win.

### Three templates the sim cannot answer

`F6` wants a loan paid off, `O9` a customer count, and `D8` originally named
one shark. The engine has no debt instrument, models market share rather than
customers, and keeps a single carried-across-runs respect number with no
per-shark opinion in it. F6 and O9 are behind flags — the same mechanism cold
calling already used — and D8 was rewritten to ask what the engine can
actually answer. A mission stuck at 0/1 until the reset is worse than one
fewer mission.

Cold calling is dark for a different reason: The Room shipped, but the activity
that opens it is Pro-only, and a daily a free account structurally cannot
complete is worse than one fewer too.

## Rules the code enforces, not just documents

1. **The client never rolls.** No table in 0017 has an INSERT or UPDATE policy
   for `authenticated`; every write goes through a `security definer`
   function on the service role.
2. **Nothing randomised is ever bought with money.** There is no code path
   from billing to a case. The token shop spends earned tokens only.
3. **No reward grants permanent Pro.** Trials only, 1/5/24 hours — asserted in
   TypeScript (`assertNoPermanentPro`) *and* as two SQL constraints, because
   the validator can be forgotten in a later seed and the constraint cannot.
4. **Opens are idempotent.** `open_briefcase` stores the payload it commits and
   replays it forever after; the roll is also seeded on the case id, so even a
   re-roll would agree. Two taps on bad wifi cannot pay twice.
5. **The tier is not leaked before the burst.** `/api/rewards/vault`
   deliberately does not select it.

## Testing

```sh
npm run test:rewards     # the acceptance criteria, runnable
npm run rewards:seed     # regenerate 0018 after editing templates/catalog/skins
```

`test:rewards` proves the parts that are statistical or structural and would
otherwise be eyeballed once: 10,000 claims per band land inside the published
odds, the floor rule is never violated, 60 days generate identically on
recompute with no template repeating inside two days, and 08:59 UTC still
scores yesterday.

For everything else there are the **beta tools** on a beta account — grant a
case at any tier, mark a mission done (the real claim path then runs), unlock
any of the 101 skins from a search box or any of the six Closet fits, add
tokens, reset the day, and autopilot a run to the year-end tank. A Gold case is
a 2.5% roll on the hardest daily; verifying the Legendary reveal by playing
honestly would take a fortnight and luck.

The autopilot is worth a note: it drives only the two controls a player has —
ADVANCE, and the first choice on a blocking card — and stops dead at the gate.
The pitch, the panel and the deal are the thing being tested and are never
automated, and because every tap goes through the same `advance`/`choose` the
screen uses, the tape it writes is one the leaderboard verifier accepts.

## Not finished

- **Four delivery templates stay dark.** P2, P3, P4 and P7 want filler-word
  counts, eye contact, pacing and a clarity score. `ContentScore` carries none
  of them, and inventing the numbers to light up a mission would be worse than
  the mission not appearing.
- **Weekly Challenge, Perfect Week, leaderboard prizes.** Seeded in 0018 and
  read by nothing yet.
- **Sound.** The ceremony reuses existing cues (`activity`, `bonus`, `unlock`,
  `celebrate`). The spec's seven bespoke SFX are not recorded.
- **32 skin renders** are still missing from the art set — see
  `docs/BRIEFCASE-ART.md`. The reveal falls back to a text card for a design
  whose file 404s, and MY SKINS shows the same gap as an unfilled silhouette,
  so nothing breaks; they are just not drawn yet.
