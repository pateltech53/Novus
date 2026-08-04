---
format: 1920x1080
duration: 70s
message: "You learn business by running one — Novus is the life sim where months advance on your decisions, real scenarios hit every month, and the year only closes when you pitch live sharks. Learn by doing."
arc: BAB (bike → lectures → Novus) into Feature-Benefit Cascade — bike hook → the lecture problem → introducing → advance months → scenarios → decisions remembered → the gate → pitching the sharks → learn by doing → lockup
audience: business students, educators, and startup-curious players
mode: collaborative
music: minimal confident cinematic tech underscore, slow build, apple keynote feel
---

## Video direction

- **Palette system** (from `frame.md` + its Novus film addendum): the stage is deep brand
  navy `#0B1E36` with the licensed radial vignette (`#10263f` center → `#081527` edge);
  primary ink `#FFFFFF` / muted `#B9B6B1`; mono chrome (kickers, counters, URLs) in
  IBM Plex Mono uppercase tracked; **action orange `#FF6B00` at most once per frame** and
  only on the thing that asks (ADVANCE capsule, CTA pill); solvency green `#3DDC97` only on
  financial upside; prestige gold `#FFC24B` only for the year gate; alert red `#FF3333`
  only for damage/filler words. Captured light-UI screens appear ONLY inside glass-framed
  devices, never as frame grounds.
- **The mark**: the ONLY brand mark the film draws is `assets/novus-mark.svg` — the orange
  shark-fin over the white wave. The wordmark "novus" is TYPESET in Urbanist 800 lowercase
  beside it, never drawn from the retired header SVG.
- **The material**: every floating panel is the addendum's Liquid-Glass pane (blur 24
  saturate 1.8 tint fill, 1px specular top edge, inset hairline ring, radius 28 / pill 999).
  Never two stacked blurs; figures on glass keep full-strength ink, IBM Plex Mono tnum.
- **Motion grammar + reveal model**: smooth long-tail settles, `power3` default — never
  bouncy. Every frame reveals each piece **on its spoken cue**, spreading arrivals across
  the back ~50%; at t=0 only what the VO is saying is on screen. Holds read still —
  subtle jitter at most, no breathing, no back-half pans.
- **Rhythm / held frames**: Frame 8 (Pitching the sharks) is the climax — one continuous
  slow push over the plate, the in-app pitch clip the only other life. Frame 9 (Learn by
  doing) ends on a genuine still — the thesis breathes. Frame 10 ends on the long held
  lockup. Everything else reveals to the VO.
- **Negative list**: no slideshow (front-load-then-freeze), no screensaver floaters, no
  bouncy defaults, no purple-blue "AI" gradients, no cursors, no invented metrics or
  testimonials, no coins/XP vocabulary, **no "free" / price framing anywhere in the film**,
  glass never over glass, all content in the top ~83% of the canvas.

## Frame 1 — The bike

- scene: Giant lowercase type: "you don't learn to ride a bike" — then "by watching videos of people riding bikes." lands and the word "watching" dims to a strikethrough gray.
- voiceover: "You don't learn to ride a bike — by watching videos of people riding bikes."
- duration: 3.989s
- poster: 5s
- transition_in: cut
- status: animated
- src: compositions/frames/01-bike.html
- type: hook
- persuasion: Universal analogy — a truth nobody argues with, planted before the product exists
- beat: recognition + curiosity
- blueprint: kinetic-type-beats (Reproduce — statement builds across full-screen beats; the dim-strike on "watching" is the payoff move)
- focal: none — pure typography
- roles: —
- sfx: click-soft, riser

Scene 1 (0.0–2.2s): Navy void, vignette only. "you don't learn to ride a bike" builds per-word (`dynamic-content-sequencing`), h1 ramp lowercase, dead-center (Centered, ~60% width); long-tail settle, nothing else on screen.
Scene 2 (2.2–4.8s): On "by watching videos", the first line demotes upward to 60% scale and the second line lands beneath it beat-by-beat (`kinetic-beat-slam`, restrained): "by watching videos" — "of people riding bikes." (h2 ramp; two arrivals, each on its spoken cue).
Scene 3 (4.8–7.0s): As the VO finishes, the word "watching" dims to `#B9B6B1` and a thin alert-red strike draws through it (`css-marker-patterns`, strikethrough register — the one red element, damage done to the idea); everything else holds dead still.

narrativeRole: Plants the film's thesis as a physical truth everyone already believes — before business is even mentioned.
keyMessage: Watching doesn't teach you to ride.

## Frame 2 — But that's how we teach business

- scene: Video-player and lecture-slide cards pile up around a small centered figure until they crowd the frame — the overwhelm of passive learning.
- voiceover: "But that's how we teach business. Hours of lectures. Hours of videos. Watching — never doing."
- duration: 5.568s
- poster: 6s
- transition_in: crossfade
- status: animated
- src: compositions/frames/02-lectures.html
- type: pain_point
- persuasion: Pain agitation — the analogy turned on the viewer's own education
- beat: frustration + being buried
- blueprint: overwhelm-surround (Adapt — keep the accumulate-then-close-in signature; the surfaces are abstract lecture-slide and video-player cards, the center is a lone student dot-avatar; no real brand logos)
- focal: none — reconstructed abstract surfaces
- roles: —
- sfx: notification, impact-bass-2

Adapt: keep overwhelm-surround's accumulation → close-in signature; the recognizable surfaces are abstract flat video-player cards (dark rounded rects with a play triangle and a progress bar) and lecture-slide cards (title bar + text lines) — deliberately generic, no invented brands.
Scene 1 (0.0–1.6s): On "But that's how we teach business.", a small muted figure-dot with the mono label "YOU" sits alone dead-center on the navy void (Centered, tiny against emptiness — the inversion of Frame 1's big type).
Scene 2 (1.6–4.6s): On "Hours of lectures." the first lecture-slide cards spring in around the figure (`spring-pop-entrance`, smooth register, staggered); on "Hours of videos." video-player cards join, their progress bars slowly filling (`stat-bars-and-fills`) — the pile grows on each spoken cue, 3 depth layers, cards overlapping (layered-depth, density rising past 60%).
Scene 3 (4.6–8.0s): On "Watching — never doing.", the cards CLOSE IN a step toward the figure (`center-outward-expansion` reversed — the signature crowd-in), dimming to 70%; the line "watching — never doing." lands in white h3 over the pile's darkest region (upper-third), "never doing." at full weight. Hold on the claustrophobic crowd.

narrativeRole: Turns the bike truth into the viewer's own pain — business education is watching, and watching was just proven not to work.
keyMessage: Business is taught by watching — hours of it.

## Frame 3 — Introducing Novus

- scene: The stage clears; the real fin mark draws itself on inside one glass pane, "novus" typesets beside it, the mascot waves in at the corner — "a life simulator for running a company."
- voiceover: "Introducing Novus. A life simulator — for running a company."
- duration: 3.776s
- poster: 5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/03-introducing.html
- asset_candidates: assets/novus-mark.svg — the real fin+wave brand mark; assets/mascot-waving.mp4 — mascot waving clip
- type: product_intro
- persuasion: Category announcement — the answer arrives with the brand's true mark, Apple-introducing grammar
- beat: relief + intrigue
- blueprint: logo-assemble-lockup (Adapt — the mark comes to exist: the fin's orange path fills on, the white wave draws through it; wordmark typesets beside; keep the cleared-stage → lockup signature)
- focal: assets/novus-mark.svg
- roles: novus-mark.svg = cutout (the hero mark inside the pane) · mascot-waving.mp4 = supporting (small corner cutout, enters on "life simulator")
- sfx: whoosh-cinematic, chime

Adapt: keep logo-assemble-lockup's cleared-stage → the-mark-draws-itself-on signature; the mark is the REAL favicon (orange fin + white wave), the wordmark is typeset Urbanist 800 lowercase — never the retired header SVG.
Scene 1 (0.0–1.4s): On "Introducing", the word alone — mono label ramp, uppercase, tracked, centered upper-third; per-word reveal on a long-tail settle. Empty navy beneath it (the reverence is the emptiness).
Scene 2 (1.4–3.6s): On "Novus", one glass pane (≈44% width) scales up from 0.94 dead-center (`spring-pop-entrance`, smooth); inside it the fin mark draws on — the orange fin path fills upward (`svg-path-draw`), then the white wave stroke draws through beneath it — and "novus" typesets beside the mark character-by-character (`discrete-text-sequence`, no caret). The pane's specular edge glints once.
Scene 3 (3.6–5.4s): On "A life simulator", the sub-line reveals beneath the pane per-word (`dynamic-content-sequencing`, lead ramp, muted ink), while the mascot (mascot-waving.mp4, cutout, ≈14% width) enters at the lower-right corner and waves — the game's face arriving with the word "simulator".
Scene 4 (5.4–7.0s): On "— for running a company.", the phrase completes at full ink (`asr-keyword-glow` restrained on "running"); everything holds — pane still, mascot's wave the only life.

narrativeRole: The name-drop with the correct mark — and the category: a life simulator you run, not content you watch.
keyMessage: Novus is a life simulator for running a company.

## Frame 4 — Months move when you do

- scene: The real play screen floats as a glass-framed device; the ADVANCE MONTH capsule glows, the months clip takes the face, the month badge ticks forward.
- voiceover: "Your company lives month to month. Nothing moves — until you press advance."
- duration: 4.437s
- poster: 5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-advance.html
- asset_candidates: assets/play.webp — real play screen render; assets/months.mp4 — months advancing motion clip
- type: feature_showcase
- persuasion: Show-don't-tell — the sim's one law demonstrated on the real interface
- beat: control + agency
- blueprint: device-surface-showcase (Adapt — static-tour variant; the persistent hero device holds while its face comes alive exactly when the VO grants it time; the tap-compress lands on ADVANCE)
- focal: assets/play.webp
- roles: play.webp = cutout (the hero device face) · months.mp4 = supporting (takes over the device face on "press advance")
- sfx: click, whoosh-short

Adapt: keep the static camera + persistent hero surface; the "button tap" signature lands on the real ADVANCE MONTH capsule, and the face swaps to the live months clip exactly on that press.
Scene 1 (0.0–2.0s): On "Your company lives month to month.", the glass-framed device (play.webp, ≈20% width) slides up from the bottom edge right-of-center (62/38 asymmetric) and settles; kicker "THE SIM" top-left in mono. The mono line "MONTH 1 OF 12" reveals left of the device.
Scene 2 (2.0–4.4s): On "Nothing moves —", stillness IS the beat: the frame holds dead still for the spoken pause (the sim frozen, waiting); the device's ADVANCE MONTH capsule gets one restrained glow swell (`asr-keyword-glow` — the frame's one orange, already on the captured screen).
Scene 3 (4.4–7.5s): On "until you press advance.", the capsule tap-compresses (`press-release-spring`, smooth register) and the device face swaps to months.mp4 (`scale-swap-transition` on the face) — the months visibly advancing; beside the device the mono line ticks "MONTH 1 → MONTH 2 → MONTH 3" (`counting-dynamic-scale`, restrained). Holds on the living sim.

narrativeRole: The sim's core mechanic — time is yours; the game runs on your decisions, not a clock.
keyMessage: Months advance only when you decide.

## Frame 5 — Every month, a scenario

- scene: The decision-card clip plays in the glass device; pressure lines flank it; then the clip yields the frame to "you decide." typing into the center.
- voiceover: "Every month brings a real scenario. A supplier squeezes. A rival copies. You decide."
- duration: 5.696s
- poster: 5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-scenarios.html
- asset_candidates: assets/choices.mp4 — decision card weighed and committed, motion clip
- type: feature_showcase
- persuasion: Concrete stakes — named problems, not abstract "challenges"
- beat: tension + ownership
- blueprint: video-text-pivot (Reproduce — the clip slides aside and hands its weight to the typed line; the weight-transfer lands on "You decide.")
- focal: assets/choices.mp4
- roles: choices.mp4 = cutout (the playing hero clip inside the glass device frame)
- sfx: click-soft, impact-bass-2

Scene 1 (0.0–2.2s): On "Every month brings a real scenario.", the glass-framed device (choices.mp4 playing — a decision card being weighed) rises center-frame (≈24% width, Centered); kicker "THE SCENARIOS" in mono above.
Scene 2 (2.2–4.8s): On "A supplier squeezes. A rival copies.", two pressure lines reveal flanking the device (rule-of-thirds, h3 ramp, muted), one per spoken cue, each with a small alert-red tick that draws in (`svg-path-draw` — the damage color naming real problems).
Scene 3 (4.8–6.6s): On "You decide.", the device SLIDES aside left and scales to 0.8 into the space the incoming line fills (the signature weight-transfer, one event): "you decide." types into the opened center (`discrete-text-sequence` with caret), h1 weight.
Scene 4 (6.6–8.0s): The typed line holds; caret blinks twice and stops. Dead still — the decision is the viewer's.

narrativeRole: The sim's content — every month is a concrete business problem with the player's name on it.
keyMessage: Real scenarios, every month — and you decide.

## Frame 6 — The game remembers

- scene: Three ledger glass chips assemble; as the VO names each number, its figure flips — cash up in green, burn in white, runway down with a red tick — the consequences of Frame 5's decision.
- voiceover: "And the game remembers. Every decision moves your numbers — cash, burn, runway."
- duration: 4.779s
- poster: 5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/06-remembers.html
- type: feature_showcase
- persuasion: Consequence made visible — the honest both-directions ledger, no sugarcoating
- beat: weight + respect
- blueprint: grid-card-assemble (Adapt — live-populating data board variant: the chips assemble empty, then their figures flip states on each spoken cue; keep the staggered self-assembly signature)
- focal: none — the ledger chips are built typography
- roles: —
- sfx: pop, sparkle

Adapt: keep grid-card-assemble's staggered self-assembly + post-assembly status flips; three chips only (cash / burn / runway), figures in IBM Plex Mono tnum at full ink.
Scene 1 (0.0–2.0s): On "And the game remembers.", the line lands centered (h2 ramp); beneath it three empty glass chips assemble in a row (`spring-pop-entrance`, staggered, smooth) — labels only: CASH · BURN · RUNWAY in mono.
Scene 2 (2.0–5.2s): On "Every decision moves your numbers —", the headline demotes upward; then per spoken cue each chip's figure arrives and flips: "cash" → $25K counts up to $31K in solvency green (`counting-dynamic-scale`); "burn" → $2,000 lands in full white; "runway" → 12mo flips DOWN to 9mo with a small alert-red tick beside it (`stat-bars-and-fills`, a short bar draining) — the decision from Frame 5 had a cost.
Scene 3 (5.2–7.5s): The three chips hold; one restrained keyword glow passes across "RUNWAY"'s label as the VO finishes (the number the whole game bends around). Still hold.

narrativeRole: The sim's memory — decisions are not multiple-choice trivia; they compound into the books you will defend.
keyMessage: Decisions move real numbers, both directions.

## Frame 7 — Month twelve stops the clock

- scene: A huge mono month counter ticks 01→12 and slams in prestige gold; the camera pushes through the digits into the real year-gate "Pitch me" screen.
- voiceover: "Then month twelve — stops the clock. To close the year, you have to pitch."
- duration: 4.032s
- poster: 6s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/07-the-gate.html
- asset_candidates: assets/tank.webp — the year-gate "Pitch me" screen render
- type: feature_showcase
- persuasion: The one rule stated as law — scarcity of passage
- beat: anticipation + weight
- blueprint: dataviz-countup (Adapt — the counted number IS the hero and the camera pushes THROUGH it; the counter is MONTH 01→12, the landing is the real gate screen)
- focal: assets/tank.webp
- roles: tank.webp = cutout (the year-gate screen inside its glass device, the landing surface)
- sfx: typing, impact-bass-1, sparkle

Adapt: keep dataviz-countup's signature push-THROUGH the counted number; identical machinery to v1's gate frame (it worked): counter, slam, push-through, gate screen.
Scene 1 (0.0–2.2s): On "Then month twelve", the huge mono counter "MONTH 01" dead-center (stat-value ramp ~14cqw, tnum) ticks 01→12 accelerating (`counting-dynamic-scale`), ticks on an accelerating array; nothing else on stage.
Scene 2 (2.2–3.4s): On "— stops the clock.", the counter SLAMS at 12; a restrained prestige-gold bloom breathes once behind the digits (`ambient-glow-bloom`, low opacity); a 0.4s dead-still beat.
Scene 3 (3.4–5.8s): On "To close the year,", the camera pushes THROUGH the digits (`multi-phase-camera` + `motion-blur-streak`); the gate screen (tank.webp in its glass device, ≈18% width) arrives centered out of the push (inverse zoom-through seam).
Scene 4 (5.8–7.5s): On "you have to pitch.", the gold mono gate line "FISCAL YEAR 1 · THE GATE" reveals beneath the device word-by-word; the OPEN THE CAMERA capsule brightens once as the VO says "pitch". Holds.

narrativeRole: The twist — this sim has a gate no other sim has: the year is closed by a performance, not a menu.
keyMessage: The year doesn't close until you pitch it.

## Frame 8 — Pitching the sharks

- scene: The five-shark TANK plate fills the frame under one slow continuous push; the in-app pitch clip rises in a glass device over it — the player mid-pitch — focus pulling shark to shark.
- voiceover: "On camera. Out loud. To five sharks — who have read your books."
- duration: 3.669s
- poster: 6s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/08-the-tank.html
- asset_candidates: assets/tank-set.webp — five-shark TANK panel hero plate; assets/tank.mp4 — in-app pitch/tank motion clip
- type: feature_showcase
- persuasion: Authority confrontation — the pitch is shown happening, the judges are characters who know your numbers
- beat: awe + healthy fear
- blueprint: camera-journey (Adapt — sub-shape B cursorless flight over the plate; the one added element is the glass device carrying the real in-app pitch clip — the film SHOWS the pitching, not just the panel)
- focal: assets/tank-set.webp
- roles: tank-set.webp = background (full-bleed hero plate, not dimmed — it is the shot) · tank.mp4 = cutout (the in-app pitch/tank clip in a glass device, lower-left, enters on "On camera")
- sfx: riser, impact-bass-2

Adapt: keep the continuous motivated camera journey (one unbroken slow push, focus pulls as legs); the added glass device with the real pitch clip is the "action" the journey witnesses.
Scene 1 (0.0–2.4s): On "On camera. Out loud.", the tank plate fills the frame, camera already pushing slowly toward the desk (`multi-phase-camera`, one unbroken move for all 9s); depth-of-field holds the sharks soft (`depth-of-field-blur`). The glass-framed device rises lower-left (≈17% width) playing tank.mp4 — the actual in-app pitch moment, the player's camera view. Mono kicker "THE PITCH" top-left.
Scene 2 (2.4–6.0s): On "To five sharks —", focus pulls off the device onto the panel, sweeping left to right across the five sharks (`depth-of-field-blur` refocusing leg by leg); the device dims to 80% but keeps playing — the pitch continuing under their gaze.
Scene 3 (6.0–9.0s): On "who have read your books.", focus settles on the full desk; the line "they've read your books." reveals lower-center per-word in white h3 over the plate's darkest region. The push completes and the camera settles to stillness for the final second. Nothing else moves.

narrativeRole: The climax — the pitch itself, shown: your camera, your voice, their table.
keyMessage: You pitch on camera to five sharks who know your numbers.

## Frame 9 — Learn by doing

- scene: The stage empties; "you don't learn business by watching." dims and strikes — then the tagline lands huge: "learn by doing." and holds in silence.
- voiceover: "Because you don't learn business by watching. You learn — by doing."
- duration: 3.477s
- poster: 5s
- transition_in: crossfade
- status: animated
- src: compositions/frames/09-learn-by-doing.html
- type: benefit_highlight
- persuasion: Thesis closure — Frame 1's analogy cashed in as the brand's own law
- beat: clarity + conviction
- blueprint: kinetic-type-beats (Adapt — the dim-strike from Frame 1 returns on "watching" (the bookend), then the tagline lands as the payoff beat and HOLDS; keep the beat-chain → payoff signature)
- focal: none — pure typography
- roles: —
- sfx: click-soft, impact-bass-1

Adapt: keep kinetic-type-beats' beat-chain → payoff; the payoff is the locked tagline, and the frame ends as the film's allocated breather — a genuine long still.
Scene 1 (0.0–2.6s): On "Because you don't learn business by watching.", the line builds per-word centered (h2 ramp, lowercase); as the VO finishes the clause, "watching" dims and takes the same thin red strike as Frame 1 (`css-marker-patterns` — the bookend, the one red element).
Scene 2 (2.6–4.8s): On "You learn — by doing.", the struck line clears upward on a waterfall cut; "learn by doing." lands beat-by-beat (`kinetic-beat-slam`, restrained): "learn" (800 weight) — "by" (400, muted) — "doing." (800, 1.2× scale), dead-center at display ramp.
Scene 3 (4.8–7.0s): The tagline holds in genuine stillness — no jitter, no glow, underscore thinned. The film's quietest moment.

narrativeRole: The thesis card — the bike, the lectures, and the sim resolve into three words the viewer keeps.
keyMessage: LEARN by DOING.

## Frame 10 — Lockup

- scene: A calm end-card chain: the fin mark + "novus" lockup, the tagline joining beneath, then the URL and the one orange pill — held to black.
- voiceover: "Novus. Learn by doing. Start your company — at novuspitch dot com."
- duration: 4.395s
- poster: 7s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/10-lockup.html
- asset_candidates: assets/novus-mark.svg — the real fin+wave brand mark
- type: cta
- persuasion: Identity close — the brand line is the ask, Apple end-card grammar, no price framing
- beat: inevitability + invitation
- blueprint: titlecard-reveal (Reproduce — the appending card chain: lockup → +tagline → +CTA/URL, each near-still, terminating on the long held end card)
- focal: assets/novus-mark.svg
- roles: novus-mark.svg = cutout (the mark in the lockup)
- sfx: whoosh-cinematic, chime

Scene 1 (0.0–2.4s): On "Novus.", the lockup card: the fin mark draws on dead-center (`svg-path-draw` — orange fin fills, white wave strokes through) with "novus" typesetting beside it — one restrained arrival, then still.
Scene 2 (2.4–4.6s): On "Learn by doing.", the tagline appends beneath the lockup (slide-up crossfade, the chain's one move per card): "learn by doing." in lead ramp, "learn"/"doing" at full ink, "by" muted.
Scene 3 (4.6–6.6s): On "Start your company —", the one orange element arrives: a glass pill beneath the lockup fills with action orange (`stat-bars-and-fills`, progress-fill register) carrying "START YOUR COMPANY" in mono ink-on-fire.
Scene 4 (6.6–8.5s): On "at novuspitch dot com", "novuspitch.com" types beneath in mono with caret (`discrete-text-sequence`); caret blinks twice and stops. The full end card holds dead still to the final frame — the long Apple hold.

narrativeRole: The close — mark, tagline, one action. No price, no feature list; the name and the invitation.
keyMessage: Start your company at novuspitch.com.
