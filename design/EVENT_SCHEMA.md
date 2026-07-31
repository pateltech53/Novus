# Event conversion contract — NOVUS_EVENT_LIBRARY_B1.md → JSON

You are converting authored events from `design/NOVUS_EVENT_LIBRARY_B1.md` into JSON
conforming to the TypeScript types in `lib/engine/types.ts` (interface `GameEvent`).
**Read both files before converting.** The authored writing is final: `title`, `text`,
`reskins`, and any prose fragment that becomes `narration` are copied **verbatim** —
never paraphrased, never "improved". Only the mechanics are being encoded.

## Header line

`**E-OPS-001 · Supplier Price Hike · St1-4 · all · w8**` →
`id`, `title`, `stages: [1,2,3,4]`, `industries: "all"`, `weight: 8`.

- `St1-4` → `[1,2,3,4]`; `St2-5` → `[2,3,4,5]`; `St1` → `[1]`.
- Named industries (`GAMING/CONTENT/TOYS`) → `industries: ["GAMING","CONTENT","TOYS"]`.
  Codes: FOOD, ECOM, TECH, CONTENT, FASHION, GAMING, FITNESS, BEAUTY, EDTECH, SUSTAIN, TOYS, PET.
- `all (2× TECH/EDTECH/ECOM)` → `industries: "all"`, `weightMods: [{"industries":["TECH","EDTECH","ECOM"],"mult":2}]`.
- `w6 (2× weight if {ship_fast})` → `weight: 6`, `weightMods: [{"flag":"ship_fast","mult":2}]`.
- `once` → `once: true`. `req:{flag}` → `requiresFlags`. `x:{flag}` → `excludesFlags`.
- `req:{burnout_risk} or En<25` → `requiresFlags:["burnout_risk"]`,
  `requiresCond:[{"stat":{"key":"energy","lt":25}}]`, `reqAnyOf: true`.
- `category` from the id: E-OPS→OPS, E-PPL→PPL, E-FIN→FIN, E-MKT→MKT, E-PRD→PRD,
  E-CUS→CUS, E-RIV→RIV, E-LGL→LGL, E-LIF→LIF, E-OPP→OPP, K-*→K, E-MILE/L-section→MILE,
  industry pack events→IND, E-WLD→WILD.

## Effect shorthand → `Effect[]`

| Shorthand | JSON |
|---|---|
| `Cash −3S` | `{"stat":"cash_S","amount":-3}` |
| `Burn +0.5S/mo` | `{"stat":"burn_S_mo","amount":0.5}` |
| `Cash +2S/yr` | `{"stat":"cash_S","amount":2,"perYear":true}` |
| `Rev −10% (2Q)` | `{"stat":"rev_pct","amount":-10,"durationQ":2}` |
| `Rev +6%` (unmarked) | `{"stat":"rev_pct","amount":6,"durationQ":2}` — DECISION KNOB default |
| `GM −3` | `{"stat":"gm_pt","amount":-3}` (permanent) |
| `Qual −5 (2Q)` | `{"stat":"qual","amount":-5,"durationQ":2}` |
| `then GM +2` (after a 2Q dip) | `{"stat":"gm_pt","amount":2,"afterQ":2}` |
| `Brand −15 (d)` | `{"stat":"brand","amount":-15,"delayed":true}` |
| `Mor +5` / `En −8` / `CSAT +3` / `Churn +2` / `Emp −2` / `Val −40%` / `Resp +2` / `Share +1` | `morale` / `energy` / `csat` / `churn_pt` / `emp` / `val_pct` / `respect` / `share_pt` |
| `CTR +2` / `CAC −` / `CWP +` | `ctr_pt` / `cac_pt` (CAC − means acquisition got cheaper → `{"stat":"cac_pt","amount":1}`; CAC + worse → −1) / `cwp_pt` (+ → 2, − → −2 when no number given) |
| `Risk+` `Risk++` `Risk+++` | `{"stat":"risk","amount":1|2|3}` (− likewise negative) |
| `TDebt+` `SupLoy+` `InvSent −` `TeamLoy++` | `tdebt` / `suploy` / `invsent` / `teamloy`, ± count |
| `dilution 30%` / `dilution tiny` | `{"stat":"dilution_pct","amount":30}` / `amount: 1` |
| `{flag}` | `setFlags:["flag"]` · `clears {flag}` → `clearFlags` |

Bare `+`/`−` with no number on a 0–100 stat → amount 2/−2. On hidden stats → 1/−1.

## Choices

`A) Absorb it → GM −3 | SupLoy+ {supplier_loyal}` →

```json
{ "label": "Absorb it", "known": "GM −3",
  "outcome": { "effects": [{"stat":"gm_pt","amount":-3},{"stat":"suploy","amount":1}],
               "setFlags": ["supplier_loyal"] } }
```

`known` = the visible tradeoff string shown on the card: the **primary numeric effects
only**, joined with " · " (e.g. `"Cash −1S · Qual −5 (2Q)"`). Never put flags, hidden
stats, probabilities, or delayed effects in `known` — those stay hidden. For a pure
gamble write the authored hint if present, else omit `known`.

### Probabilistic splits
`60% Brand +8, CTR +2 / 40% dud {influencer_burn}` →
```json
{ "label": "Big name", "branches": [
  { "weight": 60, "outcome": { "effects": [{"stat":"brand","amount":8},{"stat":"ctr_pt","amount":2}] } },
  { "weight": 40, "outcome": { "setFlags": ["influencer_burn"], "narration": "A dud." } } ] }
```
Weights must sum to 100. Prose fragments inside a branch ("they find the warts")
become that branch's `narration`, verbatim. Do not write new prose.

### Conditional splits
`if Brand ≥60: Rev −2%; else Rev −9%` →
```json
"branches": [
  { "cond": { "stat": {"key":"brand","gte":60} }, "outcome": { "effects": [{"stat":"rev_pct","amount":-2,"durationQ":2}] } },
  { "fallback": true, "outcome": { "effects": [{"stat":"rev_pct","amount":-9,"durationQ":2}] } } ]
```
`+3 if {treated_team_well}` style uses `"cond": {"flag":"treated_team_well"}`.
A choice gated on a flag (`req:{clean_books}: …`) → `requiresFlag` on the **choice**.

### PERFORM choices
`B) Renegotiate [P:nego] ✓ GM −1, Brand +2 ✗ they drop you: Rev −10% (2Q)` →
```json
{ "label": "Renegotiate", "perform": { "type": "nego",
    "pass": { "effects": [{"stat":"gm_pt","amount":-1},{"stat":"brand","amount":2}] },
    "fail": { "effects": [{"stat":"rev_pct","amount":-10,"durationQ":2}],
              "narration": "They drop you mid-call." } } }
```
Pass = score ≥6 unless the text states otherwise (`passScore`). `[P:pitch-to-press]`
→ type `"pitch"`. `[P:allhands-lite]` → `"allhands"`.

- `[P:media only]` on the event line (no A/B/C) → event-level `performOnly`, no `choices`.
- `[P:media optional] … · or decline → nothing` → `performOnly` with `"optional": true`.
- Narration-only beats (E-PPL-018: no choices, automatic reward) → `auto: { effects…, narration }`,
  and the shark line goes in `narration` verbatim.

## Specials — mechanics beyond the stat vocabulary

Use `special` tags (strings) when the authored effect is a mechanic, not a stat:
`"arm_chain:K-TEC"` · `"chain_odds:K-SUP:2"` · `"autopsy_magnet"` ·
`"immunity:supply_crisis"` · `"impair_choices:3"` · `"unlock:pivot_lite"` ·
`"teamloy_max"` · `"insurance_halves_damage"` · `"merger_arc"` ·
`"event_odds:<eventId>:<pct>"` (a future event armed at N%).
If nothing fits, coin a terse `snake:args` tag — the validator lists unknown tags for
engine follow-up; nothing may be silently dropped.

## Chains (section K)

Each step is its own event: `chain: {"id":"K-SUP","step":1}` and the step-1 choices'
outcomes carry `followupId` (next step) + `followupDelayYears: 0` when the next step
"is drawn a day apart". Gating between steps uses flags set by the earlier step.

## Rookie terms

`Rookie: [gross margin] [CAC]` → `rookieTerms: ["gross margin","CAC"]`.

## Hard rules

1. Never rewrite authored prose. `text`, `title`, reskin lines, narration fragments,
   shark quips — verbatim, including punctuation.
2. Every event in your section must appear in the output exactly once, id verbatim.
3. No dominant choices exist in the source; do not "balance" anything.
4. Money stays in S units. Never expand to dollars.
5. Output strictly valid JSON. No comments, no trailing commas.
