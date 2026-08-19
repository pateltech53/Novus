# Novus B2C Promo — scene-builder contract (v2)

Every scene file in `compositions/` follows this contract exactly. Deviations break the
master timeline, the seam gate, or the audio sync.

## 1. Sub-composition skeleton (copy verbatim, replace NN/name)

```html
<template>
  <div
    data-composition-id="scNN-name"
    data-width="1920"
    data-height="1080"
    data-duration="D"
    style="position: absolute; inset: 0; overflow: hidden; font-family: 'Urbanist', system-ui, sans-serif;"
  >
    <style>
      /* @font-face for Urbanist — copy the two blocks from any existing scene file. */
      /* All selectors class/id-based, prefixed .nNN- / #nNN- — NEVER style the root by class. */
    </style>
    <!-- full-bleed bg is a CHILD div, never on the root -->
    <div class="nNN-bg"></div>
    ...content...
    <script>
      window.__timelines = window.__timelines || {};
      (function () {
        const tl = gsap.timeline({ paused: true });
        // ... tweens at SCENE-LOCAL times (local 0 = global scene start) ...
        window.__timelines["scNN-name"] = tl;
      })();
    </script>
  </div>
</template>
```

## 2. Hard rules (each one has burned us before)

- Root element: NO class styling — inline style only (render scoping breaks root-class CSS).
- `@font-face` blocks must be inside the template's `<style>` (copy from sc02).
- Every id/class prefixed with the scene number (`#n04-card`, `.n04-w`) — cross-file
  collisions render images BLANK.
- Every `fromTo` whose element starts hidden MUST carry `autoAlpha: 1` (or an explicit
  opacity) in the DESTINATION vars (cold-seek restore).
- Initial hidden state via CSS `opacity: 0` + `fromTo { autoAlpha: 0 … }` — never a CSS
  `transform` on an element a tween also transforms.
- No `Math.random`/`Date.now`/network; no `repeat: -1` (compute finite repeats, floor).
- Animate only: opacity/autoAlpha, x, y, scale, rotation, color, backgroundColor,
  borderRadius, filter blur. No width/height/top/left tweens — use scaleX/scaleY on
  block-level SIZED elements (transform-origin set).
- Odometer/roll windows (`overflow: hidden` with content poking out) get
  `data-layout-ignore` on the window element.
- An element meant to cover others gets `data-layout-allow-occlusion` + starts
  `visibility: hidden` in CSS if it enters late.
- Never tween the same property on the same element in overlapping time ranges.
- `<video>` elements: `muted playsinline`, `class="clip"` + `data-start/duration/track-index`
  at SCENE-LOCAL times, as DIRECT children of the scene root only if they need clip
  timing — otherwise place untimed inside wrappers and control visibility via autoAlpha
  on a wrapper. Prefer the wrapper approach inside sub-comps.

## 3. Motion doctrine (per scene)

- NO idle wobble (no breathe/float/pulse loops). Every second must be owned by: staged
  reveals, camera-with-intent (mapped scale+pan travel), sequenced UI life (progress
  advancing, highlights stepping, counts ticking), or cursor-led action.
- Entrances: waterfall entry from below — y 40–70px, 0.10–0.20s per element,
  `power4.out`/`expo.out`, overlapping cascade (gaps shrink), BINARY opacity via the
  tween's autoAlpha 0→1 (fast, not a slow fade). Single entry ≤ 0.8s.
- Exits inside a scene: `power2.in`/`power4.in`, ≈75% of entry duration.
- Group repositioning: nudge curve — 3 chained tweens on one property:
  power3.in ~10% dist/20% time → linear ~65%/18% → power4.out ~25%/62%.
- Stillness before climax: 0.3–0.75s pause between a major action and its result.
- Forbidden: bounce.out, elastic.out. Overshoot = back.out(1.4–1.7).
- Rolling numbers: every stat animates via digit-column odometer (stack of 0-9 digits in
  an overflow-hidden window, tween y per column, expo.out, staggered) — never static.

## 4. Seam-adjacent constraints (the master timeline moves the WRAPPER)

- Local 0 is mid-seam: hold a COMPOSED opening frame — background + hero layout visible
  at local 0. First staged entrance no earlier than local 0.45.
- Scenes arriving via Z (sc02, sc04 push; sc06, sc11 pull): NO scale-based entrances in
  local 0–0.6 (the gate scans for sign-fighting). Position/opacity cascades from 0.5 ok.
- Last 0.4s: keep the frame composed; don't start new entrances after D−0.6. The wrapper
  carries the exit — do not author your own scene-wide exit.

## 5. Design tokens (copy into every scene's `<style>`)

```css
/* Light world (default) */
--paper: #f7f5f0;      /* stage / page  */
--card: #ffffff;       /* panels        */
--ink: #0b1e36;        /* primary text  */
--ink-60: rgba(11, 30, 54, 0.6);
--ink-40: rgba(11, 30, 54, 0.4);
--line: rgba(11, 30, 54, 0.1);
/* Dark world (reveal + tank only) */
--base: #0b1e36;
--surface: #152a47;
--text: #f8fafc;
/* Semantics — orange is the ONLY action color; green/gold/red are meanings */
--action: #ff6b00;     /* CTAs, XP, streaks, selection   */
--alert: #ff3333;      /* filler words, burn, Chapter 7  */
--solvent: #3ddc97;    /* revenue up, runway extended    */
--gold: #ffc24b;       /* IPO / prestige / level-up only */
```

Type: Urbanist. Hero 800 weight, letter-spacing −0.02em. Labels 700, +0.14–0.22em,
uppercase, --ink-60. Body 500. Vocabulary (use these words): The Founder Run, Today's
Market, Year End, The Books, burn rate, runway, valuation, Chapter 7, Still Standing,
FISCAL YEAR N. Voice: taunting coach, second person, short lines. Banned: revolutionary,
seamless, empower, unleash, coins, energy.

Light-world card language (matches the real app): white card, radius 20px,
border 1px var(--line), box-shadow 0 18px 50px rgba(11,30,54,.10); label row uppercase
--ink-60 19px; big value 800 --ink; orange pill CTA (radius 999, bg --action, text
white 800, padding 16px 34px).

## 6. Assets (paths relative to project root)

| Path | What | Size |
| --- | --- | --- |
| assets/app/play.webp | REAL app dashboard screenshot (Marrow & Co, Books cards, ADVANCE MONTH) | 640×1385 |
| assets/app/tank.webp | REAL app "Pitch me" gate screen | 640×1385 |
| assets/app/phone.webp | REAL in-game phone lock screen (shark wallpaper, MONTH 1 OF 12) | 640×1385 |
| assets/app/tank-set.webp | THE TANK set — 5 sharks at the judges' desk (cinematic still) | 1536×1024 |
| assets/shark.png | Suited shark mascot, transparent | 512×512 |
| assets/sharks/{viktor,serena,marcus,lily,dev}.webp | 5 shark avatars, transparent | 512×512 |
| assets/founder/*.webp | Founder avatars + skins (male-1, female-1, male-3, female-2, chef-female, coder-male, gamer-female, gymbro-male) | square |
| assets/tank.mp4 | Cinematic: 5 sharks at the tank desk (10s, 1168×768) | video |
| assets/choices.mp4 | Cinematic: shark at blackboard "Option 1/2/3" (10s, 944×960) | video |
| assets/months.mp4 | Cinematic: shark stomps the orange ADVANCE MONTH button (6s, 944×960) | video |
| assets/student-alpha.webm | Matted student pitching (11s, 760×1038, VP9 alpha) | video |
| assets/novus-fin.svg | Orange fin logo mark | vector |
| assets/qr-novuspitch.svg | QR → novuspitch.com (light modules — use on DARK panels only, or wrap in a navy tile on light scenes) | vector |

## 7. Audio sync (SFX already placed on the master timeline — hit these instants)

Scene-local event times each scene must land visually (global − scene start):

- sc04 (starts 22): founder card confirm 1.1 · industry select 2.7 · Today's Market card 4.2 · decision click 6.05 · numbers react (green up / red burn) 6.55 · XP tick 8.5
- sc05 (starts 32): phone unlock swipe 0.7 · ADVANCE MONTH stomp 2.75 · Books roll 4.4 · YEAR 2 chime 6.5
- sc06 (starts 40): question lands 0.15 (arrives with the pull) · stillness hold 1.2–2.4 · sub-line 2.4
- sc07 (starts 44): sting 0.05 · pitch UI panel pops 4.2 · eye-contact meter up (green) 6.6 · filler-word tick (red) 8.55 · score chime 10.15
- sc08 (starts 56): score card 0.4 · XP fill starts 1.3 · 100% FLASH 2.55 · FISCAL YEAR 2 unlock 4.3 · valuation roll 6.2
- sc09 (starts 64): zoom to ADVANCE MONTH, click 1.55 · "Pitch me" screen 3.1 · phone rotate 4.6
- sc10 (starts 70): montage cuts near 0.9 / 1.7 / 2.5 / 3.3 · pull-out from ~4.2
- sc11 (starts 76): "Stop studying business." at 0.5 · "Start playing it." 2.4 · lockup+CTA 3.6 · button press pulse 4.7 · hold from 6.0 · fade to black 7.5→8.0 (own overlay)

Scene text is ON-SCREEN COPY: short, punchy, ≤7 words per line.
