---
compositionId: bgm
duration_s: 10.24 # == audiomap.audio.duration_sec
canvas: { "w": 1080, "h": 1920, "fps": 30 }
mode: autonomous
style: # brand spine — bespoke Novus frame.md + tough meme layer (rev 2, user-directed)
  font: "Anton / Archivo Black / Bebas Neue (tough display) · Urbanist · IBM Plex Mono"
  palette: ["#050505", "#FF3333", "#E02020", "#FFFFFF", "#0A0A0A", "#FF6B00"]
assets: "assets/img/shark-photo.jpg (user's shark photo) · assets/img/scream-head.png (user's cutout, white bg removed, sticker halo kept) · assets/fonts · assets/sfx/bite.wav"
build_notes:
  [
    "one paused timeline per frame",
    "no remote assets — fonts self-hosted in assets/fonts",
    "USER DIRECTION rev 2: bite + swap to the Novus card at EXACTLY track 5.00s (energy-phase edge in audiomap); everything meme-collage before it",
    "SFX chomp moves to 5.00",
  ]
avoid:
  [
    "soft eases on word swaps — 0ms cuts only",
    "covering the shark's mouth with text once the head is in it",
    "orange anywhere except the fin in the closing lockup",
  ]
---

## Frame 1 — buildup

- src: compositions/frames/01-buildup.html
- duration: 5.0s
- span_sec: [0.0, 5.0]
- pacing: beat_cut
- mood: [tense, dark, aggressive]
- feel: spoken line over sparse snare ticks and two short rolls; the bass regime begins at the 5.0 energy-phase edge

### Groups

- **g1** — free_design
  - span_sec: [0.0, 5.0]
  - free_design:
      {
        dominant_system: "meme-collage dread: the user's real shark photo (open mouth, underwater) cover-fills a black stage and zooms in slowly and continuously the whole frame; the spoken line lands as huge RED tough-font words (Anton / Archivo Black / Bebas Neue, alternating per word) that REPLACE each other 1–2 words at a time on the snare anchors, 0ms swaps with a tiny punch; at 3.25 the user's screaming-head cutout FLASHES into the shark's open mouth (white flash frame + scale punch + screen shake), then the last words swap in above while the zoom keeps creeping; still from 4.43 to the cut",
        primitives: ["content-swap", "kinetic-letter-in", "flash-cut", "screen-shake", "dolly-zoom"],
        density_topology: "accumulate",
      }
  - anchors: [0.19, 0.65, 1.18, 1.93, 2.53, 3.25, 3.79, 4.16, 4.43] # snare/onset anchors from audiomap
  - copy: ["YOU", "CANNOT", "REASON", "WITH A", "SHARK", "(head flash)", "WHEN YOUR", "HEAD IS", "IN ITS MOUTH"]
  - notes: "Words are #FF3333 red on the darkened photo, centered in the upper third once the head occupies the mouth; SHARK (2.53) is the biggest hit. Head cutout lives inside the zooming photo wrapper so it tracks the zoom. Frame ends at zoom scale ~1.22 with head in mouth — frame 2 opens from exactly that state."

## Frame 2 — bite-cta

- src: compositions/frames/02-bite-cta.html
- duration: 5.24s
- span_sec: [5.0, 10.24]
- pacing: beat_cut
- mood: [aggressive, hype, elegant]
- feel: bass regime from 5.0, first heavy onset 5.46, kicks at 6.38/7.31/8.71, peak 9–10, hard stop 9.57 into tail silence

### Groups

- **g1** — free_design
  - span_sec: [5.0, 10.24]
  - free_design:
      {
        dominant_system: "THE BITE at track 5.00 = frame-local 0: crash-zoom INTO the shark's dark maw (same photo + head, continuing frame 1's end state) with violent shake, white flash by ~0.14 — the flash IS the swap to the Novus card: pure white world, tough RED Anton hook lines punching in on the kicks, then a 0ms clear into the fin-logo + NOVUSPITCH.COM lockup that locks on the hard stop and freezes",
        primitives: ["crash-zoom-in", "screen-shake", "flash-cut", "system-replace", "kinetic-letter-in", "negative-space-hold", "freeze-hold"],
        density_topology: "spike-then-settle",
      }
  - anchors: [5.0, 5.46, 6.38, 7.31, 7.73, 8.71, 9.57] # bite, first heavy onset, kick, kick, strong snare, kick, hard stop
  - copy: ["DON'T GET EATEN ALIVE.", "SIMULATE THE SHARKS.", "PERFECT YOUR PITCH FIRST.", "NOVUSPITCH.COM", "Practice before they bite."]
  - notes: "Hook lines are Anton, #E02020 red on white, huge, accumulating at local 1.38 / 2.31 / 2.73; 0ms clear at 3.71 → lockup (navy tile + orange fin + NOVUSPITCH.COM in black Anton + red mono tag 'Practice before they bite.'); 4.57 hard-stop pulse then frozen to 5.24. Chomp SFX at track 5.00 on track 12."
