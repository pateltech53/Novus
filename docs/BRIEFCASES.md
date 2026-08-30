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
colour → the name → a rising wave hands over the card. Each beat answers one
question in the order a player asks it — *is it good, how good, what is it*.
Legendary holds the screen 1.6× as long and gets the loudest cue.

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
| `public/briefcase/models/*-v1.glb` | Five cases and the token, from Meshy. |

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
any of the 101 skins from a search box, add tokens, reset the day. A Gold case
is a 2.5% roll on the hardest daily; verifying the Legendary reveal by playing
honestly would take a fortnight and luck.

## Not finished

- **The event-bus reducer.** Nothing yet moves `daily_progress.progress` from
  real play — missions are completed through the beta tools only. Wiring
  `achievements.ts` onto the engine's existing event bus is the next piece,
  and it is what turns this from a demo into the loop.
- **Player-facing surfaces.** The Daily Challenges panel, the Vault tab and the
  reset countdown pill exist as APIs (`/api/rewards/daily`, `/vault`,
  `/time`) but have no screen yet; `MySkins` and `BetaPanel` are built and
  need a route to live on.
- **Weekly Challenge, Perfect Week, leaderboard prizes, the token shop.**
  Designed and seeded, not yet wired.
- **Sound.** The ceremony reuses existing cues (`activity`, `bonus`,
  `unlock`, `celebrate`). The spec's seven bespoke SFX are not recorded.
- **32 skin renders** are still missing from the art set — see
  `docs/BRIEFCASE-ART.md`.
