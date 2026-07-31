# NOVUS — Intro film, generation prompt

Paste the **Prompt** block into Grok / Sora / Runway / Veo. Everything outside
that block is direction for you, not for the model.

---

## Before you generate

**Feed it the assets.** These already exist in the repo and will do more for
consistency than any adjective:

- `public/sharks/tank-set.webp` — the room. This is the hero shot; the film
  should return to this exact framing.
- `public/founder/male-5.webp`, `female-5.webp` — the founder in the tuxedo.
- `public/founder/male-1.webp`, `female-1.webp` — the founder in the hoodie.
  **The arc of the film is the distance between these two images.**

**One rule that matters more than the rest:** the shot list below is 46 seconds
of *specific* images. Vague prompts produce vague film. If the generator drifts,
cut the prompt down to a single shot and generate them one at a time.

---

## Prompt

```
A 45-second cinematic product film for NOVUS, a business simulation game where
you run a company and defend it out loud to five investor sharks.

STYLE
Apple product-film restraint crossed with modern motion graphics. Shallow depth
of field, slow deliberate camera moves, no whip pans, no lens flares, no glitch
effects, no gaming clichés. Photoreal 3D characters — stylised cartoon sharks in
tailored suits, matte vinyl-toy surfacing, soft studio light. Everything else in
frame is real: wood, brushed metal, glass, paper.

PALETTE
Near-black graphite and deep navy. Warm tungsten practicals — desk lamps, a
single strip light under the desk, city windows behind. Exactly one saturated
colour in the entire film: a burnt orange (#FF6B00), used no more than three
times, always on something that means "act now". Everything else is neutral.
No blue-white gradients. No glow. No haze.

TYPOGRAPHY
Two faces only. A high-contrast serif for the three title cards. A clean
grotesk, small and tracked wide, for labels. Type is always locked to the frame
edge or dead-centre, never floating mid-air. No 3D text, no bevels.

SHOT LIST

0:00–0:04  Black. A single desk lamp clicks on in the dark, off-centre.
           Serif, small, low in frame: "Every company has a year it nearly died."

0:04–0:09  A young founder in a grey hoodie stands alone in a garage,
           lit by a laptop. Slow push in. They are rehearsing to nobody.
           Their lips move. No audio of the words.

0:09–0:14  Hard cut to a corridor. The founder walks toward a lit doorway,
           handheld, slightly behind them. We never see their face clearly.

0:14–0:20  THE DOOR OPENS. Wide, locked-off, symmetrical: five suited sharks
           seated behind a long dark-wood desk, city night behind them, the
           words THE TANK on the back wall. They look up in unison.
           Hold this shot. This is the image the whole film is for.

0:20–0:26  Rapid cuts, each 1.5s, each a tight close-up:
           – a shark's eye narrowing
           – a pen tapping a notepad, twice
           – a mug set down on wood, hard
           – a hand steepling
           No dialogue. Only room tone and these sounds.

0:26–0:32  Over-the-shoulder from behind the founder. A projected chart on the
           wall shows revenue climbing, then flattening. One shark leans
           forward into frame. Text, small, bottom-left: "They have read your
           numbers."

0:32–0:37  Insert: a valuation figure in tabular monospace on a clean dark card.
           It ticks upward, hesitates, ticks down, settles higher than it
           started. Nothing else moves in frame.

0:37–0:41  The founder — now in a tuxedo, same person, same posture — stands in
           the same doorway. Match cut with the earlier shot: identical framing,
           different clothes. This is the payoff. Hold it.

0:41–0:45  Return to the wide of all five sharks. One by one, four of them push
           a card forward across the desk. The fifth sits back and folds their
           arms. Cut to black on the fold.

0:45–0:50  Serif, centred, on black:
           NOVUS
           then, smaller, beneath it:
           "The Founder Run begins now."

AUDIO
A single upright bass note under the whole film, rising a semitone at 0:14 when
the door opens. Room tone: air handling, distant traffic, paper. Three diegetic
sounds only: the lamp click, the mug, the card sliding on wood. No voiceover.
No music sting at the end — let the last card land in silence.

DO NOT
No stock-corporate imagery. No handshakes. No rising bar charts as decoration.
No neon. No cyberpunk. No lens flares. No text that flies in. No aquarium, no
water, no ocean — the sharks are executives, not fish. Nobody smiles at the
camera.
```

---

## If you generate it in pieces

Best results come from generating **four clips and cutting them yourself**:

| Clip | Range | The one thing it has to nail |
|---|---|---|
| A | 0:00–0:14 | Loneliness. The garage has to feel small. |
| B | 0:14–0:26 | The reveal. Symmetry, and five heads lifting together. |
| C | 0:26–0:37 | Pressure. Tight, fast, no wides. |
| D | 0:37–0:50 | The match cut. Framing must be *identical* to clip A's doorway. |

Clip D only works if its framing matches clip A exactly — generate A first, then
feed a still from it as the reference for D.

---

## Where it goes in the app

Between the opening screen and the name field, skippable from the first frame.

Skippable is not optional. A player on their second run must never be made to
sit through it, and the skip control has to be visible immediately rather than
fading in after three seconds — the whole reason the current onboarding felt bad
was being made to wait.

Ship it as `public/intro.mp4`, H.264, under 6 MB, muted-autoplay-safe, with
`poster` set to the first frame so nothing pops.
