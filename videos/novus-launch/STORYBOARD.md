---
format: 1920x1080
duration: 75s
message: "Novus makes you the founder — live every month of a startup, then defend the year on camera to a live shark panel."
arc: Feature-Benefit Cascade (Apple-introducing) — hook → introducing → run it → live with it → the gate → the tank → stakes → free → lockup
audience: sim-game players and startup-curious viewers
mode: autonomous
music: minimal confident cinematic tech underscore, slow build, apple keynote feel
---

## Video direction

- **Palette system** (from `frame.md` + its Novus film addendum): the stage is deep brand
  navy `#0B1E36` with the licensed radial vignette (`#10263f` center → `#081527` edge);
  primary ink `#FFFFFF` / muted `#B9B6B1`; mono chrome (kickers, counters, URLs) in
  IBM Plex Mono uppercase tracked; **action orange `#FF6B00` at most once per frame** and
  only on the thing that asks (ADVANCE capsule, CTA); solvency green `#3DDC97` only on
  financial upside; prestige gold `#FFC24B` only for the year gate; alert red `#FF3333`
  only for damage/filler words. Captured light-UI screens appear ONLY inside glass-framed
  devices, never as frame grounds.
- **The material**: every floating panel is the addendum's Liquid-Glass pane (blur 24
  saturate 1.8 tint fill, 1px specular top edge, inset hairline ring, radius 28 / pill 999).
  Never two stacked blurs; figures on glass keep full-strength ink, IBM Plex Mono tnum.
- **Motion grammar + reveal model**: smooth long-tail settles, `power3` default — never
  bouncy (`back/bounce/elastic` banned as defaults; comparison-split's badge pop is the
  one earned overshoot). Every frame reveals each piece **on its spoken cue**, spreading
  arrivals across the back ~50%; at t=0 only what the VO is saying is on screen. Holds
  read still — subtle jitter at most, no breathing, no back-half pans.
- **Rhythm / held frames**: Frame 6 (The Tank) is the climax — one continuous slow push,
  nothing else moves. Frame 8 (Free) is the deliberate breather — near-still by design.
  Frame 9 ends on a long held lockup. Everything else reveals to the VO.
- **Negative list**: no slideshow (front-load-then-freeze), no screensaver (independent
  floaters), no bouncy defaults, no purple-blue "AI" gradients, no fake browser chrome or
  cursors (the film has no cursor — Apple grammar is cursorless), no invented metrics or
  testimonials (brand honesty law), no coins/XP vocabulary — burn rate, runway, dilution,
  Chapter 7 only. Glass never over another glass. Caption band: all content plans into the
  top ~83% of the canvas.

## Frame 1 — You can watch business

- scene: Giant lowercase Urbanist words swap in place on the navy void — watch / read / memorize — then the payoff line lands: "or you can run one."
- voiceover: "You can watch business. Read about it. Memorize it. Or — you can run one."
- duration: 4.757s
- poster: 5s
- transition_in: cut
- status: outline
- src: compositions/frames/01-hook.html
- type: hook
- persuasion: Negative contrast — the passive ways of learning dismissed one by one, the active way kept
- beat: curiosity + provocation
- blueprint: kinetic-type-beats (Reproduce — in-place token swap; the swap is the joke)
- focal: none — pure typography
- roles: —
- sfx: click-soft, riser

Scene 1 (0.0–1.4s): Navy void, vignette only. The fixed line "you can **watch** business." sits dead-center (Centered, display ramp ~9cqw, ~55% width, lowercase); "watch" is the variable slot, slightly brighter than the rest. Line enters via per-word staggered reveal (`dynamic-content-sequencing`) on a long-tail settle — nothing else on screen.
Scene 2 (1.4–3.6s): As the VO says "read" then "memorize", the slot hard-cut word-swaps in place (`discrete-text-sequence`): watch → read → memorize, each swap landing exactly on its spoken cue; the retired word exits on an instant cut. The fixed frame of the sentence never moves — the swap itself is the beat.
Scene 3 (3.6–5.4s): On "Or —" the whole line clears upward on a velocity-matched waterfall cut (`cut-catalog.md`); a beat of empty navy (the pause carries the weight).
Scene 4 (5.4–7.0s): "or you can **run one.**" lands via kinetic beat-slam (`kinetic-beat-slam`), "run one" at 1.3× the weight of everything prior, a faint ambient glow blooming behind it (`ambient-glow-bloom`); settles and holds still.

narrativeRole: Opens the film in outcome language — how you actually learn — and dismisses the passive alternatives, creating the vacuum the product fills.
keyMessage: Watching isn't learning. Running one is.

## Frame 2 — Introducing Novus

- scene: A mono eyebrow "introducing" over the huge NOVUS wordmark resolving inside one glass pane glinting on the navy stage.
- voiceover: "Introducing Novus. A life sim — for a company."
- duration: 3.328s
- poster: 5s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/02-introducing.html
- asset_candidates: assets/logo-96f27616.svg — the NOVUS header wordmark SVG
- type: product_intro
- persuasion: Category announcement — names a new thing plainly, Apple-introducing grammar
- beat: intrigue + reverence
- blueprint: kinetic-type-beats (Adapt — "Introducing…" name-drop; keep the hard-cut beat chain, resolve on the wordmark inside the film's one glass pane instead of a flat logo)
- focal: assets/logo-96f27616.svg
- roles: logo-96f27616.svg = cutout (the hero lockup inside the pane)
- sfx: chime, impact-bass-1

Adapt: keep kinetic-type-beats' hard-cut beat → payoff chain; the payoff beat is a Liquid-Glass pane carrying the wordmark (the film's material introduced with the name).
Scene 1 (0.0–1.6s): On "Introducing", the word appears alone — mono label ramp, uppercase, tracked, centered upper-third (Centered, small against the void; the emptiness is the reverence). Per-word staggered reveal, long-tail settle.
Scene 2 (1.6–4.0s): On "Novus", one glass pane (≈46% width, 16:7) fades+scales up from 0.94 at dead-center (`spring-pop-entrance`, smooth register — no overshoot); the NOVUS wordmark SVG self-draws its strokes inside it (`svg-path-draw`), finishing as the specular top edge glints once left-to-right (the pane's lit crest — one finite sweep, not a loop). "introducing" demotes to 40% opacity above the pane.
Scene 3 (4.0–5.6s): On "A life sim", a sub-line reveals beneath the pane per-word (`dynamic-content-sequencing`, lead ramp, muted ink): "a life sim" — pause — Scene 4 (5.6–7.0s): "— for a company." completes the line on its spoken cue, the two final words stepping up to full ink (`asr-keyword-glow`, restrained). Holds — pane still, subtle jitter only.

narrativeRole: The name-drop. The message's first half lands: you are the founder of a company that exists as a game.
keyMessage: Novus is a life sim for a company.

## Frame 3 — Run it

- scene: The real play screen floats as a glass-framed device on the stage; stat rings and ledger tiles reveal as the VO names them, figures counting up in mono.
- voiceover: "Run it. Hiring, pricing, product. Cash. Burn. Runway. Every number is yours."
- duration: 5.248s
- poster: 6s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/03-run-it.html
- asset_candidates: assets/play.webp — real play screen render with stat rings and ledger tiles; assets/months.mp4 — months advancing motion clip
- type: feature_showcase
- persuasion: Show-don't-tell proof — the actual interface with its actual vocabulary
- beat: control + immersion
- blueprint: device-surface-showcase (Adapt — static-tour variant; keep the persistent hero surface + element-level screen life; the "side headline swaps" become the VO-cued ledger callouts lifting off the screen)
- focal: assets/play.webp
- roles: play.webp = cutout (the hero device face) · months.mp4 = supporting (plays inside the device face after establish)
- sfx: whoosh-short, click-soft, sparkle

Adapt: keep the static camera + hero surface signature; the device is a glass-framed phone (play.webp as its face), and instead of side headlines, ledger callout chips LIFT OFF the screen onto the stage as the VO names each number.
Scene 1 (0.0–1.2s): On "Run it.", the phone-aspect device (play.webp inside a glass pane frame, ≈24% width, right-of-center at 62/38 asymmetric) slides up from the bottom edge and settles (long-tail, `power3`); the kicker "RUN IT" lands top-left in mono label. Vignette deepens behind the device (3 depth layers: vignette, device, kicker).
Scene 2 (1.2–3.4s): On "Hiring, pricing, product.", three word-chips reveal left of the device one per spoken cue (`dynamic-content-sequencing`), h3 ramp, muted ink — quick and light, each settling before the next.
Scene 3 (3.4–6.6s): On "Cash. Burn. Runway." the three ledger chips lift off the device face one at a time onto glass chips beside it (`scale-swap-transition` per chip, one per spoken cue): CASH $25K, BURN $2,000, RUNWAY 12mo — figures in mono tnum counting up on arrival (`counting-dynamic-scale`, value-scaled), CASH's figure in solvency green, the rest full white. The word-chips from Scene 2 demote to 40%.
Scene 4 (6.6–9.0s): On "Every number is yours.", the lead line lands beneath the chips (per-word reveal); months.mp4 begins playing inside the device face (the months advancing — the surface alive at last). Holds; device still, no drift.

narrativeRole: First evidence beat — the founder's cockpit is real, legible, and speaks real words: cash, burn, runway.
keyMessage: Your whole company, one month at a time.

## Frame 4 — Live with it

- scene: The decision-card clip plays in a floating device, then slides aside to hand the frame to the consequence line "every call compounds."
- voiceover: "Live with it. Suppliers squeeze. Rivals copy. And every call you make — compounds."
- duration: 5.632s
- poster: 5s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/04-live-with-it.html
- asset_candidates: assets/choices.mp4 — decision card weighed and committed, motion clip
- type: feature_showcase
- persuasion: Future pacing of consequence — decisions shown becoming outcomes
- beat: tension + ownership
- blueprint: video-text-pivot (Reproduce — video yields to text; the slide-aside weight transfer is the signature and it lands on "compounds")
- focal: assets/choices.mp4
- roles: choices.mp4 = cutout (the playing hero clip inside a glass device frame)
- sfx: click-soft, impact-bass-2

Scene 1 (0.0–1.6s): On "Live with it.", the glass-framed device (choices.mp4 playing — a decision card being weighed) rises center-frame (≈26% width, Centered) with the kicker "LIVE WITH IT" in mono above; the clip IS the motion — nothing else moves.
Scene 2 (1.6–4.2s): On "Suppliers squeeze. Rivals copy.", two pressure lines reveal flanking the device left and right (rule-of-thirds, h3 ramp, muted), one per spoken cue, each with a soft alert-red tick mark that draws in (`svg-path-draw`, 12px stroke accents — damage color earning its one job).
Scene 3 (4.2–6.4s): On "And every call you make —", the device SLIDES aside left and scales to 0.8 **into** the vacated space the incoming line now fills (the signature weight-transfer, one event): "every call you make" types into the opened center (`discrete-text-sequence` with caret).
Scene 4 (6.4–8.0s): On "compounds.", the word lands alone at h1 weight with a value-scaled pop (`counting-dynamic-scale` register applied to type scale), a thin gold underline sweeping beneath it (`css-marker-patterns`, highlight sweep — prestige hue, the year is coming). Holds still.

narrativeRole: Second evidence beat — choices are not menu clicks, they are weights you carry into the year.
keyMessage: Decisions compound; you live with yours.

## Frame 5 — Month twelve stops the clock

- scene: A huge mono month counter ticks 01→12 and slams; the year-gate screen rises in glass, prestige-gold gate line beneath.
- voiceover: "Then month twelve — stops the clock. The year doesn't close, until you pitch it."
- duration: 4.736s
- poster: 6s
- transition_in: push-slide LEFT
- status: outline
- src: compositions/frames/05-the-gate.html
- asset_candidates: assets/tank.webp — the year-gate "Pitch me" screen render
- type: feature_showcase
- persuasion: Scarcity/urgency — the one rule the whole game bends around, stated as law
- beat: anticipation + weight
- blueprint: dataviz-countup (Adapt — the count-up IS the hero and the camera pushes THROUGH it; the number is MONTH 01→12 and the landing is the gate screen, not a chart)
- focal: assets/tank.webp
- roles: tank.webp = cutout (the year-gate screen inside its glass device, the landing surface)
- sfx: typing, impact-bass-1, sparkle

Adapt: keep dataviz-countup's signature push-THROUGH the counted number; the counter is "MONTH 01…12" in mono, and the push-through lands on the real gate screen.
Scene 1 (0.0–2.2s): On "Then month twelve", a huge mono counter "MONTH 01" dead-center (Centered, stat-value ramp at ~14cqw, tnum) ticks 01→12 accelerating (`counting-dynamic-scale` — the glyph grows as it climbs), ticks synced to an accelerating tick array; nothing else on the stage.
Scene 2 (2.2–3.6s): On "— stops the clock.", the counter SLAMS at 12 (one earned hard stop, glow bloom `ambient-glow-bloom` in prestige gold behind the digits — the year gate's color claiming the moment); a 0.4s dead-still beat.
Scene 3 (3.6–6.0s): On "The year doesn't close,", the camera pushes THROUGH the number (`multi-phase-camera` push + `motion-blur-streak` on the digits as they pass the lens — the signature move); the gate screen (tank.webp in its glass device frame, ≈24% width) arrives centered out of the push (inverse zoom-through seam, `cut-catalog.md` — "arriving at").
Scene 4 (6.0–8.0s): On "until you pitch it.", the gate line reveals beneath the device in prestige gold mono, one word per spoken cue: "FISCAL YEAR 1 · THE GATE"; the device's OPEN THE CAMERA capsule brightens once, restrained, as the VO says "pitch". Holds.

narrativeRole: The twist beat — the message's second half. This is not another sim: the year is gated by a performance.
keyMessage: The year only closes when you defend it.

## Frame 6 — The Tank

- scene: Slow cinematic push across the five-shark panel plate, depth-of-field pulling from shark to shark, ending centered on the desk.
- voiceover: "Five investors. They've read your books. They heard your ums. Sixty seconds — out loud."
- duration: 5.611s
- poster: 6s
- transition_in: blur-crossfade
- status: outline
- src: compositions/frames/06-the-tank.html
- asset_candidates: assets/tank-set.webp — five shark investors at THE TANK panel desk, navy studio hero plate
- type: feature_showcase
- persuasion: Authority confrontation — the judges are real characters who have read your actual numbers
- beat: awe + healthy fear
- blueprint: camera-journey (Adapt — sub-shape B cursorless flight; keep the continuous motivated camera as the storyteller; the "world" is the tank plate and the legs are focus pulls across the panel)
- focal: assets/tank-set.webp
- roles: tank-set.webp = background (full-bleed hero plate, NOT dimmed — it is the shot) 
- sfx: riser, impact-bass-2

Adapt: keep the continuous multi-leg camera journey; legs are expressed as one slow push + two focus pulls across the plate (no cuts), depth-of-field doing the storytelling.
Scene 1 (0.0–2.4s): On "Five investors.", the tank plate fills the frame full-bleed, camera already moving — one continuous slow push toward the desk (`multi-phase-camera`, single unbroken move for the whole 9s); a soft depth-of-field blur (`depth-of-field-blur`) holds everything except the center shark. Mono kicker "THE TANK" bottom-left at label ramp (inside safe area, above caption band).
Scene 2 (2.4–5.6s): On "They've read your books. They heard your ums.", the focus PULLS left then right across the panel (`depth-of-field-blur` refocusing leg by leg, one pull per spoken cue) — each shark sharpening as the line about them lands. On "ums", three tiny alert-red tick marks flicker at the frame's lower third and die (filler words, counted — 0.5s, gone).
Scene 3 (5.6–9.0s): On "Sixty seconds — out loud.", focus returns to the full desk as the push completes its landing; the line "sixty seconds. out loud." reveals lower-center per-word in white h3 over the plate's darkest region. Camera settles to stillness for the final second — the held read before the stakes. No other motion.

narrativeRole: The climax — the camera meets the panel. Everything the sim built is about to be judged.
keyMessage: You pitch on camera to five sharks who know your numbers.

## Frame 7 — Survive it, or sign it

- scene: Two glass panes side by side — solvency-green stage-up on the left, alert-red "CHAPTER 7" ledger on the right — badges spring-pop to punctuate.
- voiceover: "Survive it, and the company grows. Stumble — and Chapter Seven is real."
- duration: 4.693s
- poster: 5s
- transition_in: crossfade
- status: outline
- src: compositions/frames/07-stakes.html
- asset_candidates: assets/mascot-celebrate.mp4 — mascot celebrating, upside pane
- type: benefit_highlight
- persuasion: Risk framing — real stakes stated with the game's own honest vocabulary
- beat: consequence + resolve
- blueprint: comparison-split (Reproduce — mirrored book-open tilts, inner-edge badges; the one earned overshoot in the film)
- focal: assets/mascot-celebrate.mp4
- roles: mascot-celebrate.mp4 = supporting (plays small inside the left pane's upper region)
- sfx: chime, impact-bass-2, pop

Scene 1 (0.0–0.8s): On "Survive it,", the title "the stakes are real" slides down from above in lead ramp, centered (its tail overlaps Scene 2 — one arrival).
Scene 2 (0.8–2.6s): The split-tilt entry (signature): the LEFT glass pane arrives from the left wing with +rotateY book-open tilt — solvency-green header "THE COMPANY GROWS", mascot-celebrate.mp4 playing small inside, a valuation figure in mono tnum green counting up (`counting-dynamic-scale`). On "and the company grows." the RIGHT pane arrives mirrored ~0.2s behind — cold, dimmer glass.
Scene 3 (2.6–4.8s): On "Stumble —", the right pane's content reveals: "CHAPTER 7" in alert-red mono with a flat ledger line beneath ("assets — liquidated · runway — 0mo") revealing row by row (`dynamic-content-sequencing`), red held to those figures only.
Scene 4 (4.8–7.0s): On "is real.", the two inner-edge badges spring-pop ~0.3s apart (left "STAGE UP" gold, right "FILED" red) — the film's one sanctioned overshoot, earning the punctuation. Panes settle into phase-opposed subtle idle (registered as jitter); hold.

narrativeRole: The stakes beat — winning and losing both mean something; the loss is named with a real word.
keyMessage: The stakes are real: growth or Chapter 7.

## Frame 8 — Free is the whole game

- scene: A calm near-still title card — "Free is the whole game." with a quiet sub-line — one restrained slide-up crossfade, then stillness.
- voiceover: "Free is the whole game. Same twelve months. Same sharks."
- duration: 3.563s
- poster: 4s
- transition_in: crossfade
- status: outline
- src: compositions/frames/08-free.html
- type: benefit_highlight
- persuasion: Risk reversal — nothing withheld, stated flatly
- beat: relief + trust
- blueprint: titlecard-reveal (Reproduce — ONE restrained move then a genuine hold; the film's allocated breather)
- focal: none — pure typography
- roles: —
- sfx: none

Scene 1 (0.0–2.0s): On "Free is the whole game.", the two-line title slide-up crossfades into center (the single move): "free is the whole game." in h2 ramp, white on navy — nothing else.
Scene 2 (2.0–6.0s): On "Same twelve months. Same sharks.", the mono sub-line reveals beneath in muted ink, one phrase per spoken cue (`dynamic-content-sequencing`), then the frame holds genuinely still for the final ~1.5s. Low motion is the payload — no jitter here; dead calm before the close.

narrativeRole: The breather after the climax — removes the last objection in one still breath before the close.
keyMessage: The whole game is free.

## Frame 9 — Keep a company alive

- scene: The stage clears, the NOVUS lockup draws itself on in glass, the tagline settles beneath, novuspitch.com holds to black.
- voiceover: "Novus. Keep a company alive. Defend it out loud. Play free at novuspitch dot com."
- duration: 6.059s
- poster: 7s
- transition_in: zoom-through
- status: outline
- src: compositions/frames/09-lockup.html
- asset_candidates: assets/logo-96f27616.svg — the NOVUS wordmark SVG
- type: cta
- persuasion: Identity close — the brand line is the ask, Apple end-card grammar
- beat: inevitability + invitation
- blueprint: logo-assemble-lockup (Reproduce — the stage clears, the mark draws itself on, the lockup completes into the URL)
- focal: assets/logo-96f27616.svg
- roles: logo-96f27616.svg = cutout (the mark that draws itself on)
- sfx: whoosh-cinematic, chime

Scene 1 (0.0–2.2s): On "Novus.", the navy stage is empty except the vignette; the NOVUS wordmark draws itself on stroke-by-stroke dead-center (`svg-path-draw`, Centered, ~34% width) — the mark coming to exist is the whole beat.
Scene 2 (2.2–5.2s): On "Keep a company alive. Defend it out loud.", the two tagline lines reveal beneath the mark one per spoken cue (per-word staggered, lead ramp, muted ink), the lockup completing as a unit; one finite specular glint crosses the mark.
Scene 3 (5.2–7.4s): On "Play free at", the ONE action element arrives — a glass pill capsule beneath the lockup filling with action orange `#FF6B00` (`stat-bars-and-fills`, progress-fill register) carrying "PLAY FREE" in mono; the film's last orange.
Scene 4 (7.4–9.0s): On "novuspitch dot com", the URL "novuspitch.com" types beneath in mono with caret (`discrete-text-sequence`), caret blinks twice and stops; everything holds to the end — the long Apple hold, dead still.

narrativeRole: The lockup close — brand, tagline, one action. The film ends where every Apple intro ends: the name, held.
keyMessage: Play it now at novuspitch.com.
