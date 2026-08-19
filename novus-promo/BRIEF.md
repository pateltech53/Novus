# BRIEF

workflow: general-video
flow: autonomous
storyboard: no

## Deliverable

- `novus-promo.mp4` — 1920x1080, 30 fps, 55s total. Local render.
- Second deliverable (composition only until the first render is approved): 1080x1920 vertical re-layout, `index-vertical.html` → `novus-promo-vertical.mp4`.
- No voiceover, no speech captions. Meaning carried by kinetic typography + product-UI mocks.
- Audio: `assets/music.mp3` slot is EMPTY (no licensed track in repo) → render silent, warn in summary.

## Brand system (hard constraints)

- Background: deep navy `#0A0F1E` (never pure black / white).
- Accent: `#FF6B00`, exactly one accent element per scene.
- Text `#F5F7FA`; secondary at 60% opacity.
- Font: Urbanist (self-hosted variable woff2 in `assets/fonts/`), 800 hero (-2% tracking), 500 support.
- Logo: no `novus-wordmark.svg` in repo → fallback per manifest: typeset "NOVUS" Urbanist 800, +8% letter-spacing.
- Mascot: `assets/shark.png` (converted from `public/sharks/viktor.webp`, transparent suited shark — the product's own art). Scenes 3 and 8 only.
- Copy tone: confident, lightly taunting. Banned words: revolutionary, seamless, empower, unleash.

## Asset resolution (manifest vs repo)

| Slot | Resolution |
| --- | --- |
| novus-wordmark.svg | missing → typeset fallback |
| shark.png | satisfied from repo art (`public/sharks/viktor.webp`, alpha verified) |
| ui-onboarding.mp4 | missing → HTML mock (industry tile card stack) |
| ui-pitch.mp4 | missing → HTML mock (webcam rect + 5 real shark avatars from `public/sharks/` + meters) |
| ui-books.mp4 | missing → HTML mock (4 stat cards, odometer digits) |
| ui-event.mp4 | missing → HTML mock (event card + two choices) |
| music.mp3 | missing → silent render + warning |
| QR | generated locally: `assets/qr-novuspitch.svg` → https://novuspitch.com |

## Timeline (hard cuts on beats; crossfade only into scene 8)

| Scene | Global | File |
| --- | --- | --- |
| 1 Cold open | 0–4 | compositions/s1-cold-open.html |
| 2 The taunt | 4–9 | compositions/s2-taunt.html |
| 3 Reveal | 9–13 | compositions/s3-reveal.html |
| 4 Start a company | 13–22 | compositions/s4-company.html |
| 5 Pitch the sharks (hero) | 22–32 | compositions/s5-pitch.html |
| 6 Run the numbers | 32–40 | compositions/s6-books.html |
| 7 Stakes | 40–47 | compositions/s7-stakes.html |
| 8 CTA | 47–55 | compositions/s8-cta.html |

## Motion language

- Entrances `expo.out` ~0.9s (word/line cascade: y+40, fade, blur 6→0). Exits `power2.in` ~0.3s. Nothing linear.
- Every scene: camera wrapper scales 1.00 → 1.04 across the scene.
- Product mocks inside 24px-radius device frames, soft orange glow, 3–5° tilt animating to flat.
- Max one idea on screen; >7-word lines split across beats.

## Known deliberate deviation

- Scene 8 CTA/QR dwell exceeds the 3.5s text cap — the URL + QR must stay scannable through the end card. All narrative scenes (1–7) respect the 1.2–3.5s dwell window.
