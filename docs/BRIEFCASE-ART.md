# Briefcase-system art pipeline

Generates every visual asset for the briefcase reward system — 101 skin
designs × 2 founders (Novus/Nova), the five briefcase tiers in three states,
keys, the Shark Token, avatar frames, the Skyline Corner Office backdrop, the
Trophy Lift pose pack, and the flat FX sprites (confetti, cursor spark,
Founder's Seal aura) — with Gemini's image API, and ships them into the repo
under `public/briefcase/` plus a `manifest.json` the app reads.

The full design spec lives in the briefcase system plan (§6 skin catalog,
§10 art direction, §11 generation plan). This doc is only what you need to
run the pipeline.

## One-time setup: the API key needs image quota

The Gemini API serves **image models only on billed projects** — a
free-tier key gets `429 … limit: 0` for every image model, and the scripts
abort with a pointer here rather than hammering the API. Fix once:

1. Open https://aistudio.google.com/ with the Google account behind the key
   → Settings → Plan → set up billing (or attach a billing account in
   https://console.cloud.google.com/billing).
2. `export GEMINI_API_KEY=…` — the key is only ever read from the
   environment. Never commit it.

Cost at Nano Banana Pro list price is ≈ $0.13/image → the full ~460-image
set (244 finals + base candidates + a 30–40% regen allowance) lands around
$45–75. `--model gemini-3.1-flash-image` quarters that for drafts.

## The run

```sh
# 1 · candidates for the two canon founders (6 each) — then LOOK at them
npm run art:briefcase -- bases
open .assets-staging/briefcase/bases/

# 2 · crown the keeper of each — this is the face of all 202 skin renders
npm run art:briefcase -- crown --base novus --pick 3
npm run art:briefcase -- crown --base nova --pick 5
git add assets-src/briefcase/canon   # the canons are part of the repo

# 3 · everything else (202 skins + 31 props + 11 sprites ≈ 45–90 min)
npm run art:briefcase -- all

# 4 · key, resize, encode, manifest, contact sheets
npm run art:briefcase:build

# 5 · QA the contact sheets (rubric below), regen the misses, rebuild
open .assets-staging/briefcase/sheets/
npm run art:briefcase -- skins --only 034,057 --force
npm run art:briefcase:build

git add public/briefcase && git commit
```

Every command is **resumable** — finished raw files are skipped, so a
quota blip or a killed terminal costs nothing. `status` shows progress:

```sh
npm run art:briefcase -- status
```

`--mock` runs the whole pipeline without network or quota (placeholder
PNGs) — that's how the plumbing is tested.

## Consistency rules (why the scripts are strict)

Character consistency across 200+ images is the entire ballgame, so the
generator enforces the plan's consistency kit:

- **Every request carries the style reference** — the Marcus Cole trophy
  render (`public/sharks/marcus.webp`), the image the whole toy style is
  extracted from. Skins and poses additionally carry the crowned canon
  founder render. This is non-negotiable and baked into the code.
- **Prompts are assembled, never hand-written.** Style/negative blocks are
  read verbatim from `assets-src/briefcase/style_v1.txt` /
  `negative_v1.txt`; only the outfit block (from `skins.csv`) varies.
  Editing a style file means regenerating every asset made after the edit —
  version the file (`style_v2.txt`) instead of editing in place.
- **One model per set.** The generator aborts on quota-zero rather than
  silently falling back to another model; a mid-set model switch is a
  visible seam in the catalog. Default is `gemini-3-pro-image` (best
  reference-following); resume on whatever model you started with.
- **Generate the set in one window.** Don't spread it across weeks — a
  model snapshot update mid-set shows.

## QA rubric (30 s per image on the contact sheets)

Face matches canon (eyes, brows, grin, hair) · proportions unchanged
(head:body ≈ 1:1.2) · outfit matches the spec's key items · silhouette
reads at 128 px · no extra limbs/props/text · background pure white ·
tier "expensiveness" ordering holds (every T5 out-shines every T4).
Expect a 20–30% regen rate; that's normal. Regenerate with
`--only <ids> --force`.

The build step also auto-QAs: raw files under 1000 px or with a border
less than 97% white are reported and skipped (they'd key badly). Ship
one anyway with `--lenient` if you must.

## Where things live

| Path | What | In git? |
|---|---|---|
| `assets-src/briefcase/` | style/negative blocks, `skins.csv`, `props.json`, `bases.json` | yes |
| `assets-src/briefcase/canon/` | the two crowned founder renders — the anchor of every skin | yes |
| `.assets-staging/briefcase/` | raw 1K generation masters, candidates, contact sheets, log | no (ignored) |
| `public/briefcase/skins/t{1–5}/{id}_{novus,nova}.webp` | keyed 640 px skin renders | yes |
| `public/briefcase/cases/{case}-{closed,glow,open}.webp` | keyed 1024 px briefcases | yes |
| `public/briefcase/keys/t{1–5}.webp` | keyed 640 px keys | yes |
| `public/briefcase/props/` | token, frames, backdrop, poses | yes |
| `public/briefcase/fx/` | flat FX sprites (confetti, spark, aura) | yes |
| `public/briefcase/manifest.json` | id → name/tier/rarity/urls; `urls: null` = art not generated yet, app shows the tier-colored placeholder card | yes |

The manifest lists the **entire catalog regardless of art state**, so the
reward system can ship before/while art streams in — `build` is safe to run
at any completion level and only ever fills nulls in.

Raw masters stay out of git (≈ 400 MB of PNG); the keyed webp set the app
serves is ≈ 25 MB and is the thing reviewers and the game actually use. The
two canon PNGs are committed because they are *inputs* — losing them means
never being able to extend the catalog consistently again.
