# BRIEF — v2 (B2C teen ad)

workflow: general-video
flow: autonomous
storyboard: yes (STORYBOARD.md — plan of record; ledger.json — seam plan)

## Deliverable

- `novus-promo.mp4` — 1920×1080, 30 fps, 84 s, WITH full sound design. Local render.
- This supersedes the v1 dark kinetic-type cut (kept in git history).

## What changed from v1 (user feedback)

- SOUND: synthesized 120 BPM electronic bed (`scripts/make-music.mjs` → `assets/music.mp3`,
  fully licensed — authored in-repo) + ~50 placed SFX (real app sounds from `public/sfx/`
  + the media-use bundled library).
- LIGHT-FIRST: warm paper `#F7F5F0` world per Brand Identity v2; navy is spent only on the
  brand reveal and the tank act.
- REAL APP everywhere: real screenshots (`public/landing/*.webp`), real character footage
  (`public/onboarding/*.mp4`), the five shark avatars, the tank set still, founder avatars.
- The supplied student pitching footage is background-removed locally
  (`hyperframes remove-background` → `assets/student-alpha.webm`) and composited into the
  Novus pitch room.
- Search-engine cold open, 3D CSS laptop/phone product cinematography, camera-through-screen
  moves, rolling-number odometers on every stat, level-up/leaderboard progression, and a
  velocity-matched seam system (motion-doctrine ledger + seam-stamp + seam-gate, 10 seams,
  gate PASSED).

## Brand system (Brand Identity v2 PDF)

- Palette: `#FF6B00` action-only · `#0B1E36` base · `#152A47` surface · `#FF3333` alert
  (filler words, burn damage) · `#F8FAFC` text-on-dark · `#3DDC97` solvency green (financial
  upside only) · `#FFC24B` IPO gold (prestige only). Light world: paper `#F7F5F0`, white
  cards, navy ink.
- Urbanist; taunting-coach voice, second person, short lines; Founder Run vocabulary
  (Today's Market, The Books, burn rate, runway, Chapter 7, Still Standing).
- Banned words: revolutionary, seamless, empower, unleash, coins, energy.

## Structure

See STORYBOARD.md — 11 scenes on 2 s bar lines: search hook → reveal → devices →
gameplay loop → life-sim → mid-hook → the tank (student pitch) → level up → real-UI
montage → final build → CTA ("Stop studying business. / Start playing it." ·
novuspitch.com · Start your run).
