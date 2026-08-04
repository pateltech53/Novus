---
format: 1920x1080
duration: 45s
message: "You learn business by running one — Novus is the life sim where months advance on your decisions, real scenarios hit every month, and the year only closes when you pitch live sharks. Learn by doing."
arc: BAB (bike → lectures → Novus) into Feature-Benefit Cascade — bike hook → the lecture problem → introducing → advance months → scenarios → decisions remembered → the gate → pitching the sharks → learn by doing → lockup
audience: business students, educators, and startup-curious players
mode: collaborative
music: minimal confident cinematic tech underscore, slow build, apple keynote feel
---

## Video direction

- **THE WHITE STAGE (v3)** — from `frame.md`'s "Novus film addendum — THE WHITE STAGE":
  every frame ground is **white `#FFFFFF`** (optional whisper-warm edge `#F7F5F2`, never
  a visible vignette); text is **black ink `#111111`**, muted `#6B6864`, hairlines
  `rgba(17,17,17,0.10)`. This is an Apple promotional light piece. Panels are
  **soft-shadowed white cards** (elevation, not glass — the addendum's card recipe);
  device frames are near-black bezel cards (`#1A1918`, radius 34) — the one sanctioned
  dark element class. The ONE deliberate full-bleed dark exception is Frame 8's real
  TANK set photo (content, not a background color).
- **Accents on white** (addendum values): action `#E35F00` max ONCE per frame and only
  on the thing that asks; solvency text `#0E9F6E` (fills may use `#3DDC97`); prestige
  text `#B7791F` (fills/glows `#FFC24B`); alert `#D92D20`. Figures IBM Plex Mono tnum
  at full-strength ink. Kickers mono uppercase tracked `#6B6864`.
- **Motion grammar + reveal model**: unchanged — smooth long-tail settles, `power3`
  default, never bouncy; every piece reveals on its spoken cue across the back ~50%;
  holds read still, subtle jitter at most. Glow blooms are retired on white — emphasis
  is weight, scale, and shadow.
- **Rhythm / held frames**: Frame 8 (the tank) is the climax; Frame 9 ends on a genuine
  still; Frame 10 holds the lockup to the end. Everything else reveals to the VO.
- **Negative list**: no dark or navy frame grounds anywhere (the tank plate is the one
  content exception), no glass/backdrop-blur, no slideshow front-loading, no screensaver
  floaters, no bouncy defaults, no purple-blue gradients, no cursors, no invented
  metrics, no coins/XP vocabulary, **no "free"/price framing**, all content in the top
  ~83% of the canvas.

## Frame 1 — The bike

- scene: A thin black line-art bicycle draws itself on the white field beside the building line "you don't learn to ride a bike—"; on "watching videos", a small gray video-player card pops up and gets the red strike, not the bike.
- voiceover: "You don't learn to ride a bike — by watching videos of people riding bikes."
- duration: 5.5s
- poster: 3s
- transition_in: cut
- status: animated
- src: compositions/frames/01-bike.html
- type: hook
- persuasion: Universal analogy — a truth nobody argues with, planted before the product exists
- beat: recognition + curiosity
- blueprint: kinetic-type-beats (Adapt — the statement builds in beats, but the payoff element is drawn line art: the bike is the hero visual, the struck video-player card is the joke; keep the beat-chain → payoff signature)
- focal: none — line-art SVG + typography, authored in-frame
- roles: —
- sfx: click-soft, riser

Adapt: keep the beat-chain → payoff; the redesign (user feedback: the type-only version fell flat) gives the frame a drawn visual — a minimal single-stroke bicycle (two circles, frame lines, handlebar) self-drawing like an Apple line illustration.
Scene 1 (0.0–1.3s): White field. Left 55%: "you don't learn to ride a bike —" builds per-word (`dynamic-content-sequencing`, h1 ramp, black ink, lowercase, asymmetric 55/45). Right 45%: a thin-stroke black line-art bicycle **draws itself** (`svg-path-draw` — wheels sweep on, frame strokes connect, ~2.5px stroke) finishing as the line completes.
Scene 2 (1.3–2.9s): On "by watching videos", a small flat gray video-player card (rounded rect, play triangle, progress bar — `#F0EEEB` fill, hairline) pops up between the text and the bike (`spring-pop-entrance`, smooth), slightly overlapping the bike's front wheel — the wrong way to learn, literally in front of the bike.
Scene 3 (2.9–3.989s): On "of people riding bikes.", the alert-red strike (`css-marker-patterns`) draws through the VIDEO CARD (not the bike); the bike stays clean black. Everything settles dead still.

narrativeRole: Plants the film's thesis as a physical truth everyone already believes — before business is even mentioned.
keyMessage: Watching doesn't teach you to ride.

## Frame 2 — But that's how we teach business

- scene: Lecture-slide and video-player cards pile up around a small centered figure on the white field until they crowd it — the overwhelm of passive learning, in light gray.
- voiceover: "But that's how we teach business. Hours of lectures. Hours of videos. Watching — never doing."
- duration: 5.568s
- poster: 4s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-lectures.html
- type: pain_point
- persuasion: Pain agitation — the analogy turned on the viewer's own education
- beat: frustration + being buried
- blueprint: overwhelm-surround (Adapt — keep the accumulate-then-close-in signature; the surfaces are flat light-gray lecture/video cards with soft shadows on white; the center is a lone ink figure-dot labeled YOU)
- focal: none — reconstructed abstract surfaces
- roles: —
- sfx: notification, impact-bass-2

Adapt: same shot as the dark build, inverted to the white stage — cards are `#FBFAF8`/`#F0EEEB` fills with the addendum card shadow and hairline; card text lines are muted gray bars; ink accents only.
Scene 1 (0.0–1.8s): On "But that's how we teach business.", a small ink figure-dot with mono label "YOU" (`#6B6864`) alone dead-center on white.
Scene 2 (1.8–4.2s): On "Hours of lectures." lecture-slide cards spring in around the figure (`spring-pop-entrance`, staggered, soft shadows); on "Hours of videos." video-player cards join, progress bars filling (`stat-bars-and-fills`, gray fills) — 3 depth layers, overlapping, density past 60%.
Scene 3 (4.2–5.568s): On "Watching — never doing.", the cards CLOSE IN a step (the signature crowd-in), their shadows deepening slightly; the line "watching — never doing." lands in black h3 upper-third, "never doing." at full weight. Hold on the crowd.

narrativeRole: Turns the bike truth into the viewer's own pain — business education is watching, and watching was just proven not to work.
keyMessage: Business is taught by watching — hours of it.

## Frame 3 — Introducing Novus

- scene: The white stage clears; the fin mark draws on and "novus" typesets beside it — pure on white, no pane — and the keyed mascot waves in at the corner.
- voiceover: "Introducing Novus. A life simulator — for running a company."
- duration: 3.776s
- poster: 3s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/03-introducing.html
- asset_candidates: assets/novus-mark.svg — the real fin+wave brand mark; assets/mascot-waving-alpha.webm — mascot waving, background REMOVED (transparent webm)
- type: product_intro
- persuasion: Category announcement — the answer arrives with the brand's true mark, Apple-introducing grammar
- beat: relief + intrigue
- blueprint: logo-assemble-lockup (Adapt — the mark comes to exist directly on the white field: orange fin fills on, the wave draws through in INK `#111111` (white-on-white would vanish); wordmark typesets in ink beside it)
- focal: assets/novus-mark.svg
- roles: novus-mark.svg = cutout (the hero mark, no pane behind it) · mascot-waving-alpha.webm = supporting (keyed transparent cutout, lower-right, enters on "life simulator")
- sfx: whoosh-cinematic, chime

Adapt: cleared-stage → mark-draws-on, directly on white (Apple lockups sit on the field, not in a box). The wave stroke renders in ink `#111111` since white-on-white would vanish; the fin keeps its brand orange (this frame's one accent).
Scene 1 (0.0–1.0s): On "Introducing", the mono kicker alone, centered upper-third, `#6B6864`.
Scene 2 (1.0–2.2s): On "Novus", the fin mark draws on dead-center-left (`svg-path-draw`: orange fin path fills, ink wave strokes through) as "novus" typesets beside it in Urbanist 800 lowercase ink (`discrete-text-sequence`, no caret) — one lockup arrival, then still.
Scene 3 (2.2–3.3s): On "A life simulator", the sub-line reveals beneath per-word (`dynamic-content-sequencing`, lead ramp, muted); the keyed mascot (mascot-waving-alpha.webm, transparent, ≈14% width) enters lower-right and waves — clean over white, no visible box.
Scene 4 (3.3–3.776s): "— for running a company." completes at full ink. Holds; the mascot's wave is the only life.

narrativeRole: The name-drop with the correct mark — and the category: a life simulator you run, not content you watch.
keyMessage: Novus is a life simulator for running a company.

## Frame 4 — Months move when you do

- scene: The real play screen in a near-black bezel device on white; the ADVANCE capsule glows once, the months clip takes the face, the month ticker counts beside.
- voiceover: "Your company lives month to month. Nothing moves — until you press advance."
- duration: 4.437s
- poster: 3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-advance.html
- asset_candidates: assets/play.webp — real play screen render; assets/months.mp4 — months advancing motion clip
- type: feature_showcase
- persuasion: Show-don't-tell — the sim's one law demonstrated on the real interface
- beat: control + agency
- blueprint: device-surface-showcase (Adapt — static-tour; persistent hero device, tap lands on ADVANCE; identical machinery to the dark build, restaged on white with a bezel card instead of glass)
- focal: assets/play.webp
- roles: play.webp = cutout (the hero device face) · months.mp4 = supporting (takes the face on "press advance")
- sfx: click, whoosh-short

Adapt: same shot as the dark build, restyled — the device is a `#1A1918` bezel card with the addendum's card shadow; kicker and copy in ink/muted on white; the MONTH ticker in mono ink.
Scene 1 (0.0–1.4s): On "Your company lives month to month.", the bezel device (play.webp face, ≈20% width) slides up right-of-center (62/38); kicker "THE SIM" mono muted top-left; "months move **when you do**" line reveals left (ink, "when you do" muted).
Scene 2 (1.4–2.9s): On "Nothing moves —", deliberate stillness; the device's own orange ADVANCE capsule swells once, restrained (the frame's one accent, already in the screenshot).
Scene 3 (2.9–4.437s): On "until you press advance.", the capsule tap-compresses (`press-release-spring`) and the face swaps to months.mp4 (`scale-swap-transition`); beside it "MONTH 1 → 2 → 3" ticks in mono ink (`counting-dynamic-scale`, restrained). Holds.

narrativeRole: The sim's core mechanic — time is yours; the game runs on your decisions, not a clock.
keyMessage: Months advance only when you decide.

## Frame 5 — Every month, a scenario

- scene: The decision-card clip plays in the bezel device on white; pressure lines flank it with red ticks; the device slides aside and "you decide." types into the center in ink.
- voiceover: "Every month brings a real scenario. A supplier squeezes. A rival copies. You decide."
- duration: 5.696s
- poster: 4s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-scenarios.html
- asset_candidates: assets/choices.mp4 — decision card weighed and committed, motion clip
- type: feature_showcase
- persuasion: Concrete stakes — named problems, not abstract "challenges"
- beat: tension + ownership
- blueprint: video-text-pivot (Reproduce — the clip yields the frame to the typed line on "You decide."; same machinery as the dark build, restaged on white)
- focal: assets/choices.mp4
- roles: choices.mp4 = cutout (the playing hero clip inside the bezel device)
- sfx: click-soft, impact-bass-2

Scene 1 (0.0–2.4s): On "Every month brings a real scenario.", the bezel device (choices.mp4 playing) rises center; kicker "THE SCENARIOS" mono muted above.
Scene 2 (2.4–4.8s): On "A supplier squeezes. A rival copies.", two pressure lines flank the device (rule-of-thirds, h3, ink), one per cue, each with a small alert-red tick (`svg-path-draw`, `#D92D20`).
Scene 3 (4.8–5.4s): On "You decide.", the device slides aside left scaling to 0.8 (clip window ends at the pivot; the bezel carries a commit flash + drawn check as one event) and "you decide." types into the opened center in ink h1 (`discrete-text-sequence`, caret).
Scene 4 (5.4–5.696s): Caret blinks and stops; dead still.

narrativeRole: The sim's content — every month is a concrete business problem with the player's name on it.
keyMessage: Real scenarios, every month — and you decide.

## Frame 6 — The game remembers

- scene: Three white ledger cards assemble on the white field; figures flip on their cues — cash up in green, burn in ink, runway down with a red tick.
- voiceover: "And the game remembers. Every decision moves your numbers — cash, burn, runway."
- duration: 4.779s
- poster: 3s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/06-remembers.html
- type: feature_showcase
- persuasion: Consequence made visible — the honest both-directions ledger, no sugarcoating
- beat: weight + respect
- blueprint: grid-card-assemble (Adapt — live-populating data board; three soft-shadowed white cards, staggered assembly, post-assembly figure flips; same machinery as the dark build, restaged on white)
- focal: none — the ledger cards are built typography
- roles: —
- sfx: pop, sparkle

Adapt: cards use the addendum card recipe (white fill, soft shadow, hairline); labels mono muted; figures mono tnum — CASH counts up in `#0E9F6E`, BURN lands in ink, RUNWAY flips 12mo→9mo with a `#D92D20` tick and a short draining bar.
Scene 1 (0.0–1.6s): On "And the game remembers.", the line lands centered in ink h2; three empty white cards assemble beneath (`spring-pop-entrance`, staggered): CASH · BURN · RUNWAY.
Scene 2 (1.6–4.2s): On "Every decision moves your numbers —", the headline demotes; per cue each card's figure arrives and flips: cash $25K→$31K green count-up (`counting-dynamic-scale`); burn $2,000 ink; runway 12mo→9mo with the red tick (`stat-bars-and-fills`).
Scene 3 (4.2–4.779s): The cards hold; RUNWAY's label gets one restrained emphasis step. Still.

narrativeRole: The sim's memory — decisions are not multiple-choice trivia; they compound into the books you will defend.
keyMessage: Decisions move real numbers, both directions.

## Frame 7 — Month twelve stops the clock

- scene: A huge ink month counter ticks 01→12 on white and slams with a gold underline; the camera pushes through the digits into the real "Pitch me" gate screen in its bezel device.
- voiceover: "Then month twelve — stops the clock. To close the year, you have to pitch."
- duration: 4.032s
- poster: 3s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/07-the-gate.html
- asset_candidates: assets/tank.webp — the year-gate "Pitch me" screen render
- type: feature_showcase
- persuasion: The one rule stated as law — scarcity of passage
- beat: anticipation + weight
- blueprint: dataviz-countup (Adapt — the counted number IS the hero, camera pushes THROUGH it; counter in ink on white; the gold moment is a `#FFC24B` underline bar sweep + `#B7791F` gate line, NOT a glow)
- focal: assets/tank.webp
- roles: tank.webp = cutout (the gate screen inside its bezel device, the landing surface)
- sfx: typing, impact-bass-1, sparkle

Adapt: identical machinery to the dark build; the slam's gold bloom is replaced by a `#FFC24B` underline bar sweeping under the digits (`stat-bars-and-fills`) — gold as a fill, per the addendum; digits stay ink on white.
Scene 1 (0.0–1.2s): On "Then month twelve", the mono counter "MONTH 01" dead-center (stat-value ramp ~14cqw, ink, tnum) ticks 01→12 accelerating (`counting-dynamic-scale`).
Scene 2 (1.2–2.2s): On "— stops the clock.", the counter SLAMS at 12; the gold underline bar sweeps beneath the digits; a short dead-still beat.
Scene 3 (2.2–3.1s): On "To close the year,", the camera pushes THROUGH the digits (`multi-phase-camera` + `motion-blur-streak`); the gate screen (tank.webp in its bezel device, ≈18% width) arrives centered (inverse zoom-through seam).
Scene 4 (3.1–4.032s): On "you have to pitch.", the gate line "FISCAL YEAR 1 · THE GATE" reveals beneath in mono `#B7791F` word-by-word; the OPEN THE CAMERA capsule brightens once on "pitch". Holds.

narrativeRole: The twist — this sim has a gate no other sim has: the year is closed by a performance, not a menu.
keyMessage: The year doesn't close until you pitch it.

## Frame 8 — Pitching the sharks

- scene: The five-shark TANK plate fills the frame (the film's one dark moment — real set photography) under one slow push; the in-app pitch clip rides in a bezel device lower-left; focus pulls shark to shark.
- voiceover: "On camera. Out loud. To five sharks — who have read your books."
- duration: 3.669s
- poster: 2.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/08-the-tank.html
- asset_candidates: assets/tank-set.webp — five-shark TANK panel hero plate; assets/tank.mp4 — in-app pitch/tank motion clip
- type: feature_showcase
- persuasion: Authority confrontation — the pitch is shown happening, the judges are characters who know your numbers
- beat: awe + healthy fear
- blueprint: camera-journey (Adapt — sub-shape B cursorless flight; IDENTICAL to the dark build: one unbroken push, stacked blur/sharp plates for the rack focus, the hoisted pitch clip at static geometry in a bezel ring; the plate is the film's sanctioned full-bleed dark content)
- focal: assets/tank-set.webp
- roles: tank-set.webp = background (full-bleed hero plate — the one dark exception) · tank.mp4 = cutout (in-app pitch clip, bezel device lower-left)
- sfx: riser, impact-bass-2

Scene 1 (0.0–1.3s): On "On camera. Out loud.", the plate fills the frame, push already running; sharks soft (`depth-of-field-blur`); the bezel device rises lower-left with tank.mp4 cutting in; kicker "THE PITCH" in white mono (on the dark plate).
Scene 2 (1.3–2.7s): On "To five sharks —", the rack-focus sweeps left→right across the panel (stacked blur/sharp plates); the device dims a step but keeps playing.
Scene 3 (2.7–3.669s): On "who have read your books.", full-desk refocus; "they've read your books." reveals lower-center per-word in white h3; the push settles to stillness.

narrativeRole: The climax — the pitch itself, shown: your camera, your voice, their table.
keyMessage: You pitch on camera to five sharks who know your numbers.

## Frame 9 — Learn by doing

- scene: Back to the white field; "you don't learn business by watching." builds in ink and "watching" takes the red strike — then the tagline lands: "learn by doing." black on white, and holds.
- voiceover: "Because you don't learn business by watching. You learn — by doing."
- duration: 3.477s
- poster: 3s
- transition_in: crossfade
- status: animated
- src: compositions/frames/09-learn-by-doing.html
- type: benefit_highlight
- persuasion: Thesis closure — Frame 1's analogy cashed in as the brand's own law
- beat: clarity + conviction
- blueprint: kinetic-type-beats (Adapt — beat-chain → payoff; the strike bookend returns; tagline in ink at display ramp: "learn" 800 / "by" 400 muted / "doing." 800 at 1.2×; ends as the film's genuine still)
- focal: none — pure typography
- roles: —
- sfx: click-soft, impact-bass-1

Scene 1 (0.0–2.3s): On "Because you don't learn business by watching.", the line builds per-word centered (h2, ink, lowercase); "watching" dims to `#6B6864` and takes the thin `#D92D20` strike (the Frame-1 bookend).
Scene 2 (2.3–3.0s): On "You learn — by doing.", waterfall cut clears the struck line; "learn by doing." lands beat-by-beat (`kinetic-beat-slam`, restrained), all ink, "doing." at 1.2× weight-800.
Scene 3 (3.0–3.477s): Genuine stillness — no jitter, underscore thinned. The film's quietest moment.

narrativeRole: The thesis card — the bike, the lectures, and the sim resolve into three words the viewer keeps.
keyMessage: LEARN by DOING.

## Frame 10 — Lockup

- scene: The end-card chain on white: fin mark + "novus" in ink, the tagline beneath, the one orange START YOUR COMPANY pill, novuspitch.com typing in mono ink — held to the end.
- voiceover: "Novus. Learn by doing. Start your company — at novuspitch dot com."
- duration: 4.395s
- poster: 3.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/10-lockup.html
- asset_candidates: assets/novus-mark.svg — the real fin+wave brand mark
- type: cta
- persuasion: Identity close — the brand line is the ask, Apple end-card grammar, no price framing
- beat: inevitability + invitation
- blueprint: titlecard-reveal (Reproduce — appending card chain: lockup → +tagline → +CTA/URL, near-still, terminating held; same machinery as the dark build restaged on white — wave stroke and wordmark in ink, pill label ink `#111111` throughout)
- focal: assets/novus-mark.svg
- roles: novus-mark.svg = cutout (the mark in the lockup)
- sfx: whoosh-cinematic, chime

Scene 1 (0.0–0.9s): On "Novus.", the lockup draws dead-center on white: orange fin fills, INK wave strokes through, "novus" typesets in ink 800.
Scene 2 (0.9–2.0s): On "Learn by doing.", the tagline appends beneath (slide-up crossfade): ink, "by" muted.
Scene 3 (2.0–3.0s): On "Start your company —", the one orange element: a pill fills with `#E35F00` (`stat-bars-and-fills`) carrying "START YOUR COMPANY" in mono `#111111` — the label ink stays constant (it reads on both the white pill base and the orange fill).
Scene 4 (3.0–4.395s): On "at novuspitch dot com", "novuspitch.com" types beneath in mono ink with caret; two blinks, stop; the end card holds dead still to the final frame.

narrativeRole: The close — mark, tagline, one action. No price, no feature list; the name and the invitation.
keyMessage: Start your company at novuspitch.com.
