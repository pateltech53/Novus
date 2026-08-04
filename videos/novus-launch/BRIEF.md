---
workflow: product-launch-video
flow: automation
storyboard: no
message: "Novus makes you the founder — live every month of a startup, then defend the year on camera to a live shark panel."
destination: youtube
aspect: 1920x1080
language: en
length: 75s
angle: apple-introducing-reveal
audience: sim-game players and startup-curious viewers
narration: yes
VO_MODE: restructured
---

## Intent

An Apple-keynote-style "Introducing Novus" launch film. Novus is a BitLife-style
life sim for a *company*: time only moves when you tap ADVANCE, and a fiscal
year only closes when you pitch on camera to a panel of AI shark investors and
survive their questions. The film should feel like Apple's product introduction
videos the user referenced — dark, confident, reverent about the product:
floating glass panels in deep graphite-navy space, specular glassmorphism,
enormous centered typography, slow deliberate camera pushes, beat-timed
feature reveals, a calm assured narrator. Sell, not tour — but the evidence is
the real app: captured Novus screens featured inside the glass panels.

## Assets

- capture from http://localhost:3000 (the Novus Next.js app running locally) —
  real screens: the play masthead with the live 3D shark mascot, The Books
  ledger, the advance capsule, the pitch camera, the shark panel. Captured
  screens are the featured asset_candidates.
- public/shark/shark.glb — the live mascot; still renders of it may be used.

## Customizations

- Apple "Introducing …" grammar throughout: black/near-black open, single word
  reveals ("Introducing"), product name held alone on screen, feature montage
  in accelerating rhythm, quiet close on the lockup + one-line tagline.
- Glassmorphism as the film's material: frosted panes with a 1px specular top
  edge and inset hairline ring floating over the graphite-navy ground —
  this mirrors the iOS app's real Liquid Glass chrome.
- Brand laws respected inside the film: #FF6B00 appears only on the one action
  moment per scene (the ADVANCE capsule / CTA); solvency green #3DDC97 only on
  financial upside; prestige gold #FFC24B only for the year gate; alert red
  #FF3333 for filler words / damage. Figures set in IBM Plex Mono with tnum;
  display type Urbanist.
- Count-up / ledger-flip treatment on financial figures (runway, valuation).
- Deliver per-scene clips as well as the assembled film.

## Notes

- References (Apple "Introducing" films the user linked): youtube.com/watch?v=4SCjXcBeW1E,
  dPn3GBI8lII, t_LBECIQQqs, 5PPiXyAV-Ro — the grammar to mimic: dark stage,
  glass and light, few words, product as hero, no clutter.
- Real vocabulary only: burn rate, runway, dilution, Chapter 7 — no coins/XP.
- No invented metrics or testimonials (honesty law from the repo's design.md).
- Autonomous run: plan first (storyboard + per-frame prompts), then build the
  clips without pausing for approval.
