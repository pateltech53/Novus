# NOVUS — Onboarding explainer, generation prompt

This replaces the swipeable "how it works" cards (the ones with the dot pager).
Those screens are a slideshow of screenshots, and a slideshow cannot show the
one thing that actually needs showing: **that months are cheap and the year is
expensive.** That is a rhythm, and rhythm needs motion.

Different film from `INTRO-VIDEO-PROMPT.md`. That one sells the fantasy. This
one **teaches the loop** — it is the tutorial, and it has a job.

---

## Before you generate

**Length: 35 seconds.** Long enough for the loop to repeat once, which is the
whole trick — you cannot feel a rhythm you only see once.

**Feed it real UI.** Screenshot these at 390×844 and hand them in as reference:
`/play` (the Books + ADVANCE MONTH), a decision sheet, and The Tank. The film
should look like the actual app, not like an idea of it.

**The one thing it must land:** eleven taps are easy and the twelfth costs you
something. If a viewer comes away knowing only that, it worked.

---

## Prompt

```
A 35-second onboarding explainer for NOVUS, a game where you run a company for
a fiscal year and then defend it out loud to five investors.

STYLE
Clean UI motion graphics — Apple "how it works", Linear's changelog films,
Stripe docs animations. A phone-shaped frame held centred, screens moving
INSIDE it. The device never rotates, never floats in 3D, never gets a hand.
No stock footage. No people. No desks.

PALETTE
Warm off-white background (#F7F6F4). Real white cards with soft short shadows.
Near-black text. Exactly one saturated colour: burnt orange #E35F00, and only
ever on the button being pressed. The Tank section is the single exception —
it goes near-black, and that contrast IS the point of the film.

TYPOGRAPHY
One grotesk. Captions are four words or fewer, set bottom-centre, always in the
same spot so the eye never hunts. No sentences. No paragraphs.

SHOT LIST

0:00–0:03  Empty phone frame, off-white. A single card slides up: CASH $25K,
           BURN $2,000, RUNWAY 12mo. Caption: "This is your company."

0:03–0:12  THE RHYTHM. A finger-less tap ripple hits the orange ADVANCE MONTH
           button. The month counter ticks 1 → 2. Cash drops slightly.
           Repeat, faster each time: 2 → 3 → 4 → 5. By the fifth tap it is
           nearly a blur, and the runway number is visibly falling.
           Caption at 0:03: "Months are free."
           This section must feel LIGHT and quick. It is the setup.

0:12–0:18  A decision sheet slides over. Three choices. The cheapest one
           highlights, cash barely moves; then rewind and the expensive one
           highlights, cash drops hard and a second number rises.
           Caption: "Every choice costs something."
           Show the SAME decision twice with different outcomes. That is the
           lesson: there is no free option.

0:18–0:21  Back to the rhythm. Taps 6 → 11, fast. Then the counter hits 12 and
           the tap STOPS WORKING — the button greys, the ripple dies, a small
           lock appears. Hold one full second of nothing happening.
           Caption: "Then the year ends."
           This dead beat is the most important second in the film. Do not
           shorten it.

0:21–0:29  The frame goes near-black. THE TANK: five suited sharks behind a lit
           desk, seen head-on. A record dot appears. A small self-view thumbnail
           sits in the bottom-right corner. One shark leans forward.
           Caption: "You talk your way out."
           Slow this section right down — it should feel like the air changed.

0:29–0:33  A deal card slides in: $400K for 18%. Beneath it, an ownership figure
           counts DOWN from 100% to 82%. Caption: "Money costs ownership."

0:33–0:35  Cut back to off-white. The month counter resets to 1, the runway
           number is higher than it was. Caption: "Then you do it again."

AUDIO
Soft UI clicks on each tap, rising slightly in pitch as the rhythm speeds up.
Silence on the locked twelfth tap — total silence, no sound at all. A low room
tone under The Tank. No music. No voiceover.

DO NOT
No hands. No people. No cursor. No confetti. No numbers flying around. No
charts as decoration. Nothing bounces. No text larger than the UI it describes.
Do not show a score or a rating — that is not what this film teaches.
```

---

## Where it goes

Replaces the swipeable explainer inside onboarding, between the mic step and
the plans step.

- **Skippable from frame one.** Not after three seconds — immediately. Being
  made to wait is what made the current onboarding feel bad.
- **Muted by default** with captions burned in, because it will autoplay and
  because it must work on a bus.
- **Replayable** from Settings, so a returning player can find it again without
  starting a new run.

Ship as `public/onboarding.mp4`, H.264, under 4 MB, with `poster` set to the
first frame.

---

## If the generator will not hold 35 seconds

Generate the four beats separately and cut them — the transitions between them
are all hard cuts anyway:

| Beat | Range | Must nail |
|---|---|---|
| Rhythm | 0:00–0:12 | Accelerating taps. Light and cheap. |
| Cost | 0:12–0:18 | The same decision resolving two different ways. |
| Lock | 0:18–0:21 | The dead second. Silence, and nothing moves. |
| Tank | 0:21–0:35 | The contrast. Near-black, slow, heavier. |

The film only works if **Rhythm is fast and Tank is slow**. If they end up the
same tempo, the whole point is gone and it is worth regenerating.
