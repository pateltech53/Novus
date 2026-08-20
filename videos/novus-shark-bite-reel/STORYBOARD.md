---
compositionId: bgm
duration_s: 10.24 # == audiomap.audio.duration_sec
canvas: { "w": 1080, "h": 1920, "fps": 30 }
mode: autonomous
style: # brand spine — bespoke Novus frame.md (repo design.md is the locked brand authority)
  font: "Urbanist / IBM Plex Mono"
  palette: ["#0B0E15", "#12151D", "#E2E4E9", "#FF6B00", "#FFFFFF", "#0A0A0A"]
assets: "assets/fonts (Urbanist, IBM Plex Mono woff2) · assets/sfx (bite chomp, whoosh) · Novus fin logo redrawn inline as SVG from public/icons/favicon.svg"
build_notes:
  [
    "one paused timeline per frame",
    "no remote assets — fonts self-hosted in assets/fonts",
    "track density arc: spoken line over sparse snare ticks + two short rolls (0–5.46) → bass drop with dense hihat fill (5.46–9) → peak (9–10) → hard stop 9.57, tail silence to 10.24",
    "SFX: bite chomp lands exactly at track 5.46s; riser whoosh may lead into it; mixed quiet under the edit audio",
  ]
avoid:
  [
    "generic slideshow",
    "saturated AI-dark-mode blue",
    "orange on more than one element per scene",
    "easing the bite — the snap is 0ms-hard",
    "gradients beyond one radial stage vignette",
  ]
---

## Frame 1 — buildup

- src: compositions/frames/01-buildup.html
- duration: 5.46s
- span_sec: [0.0, 5.46]
- pacing: beat_cut
- mood: [tense, dark, cinematic]
- feel: a spoken line over sparse snare ticks and two short rolls with silence gaps, coiling into a surge at 5.46

### Groups

- **g1** — free_design
  - span_sec: [0.0, 5.46]
  - free_design:
      {
        dominant_system: "cinematic shark-jaw tension stage — a stylized side-profile SVG shark head (Novus cartoon-investor gray-blue tones on graphite-navy n0 ground, one radial vignette) with its jaws open and a founder's head-and-shoulders silhouette between them; over the whole span the jaws creep wider and the camera pushes in slowly (continuous, smooth — the menace builds but nothing snaps yet); caption words of the spoken line pop on the snare anchors below",
        primitives: ["dolly-zoom", "kinetic-letter-in", "chromatic-pressure", "screen-shake"],
        density_topology: "accumulate",
      }
  - anchors: [0.19, 0.65, 1.18, 1.49, 1.93, 2.53, 3.25, 3.79, 4.43, 4.99] # snare onsets from audiomap events
  - copy: ["YOU", "CANNOT", "REASON", "WITH A", "SHARK", "WHEN", "YOUR HEAD", "IS IN", "ITS", "MOUTH"]
  - notes: "SHARK (anchor 1.93) is the scene's single orange-accent hero word; the accel-roll 3.79–4.43 may add a subtle jaw tremor / chromatic pressure; the last word MOUTH (4.99) holds alone as everything goes still for a beat before the drop — stillness before climax. Micro screen-shake only as tremor texture, never a full shake before the bite."

## Frame 2 — bite-cta

- src: compositions/frames/02-bite-cta.html
- duration: 4.78s
- span_sec: [5.46, 10.24]
- pacing: beat_cut
- mood: [aggressive, hype, elegant]
- feel: bass drop at 5.46 with dense hihat fill, kicks at 6.38/7.31/8.71, energy peak 9–10, hard stop 9.57 into tail silence

### Groups

- **g1** — free_design
  - span_sec: [5.46, 10.24]
  - free_design:
      {
        dominant_system: "drop → regime change: at 5.46 the shark BITES DOWN (jaws snap shut in one 0ms-hard hit — braam-punch scale slam + screen shake + white flash-cut); the flash IS the transition — the frame lands on a pure white world (system-replace) and becomes a bold black Urbanist CTA card; CTA lines punch in on the kicks, then the system clears to a final negative-space lockup: Novus orange fin logo + NOVUSPITCH.COM + a one-line tag, locking hard on the 9.57 hard stop and holding through the tail silence",
        primitives: ["braam-punch", "screen-shake", "flash-cut", "system-replace", "kinetic-letter-in", "negative-space-hold", "freeze-hold"],
        density_topology: "spike-then-settle",
      }
  - anchors: [5.46, 5.92, 6.38, 7.31, 7.73, 8.71, 9.57] # bite, flash settle, kick, kick, strong snare, kick, hard stop
  - copy: ["SIMULATE YOUR PITCH.", "PRACTICE UNTIL IT'S PERFECT.", "BEFORE YOU DO IT FOR REAL.", "NOVUSPITCH.COM", "Visit today"]
  - notes: "Bite at 5.46 (frame-local 0) is the one violent moment — jaws shut + shake + flash all inside ~5.92; from 6.38 the white CTA world is calm and smooth. CTA lines 1–3 accumulate on 6.38 / 7.31 / 7.73 in near-black #0A0A0A on #FFFFFF; at 8.71 the lines clear and the lockup lands (fin logo + NOVUSPITCH.COM — the scene's single orange element, #E85F00 on white); 9.57 hard stop = final 0ms lock/pulse + freeze-hold to 10.24. SFX: chomp at 5.46 on its own audio clip."
