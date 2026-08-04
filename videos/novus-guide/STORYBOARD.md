---
format: 1920x1080
duration: 110s
message: "Here is how Novus works, from founding your company to surviving the year — one full life, screen by screen."
arc: Guided walkthrough — welcome → founding → the play screen → advancing a month → decisions → the books react → the year gate → the pitch → the sharks decide → year two or the lesson → close
audience: new and prospective Novus players; students and teachers evaluating it
mode: autonomous
music: calm warm minimal underscore, patient, apple tutorial feel
---

## Video direction

- **THE PAPER STAGE** — from `frame.md`'s "Novus guide addendum": ground `#FCFCFA` with a
  whisper-soft warm edge toward `#F2F0EC`; ink `#232019`, muted `#5F5C56`, hairlines
  `rgba(35,32,25,0.10)`. Captured app screens are THE heroes: shown LARGE (60–78% width)
  in soft-shadowed white cards (the addendum card recipe — flat fill, 14px radius,
  two-layer shadow, hairline). No glass, no dark grounds (the in-app Tank screens are
  content and appear as captured).
- **Chapter grammar**: every frame opens with a mono chapter kicker (`01 · FOUNDING`
  style, uppercase tracked, muted) that lands first, then the screen card arrives, then
  ONE callout at a time — a 2px ink rounded-rect outline (or soft `#E35F00` ring, max one
  orange per frame) drawn on (`svg-path-draw`) around exactly the region the VO names.
  Never two callouts visible at once: each fades to 30% as the next draws.
- **Accents** (addendum): action `#E35F00` once per frame max; solvency text `#0E9F6E`;
  gate gold `#FFB900` fills / `#B7791F` text; alert `#D92D20`. Figures mono tnum full ink.
- **Motion**: the launch-film doctrine unchanged — power3 long-tail settles, no bounce,
  VO-cued reveals, holds still. At most one slow push or pan per chapter; screen cards may
  pan/zoom to the region under discussion (`coordinate-target-zoom` / `viewport-change`),
  settling before the callout draws.
- **Rhythm**: chapters 8 (the pitch) and 9 (the sharks) are the emotional center — fewer
  callouts, longer holds. Chapter 11 is the quiet close.
- **Negative list**: no invented UI (only captured screens), no price/free framing, no
  cursors drawn on top of screens, no slideshow front-loading, no dark frame grounds,
  content in the top ~83%.

## Frame 1 — Welcome

- scene: The fin mark + "novus" lockup in ink on paper; the real play screen rises beside it as the guide names the premise; chapter kicker THE GUIDE.
- voiceover: "This is Novus — a life simulator for running a company. Let's play one full year, screen by screen."
- duration: 5.973s
- poster: 5s
- transition_in: cut
- status: outline
- src: compositions/frames/01-welcome.html
- type: product_intro
- persuasion: Orientation — what this video is and exactly what you'll see
- beat: welcome + promise
- blueprint: titlecard-reveal (Adapt — the calm opening card: lockup + one screen arrival; a guide's cover page, near-still)
- focal: assets/novus-mark.svg
- roles: novus-mark.svg = cutout (ink lockup, fin in ink — no accent spent here) · 04-play.png = supporting (the play screen rising at 40% width right, previewing the destination)
- sfx: chime

Scene 1 (0.0–2.5s): On "This is Novus", the mono kicker "NOVUS · THE GUIDE" lands upper-left; the ink lockup (fin + "novus" typeset) draws on center-left (`svg-path-draw`).
Scene 2 (2.5–5.5s): On "a life simulator for running a company", the sub-line reveals per-word beneath the lockup (muted); the play screen card (04-play.png, 40% width) slides up at the right third and settles.
Scene 3 (5.5–8.0s): On "one full year, screen by screen", the line "one full year. screen by screen." lands beneath in ink; hold.

narrativeRole: The cover — names the product, the premise, and the promise of the walkthrough.
keyMessage: This guide plays one full year of Novus.

## Frame 2 — Founding

- scene: The founding paperwork screens step through in one large card — blank form, "Marrow & Co" + industry picked, the company brief drafted — one step per VO cue; chapter kicker 01 · FOUNDING.
- voiceover: "You start by founding your company. Pick a name, pick an industry — and you begin in the garage, with twenty-five thousand in the bank."
- duration: 7.275s
- poster: 6s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/02-founding.html
- asset_candidates: assets/03-found-1.png — founding paperwork blank; assets/03-found-2.png — name typed + industry selected; assets/03-found-3.png — company brief drafted
- type: feature_showcase
- persuasion: Do-along — the first three screens the player will actually see
- beat: beginning + ease
- blueprint: device-surface-showcase (Adapt — stepwise-flow: one persistent screen card whose face steps through the three founding captures on the VO cues, lateral slides with persistent card chrome)
- focal: assets/03-found-2.png
- roles: 03-found-1.png = cutout (step 1 face) · 03-found-2.png = cutout (step 2 face) · 03-found-3.png = cutout (step 3 face)
- sfx: click-soft, typing

Scene 1 (0.0–2.6s): Kicker "01 · FOUNDING" lands; the large screen card (72% width, centered) rises with 03-found-1.png — the blank paperwork.
Scene 2 (2.6–6.2s): On "Pick a name, pick an industry", the face slides to 03-found-2.png (lateral slide, chrome persists); an ink outline draws around the name field, then fades as a second draws around the chosen industry tile.
Scene 3 (6.2–10.0s): On "you begin in the garage, with twenty-five thousand", the face slides to 03-found-3.png; a mono chip "GARAGE · $25K" pops beside the card (`spring-pop-entrance`, smooth) — figures tnum ink. Hold.

narrativeRole: Chapter one — founding is three screens and a minute of the player's time.
keyMessage: Name it, pick the industry, start in the garage with $25K.

## Frame 3 — The play screen

- scene: The play screen large and centered; callouts draw one at a time — mascot, the three rings, the ledger — exactly as the VO names them; chapter kicker 02 · YOUR COMPANY.
- voiceover: "This is your company. Your mascot, up top. Three rings — brand, quality, morale. And the books: cash, burn, runway, valuation. Real words — because they're real numbers."
- duration: 11.072s
- poster: 8s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/03-play-screen.html
- asset_candidates: assets/04-play.png — the play screen: mascot stage, stat rings, ledger, ADVANCE capsule, tab bar
- type: feature_showcase
- persuasion: Guided tour — the home screen decoded region by region
- beat: orientation + control
- blueprint: compose — the tour shot: one hero screen card held still while `coordinate-target-zoom` pushes gently toward each named region and an ink outline draws around it (one at a time, prior callout fading to 30%)
- focal: assets/04-play.png
- roles: 04-play.png = cutout (the hero screen, 76% width centered)
- sfx: click-soft, pop

Scene 1 (0.0–1.8s): Kicker "02 · YOUR COMPANY"; the play screen card rises to 76% width, centered, and settles.
Scene 2 (1.8–4.2s): On "Your mascot, up top.", gentle zoom toward the mascot stage (`coordinate-target-zoom`, ~1.12×); an ink outline draws around it.
Scene 3 (4.2–7.2s): On "Three rings — brand, quality, morale.", the view eases to the rings; the outline redraws there; three tiny mono labels step in under the rings one per spoken word.
Scene 4 (7.2–10.4s): On "And the books: cash, burn, runway, valuation.", the view eases to the ledger tiles; outline redraws; the four figures get a one-step emphasis in sequence (tnum ink).
Scene 5 (10.4–12.0s): On "Real words — because they're real numbers.", the view returns to 1× full card; all outlines gone. Hold.

narrativeRole: The home-screen tour — after this, the player can read their company at a glance.
keyMessage: Mascot, rings, and the books — the whole company on one screen.

## Frame 4 — Advancing a month

- scene: The real advance clip plays large: ADVANCE MONTH pressed, the month turning, the event card sliding in; chapter kicker 03 · THE MONTH.
- voiceover: "Time only moves when you move it. Press advance month — and the month happens: revenue comes in, burn goes out, and something lands on your desk."
- duration: 8.491s
- poster: 6s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-advance.html
- asset_candidates: assets/clip-advance.webm — ADVANCE pressed, JAN→FEB turning, the event card arriving
- type: feature_showcase
- persuasion: Show the loop working — the core mechanic on real footage
- beat: agency + rhythm
- blueprint: device-surface-showcase (Adapt — the clip IS the surface: one large screen card playing the real capture; a single ink outline draws around the ADVANCE capsule region on its spoken cue, then clears before the card arrives)
- focal: assets/clip-advance.webm
- roles: clip-advance.webm = cutout (the playing hero, 76% width centered; its first ~2s settling trimmed by starting its clip window late)
- sfx: click, whoosh-short

Scene 1 (0.0–2.2s): Kicker "03 · THE MONTH"; the screen card rises; the clip begins (window starts past its settling seconds).
Scene 2 (2.2–5.4s): On "Press advance month", the ink outline draws around the ADVANCE capsule region; the press happens in-footage; outline clears as the month turns.
Scene 3 (5.4–11.0s): On "revenue comes in, burn goes out, and something lands on your desk", the clip carries the story (the event card slides in on-screen); a muted line "the month happens to you" reveals beneath the card. Hold as the clip settles.

narrativeRole: The loop — advance is the heartbeat; every press is a month of consequences.
keyMessage: Time moves only when you press advance.

## Frame 5 — Decisions

- scene: The real decision clip plays large — "Price Tag Panic" read, choices weighed, one committed; chapter kicker 04 · THE CALL.
- voiceover: "Every month brings a scenario — a supplier squeezes, a rival copies, a critic calls. Each choice has a cost, and the game remembers. You decide — then you live with it."
- duration: 10.283s
- poster: 7s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/05-decisions.html
- asset_candidates: assets/clip-decision.webm — the decision card read, choices hovered, first choice committed; assets/07-decision-1.png — the Price Tag Panic card with tradeoffs
- type: feature_showcase
- persuasion: The stakes shown on a real card with real tradeoffs
- beat: weight + ownership
- blueprint: video-text-pivot (Adapt — the clip plays as hero; on "You decide" it eases aside a step and the line "you decide. then you live with it." lands in the opened space in ink; the clip keeps playing dimmed)
- focal: assets/clip-decision.webm
- roles: clip-decision.webm = cutout (playing hero, 72% width) · 07-decision-1.png = supporting (not shown — reference only, the clip covers it)
- sfx: click-soft, impact-bass-2

Scene 1 (0.0–2.6s): Kicker "04 · THE CALL"; the screen card rises with the decision clip playing — the card being read.
Scene 2 (2.6–7.6s): On "a supplier squeezes, a rival copies, a critic calls", three muted mono chips step in beneath the card one per cue; the clip hovers the choices in-footage.
Scene 3 (7.6–12.0s): On "You decide — then you live with it.", the card eases left a step and dims to 85%; "you decide. **then you live with it.**" lands right-of-center in ink, second phrase at weight 800. Hold.

narrativeRole: The calls — real scenarios with printed tradeoffs; the game's memory begins here.
keyMessage: Every choice has a cost, and the game remembers.

## Frame 6 — The books react

- scene: The post-commit screens: the ledger updated, then the life-log with "The Books move" deltas; a solvency-green and an alert-red delta called out; chapter kicker 05 · THE BOOKS.
- voiceover: "Watch the books after every call. Cash moves. Runway stretches — or shrinks. By month twelve, these numbers are your story."
- duration: 7.893s
- poster: 6s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/06-books.html
- asset_candidates: assets/07-decision-3.png — decision committed, ledger updated ($23K cash); assets/08-months-1.png — later-month event with the life-log deltas (Revenue +3%, Energy −2)
- type: feature_showcase
- persuasion: Cause and effect proven on the real ledger
- beat: consequence + literacy
- blueprint: comparison-split (Adapt — two screen cards side by side: the committed decision left, the months-later log right, mirrored gentle tilts flattening on arrival; the delta callouts pop at each card's inner edge on their VO cues)
- focal: assets/08-months-1.png
- roles: 07-decision-3.png = cutout (left card) · 08-months-1.png = cutout (right card)
- sfx: pop, sparkle

Scene 1 (0.0–2.2s): Kicker "05 · THE BOOKS"; on "Watch the books after every call.", the LEFT card (07-decision-3.png, 44% width) arrives from the left wing with a gentle tilt flattening.
Scene 2 (2.2–5.6s): On "Cash moves.", an ink outline draws around the updated cash figure; the RIGHT card (08-months-1.png) arrives mirrored; on "Runway stretches — or shrinks.", a `#0E9F6E` "+3%" chip and a `#D92D20` "−2" chip pop at the right card's delta lines, one per cue.
Scene 3 (5.6–10.0s): On "By month twelve, these numbers are your story.", both cards settle; the line lands centered beneath in ink. Hold.

narrativeRole: Financial literacy through play — the ledger is the diary of every call made.
keyMessage: The books are the story your decisions wrote.

## Frame 7 — The year gate

- scene: The gold CLOSE THE YEAR capsule, then the full "Pitch me" gate screen with its four beats; chapter kicker 06 · THE GATE.
- voiceover: "Then the year stops. To close it, you pitch — on camera. Sixty seconds: what you sell, who buys it, why you win, what you want."
- duration: 7.595s
- poster: 7s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/07-gate.html
- asset_candidates: assets/09-gate-button.png — month 12, the capsule turned gold: CLOSE THE YEAR; assets/09-gate.png — the year gate: Pitch me, the four beats, OPEN THE CAMERA
- type: feature_showcase
- persuasion: The rule stated on the real screens that enforce it
- beat: anticipation + gravity
- blueprint: device-surface-showcase (Adapt — two-screen step: the gold-capsule screen first, the gate brief second; the four beats get one shared outline sweep as the VO lists them)
- focal: assets/09-gate.png
- roles: 09-gate-button.png = cutout (first face — zoomed toward the gold capsule) · 09-gate.png = cutout (second face — the gate brief)
- sfx: typing, impact-bass-1, sparkle

Scene 1 (0.0–2.8s): Kicker "06 · THE GATE"; on "Then the year stops.", the screen card rises with 09-gate-button.png, gently zoomed toward the gold CLOSE THE YEAR capsule (`coordinate-target-zoom`); a `#FFB900` underline bar sweeps under a mono "MONTH 12" chip beside the card.
Scene 2 (2.8–6.0s): On "To close it, you pitch — on camera.", the face slides to 09-gate.png (the "Pitch me" brief), view at 1×.
Scene 3 (6.0–11.0s): On "what you sell, who buys it, why you win, what you want", one ink outline steps down the four beat rows, one row per spoken cue. Hold on the brief.

narrativeRole: The gate — the sim's signature rule on the screens that enforce it.
keyMessage: The year closes with a pitch, on camera.

## Frame 8 — The pitch

- scene: The real pitch clip: OPEN THE CAMERA, the live self-view, START TALKING, the REC timer running with the shark listening; chapter kicker 07 · THE PITCH.
- voiceover: "Your camera comes on. You talk. Novus listens — to your logic, your numbers, even your filler words. This is the part you can't skim."
- duration: 8.171s
- poster: 8s
- transition_in: blur-crossfade
- status: outline
- src: compositions/frames/08-pitch.html
- asset_candidates: assets/clip-pitch.webm — CLOSE THE YEAR → gate → camera live → REC running; assets/10-pitch-2.png — recording live with timer, coach line, typed pitch
- type: feature_showcase
- persuasion: The emotional center shown honestly — the camera, the clock, the listening room
- beat: focus + respect
- blueprint: device-surface-showcase (Adapt — the clip is the hero, larger than any other chapter (80% width); ONE callout only: an ink outline around the level meter/REC region on "Novus listens"; otherwise the footage carries everything)
- focal: assets/clip-pitch.webm
- roles: clip-pitch.webm = cutout (playing hero, 80% width; clip window enters at the OPEN THE CAMERA moment) · 10-pitch-2.png = supporting (unused fallback if the clip fails)
- sfx: riser
- 
Scene 1 (0.0–3.0s): Kicker "07 · THE PITCH"; the large screen card rises with the pitch clip at the gate → camera moment; no other elements.
Scene 2 (3.0–7.4s): On "Novus listens — to your logic, your numbers, even your filler words.", the single ink outline draws around the REC/level-meter region, then fades; the clip's timer runs.
Scene 3 (7.4–12.0s): On "This is the part you can't skim.", the line lands beneath the card in ink, and the frame holds — the guide's longest unbroken hold, the room listening.

narrativeRole: The heart — the camera moment shown for real, unhurried.
keyMessage: You talk; Novus listens to the words and the numbers.

## Frame 9 — The sharks decide

- scene: The Tank sequence: the five-shark room, a shark's question, the five offers with their math, the signed deal; chapter kicker 08 · THE TANK.
- voiceover: "Five sharks have read your books. They question you, they score you — and they decide. An offer, a pass, or a hard lesson."
- duration: 7.211s
- poster: 7s
- transition_in: crossfade
- status: outline
- src: compositions/frames/09-sharks.html
- asset_candidates: assets/11-panel-1.png — the Tank, Chair reads the ask; assets/11-panel-2.png — a shark's question; assets/11-panel-3.png — five offers on the table with their math; assets/11-panel-4.png — offer selected, SIGN IT
- type: feature_showcase
- persuasion: The payoff — real offers with real math from a real playthrough
- beat: drama + verdict
- blueprint: spatial-pan-stations (Adapt — the four Tank screens laid as stations on one wide canvas, traversed by lateral pans, one station per VO cue, landing held on the signed deal)
- focal: assets/11-panel-3.png
- roles: 11-panel-1.png = cutout (station 1) · 11-panel-2.png = cutout (station 2) · 11-panel-3.png = cutout (station 3, the offers) · 11-panel-4.png = cutout (station 4, SIGN IT)
- sfx: riser, impact-bass-2

Scene 1 (0.0–2.6s): Kicker "08 · THE TANK"; on "Five sharks have read your books.", station 1 (the room, 70% width) holds center.
Scene 2 (2.6–5.4s): On "They question you,", one lateral pan carries to station 2 (the question); on "they score you —", a small mono chip "SCORED /10" pops at its edge.
Scene 3 (5.4–9.2s): On "and they decide.", the pan carries to station 3 — the five offers; an ink outline draws around one offer's math line (amount ÷ equity = valuation).
Scene 4 (9.2–12.0s): On "An offer, a pass, or a hard lesson.", the final pan lands on station 4 — SIGN IT — and holds.

narrativeRole: The verdict — the room answers with money, and the math is printed on screen.
keyMessage: Five sharks question, score, and decide.

## Frame 10 — Year two, or the lesson

- scene: The debrief (scores + grade), the year-end statement (YEAR 1: SURVIVED), and Year 2 opening with the deal on the books; chapter kicker 09 · THE VERDICT.
- voiceover: "Survive, and year two begins — bigger stage, harder problems. Fail, and Chapter Seven is real. Either way — you learned by doing."
- duration: 8.171s
- poster: 7s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/10-year-two.html
- asset_candidates: assets/12-verdict-1.png — the Tank debrief: PITCH 6/10 · DEAL 7/10 · OVERALL B; assets/12-verdict-2.png — year-end statement: YEAR 1 SURVIVED, 5.8/10; assets/12-verdict-3.png — Year 2 begins, valuation with the deal on the books
- type: benefit_highlight
- persuasion: Honest outcomes — the real scorecard of the real playthrough
- beat: consequence + growth
- blueprint: device-surface-showcase (Adapt — three-screen step through debrief → statement → Year 2, one per VO cue; the SURVIVED badge gets the one outline)
- focal: assets/12-verdict-2.png
- roles: 12-verdict-1.png = cutout (face 1) · 12-verdict-2.png = cutout (face 2) · 12-verdict-3.png = cutout (face 3)
- sfx: chime, impact-bass-1

Scene 1 (0.0–3.4s): Kicker "09 · THE VERDICT"; on "Survive, and year two begins", the screen card rises with 12-verdict-1.png (the debrief grades), then slides to 12-verdict-2.png; an ink outline draws around the YEAR 1: SURVIVED badge.
Scene 2 (3.4–6.8s): On "bigger stage, harder problems.", the face slides to 12-verdict-3.png — Year 2 with the deal on the books.
Scene 3 (6.8–11.0s): On "Fail, and Chapter Seven is real. Either way — you learned by doing.", a muted line lands beneath: "chapter 7 is real. so is year two." — then "you learned by doing." in ink at weight 800. Hold.

narrativeRole: The outcomes — survival and failure both taught something; the loop begins again.
keyMessage: Survive to year two, or learn the hard way — both are the game.

## Frame 11 — Close

- scene: The paper stage clears; the ink lockup returns with the tagline and novuspitch.com typing in mono; the keyed mascot waves goodbye; chapter kicker THE END.
- voiceover: "That's Novus. Your company, your calls, your pitch. Learn by doing — at novuspitch dot com."
- duration: 5.611s
- poster: 6s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/11-close.html
- asset_candidates: assets/novus-mark.svg — the fin+wave brand mark; assets/mascot-waving-alpha.webm — keyed mascot waving
- type: cta
- persuasion: The sign-off — brand, tagline, one action
- beat: warmth + invitation
- blueprint: logo-assemble-lockup (Adapt — stage clears, the ink lockup draws on, tagline appends, URL types; the mascot waves in as the guide's goodbye)
- focal: assets/novus-mark.svg
- roles: novus-mark.svg = cutout (ink lockup) · mascot-waving-alpha.webm = supporting (keyed, lower-right, waves goodbye)
- sfx: whoosh-cinematic, chime

Scene 1 (0.0–2.4s): On "That's Novus.", the stage clears to plain paper; the ink lockup (fin + "novus") draws on dead-center.
Scene 2 (2.4–5.2s): On "Your company, your calls, your pitch.", the three phrases reveal beneath one per cue (muted, the last at full ink); the keyed mascot enters lower-right and waves.
Scene 3 (5.2–9.0s): On "Learn by doing — at novuspitch dot com", "learn by doing." lands in ink weight-800; "novuspitch.com" types in mono with a caret that blinks twice and stops; the ONE orange element — a thin `#E35F00` underline — sweeps under the URL. Hold to the end.

narrativeRole: The sign-off — the guide hands the company over to the viewer.
keyMessage: Your company, your calls — novuspitch.com.
