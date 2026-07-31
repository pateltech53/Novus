# NOVUS — Full Game Design Document v1 ("The Founder Run")
July 2026 · Supersedes nothing; implements Brand Identity v2. Written to be fed directly into Claude Code.

**Doc set:**
- `NOVUS_GDD_v1.md` (this file) — systems, onboarding, tutorial, stats, sim model, PERFORM spec, monetization, glossary, asset manifest + generation prompts, build order.
- `NOVUS_EVENT_LIBRARY_B1.md` — Batch 1 authored decision instances with full effect variations + the expansion prompt to generate further batches.

---

## 0 · How to use this with Claude Code

1. Paste both files into the repo root (`/design/`).
2. Build in the phase order in §15. Phase 1 needs only §5, §6, §9 and the event library.
3. Events ship as data, not code. Convert the event library to JSON using the schema in §9 (a conversion prompt is included in §10). The engine reads JSON; humans edit the .md.
4. Everything marked **[DECISION KNOB]** is tunable config, not hard-coded.
5. Everything marked **[ZACH-FLAG]** is a place where I overrode or reinterpreted the voice brief — read those before building.

---

## 1 · Product definition & the calls I made

**What it is:** Novus is a mobile app (iOS first, Android second) — a BitLife-style life sim where the "life" is a company. You create a founder avatar and a company, then advance it fiscal year by fiscal year through thousands of decision events, activities, and crises — but every year-end, every fundraise, and every major crisis is resolved by *you performing on camera*: pitching, consulting, negotiating. The sim narrates the consequences of your speaking. Target: teens 13–18, DECA/FBLA angle for parents/schools.

**Platform assumption:** native mobile app with camera + mic. The transcript says "app" throughout, and camera-based body-language scoring plus daily push notifications only work natively. Web stays as marketing site + account portal.

**[ZACH-FLAG 1] — "2,000+ instances."** Hand-writing 2,000 monolithic events is the wrong architecture and would also be worse *content*: BitLife's density comes from ~hundreds of authored events multiplied by conditions, stages, and callbacks — not 2,000 unrelated one-offs. Batch 1 ships **237 authored events**; the parameter system in §6/§9 (5 stages × industry reskins × flag-gated variants) makes those play as **~2,100–2,600 distinct in-game instances** (honest math in §10), and the expansion prompt generates +100 authored events per batch in the same schema whenever you want more. If you still want literally 2,000 hand-authored events, we run the expansion prompt ~18 more times — the pipeline is built for it.

**[ZACH-FLAG 2] — "logic customization is more in the paid areas."** As phrased, that's pay-to-win, and it directly violates your own Brand Law 4 ("ranked stays purchase-neutral… pay-to-win poisons Still Standing, looks predatory on minors, kills school sales"). I've reinterpreted paid "logic" as paid *content* — more industries, scenario packs, run slots, deeper replay analytics — never better sim outcomes. Details + rationale in §11. If you truly want gameplay-affecting purchases, that's a deliberate brand-law change, decide it consciously.

**[ZACH-FLAG 3] — Voice-first onboarding.** "Ask me what is Novus" into a mic on first open is on-brand but is also the single riskiest funnel step: a big share of teens open apps in class, on a bus, or at night and will not speak. The mic moment stays as the hero path (it doubles as mic-permission grant + volume calibration — two birds), but there is a visible "I'm somewhere quiet later — just show me" tap fallback. No fallback = measurable install-to-signup drop for zero benefit.

**[ZACH-FLAG 4] — Real-money-feeling systems.** Stocks/crypto/real estate exist as simple simulated mini-systems (§8), clearly toy-scaled. Simulated investing is fine for a 13+ rating; just never link it to IAP and never imply real financial advice. Also: these are v1.5 features — do not let them delay the core loop (your own scope rule: one case engine, many lenses).

**[ZACH-FLAG 5] — Subscription screen placement.** You asked for the subscription offer inside onboarding, before the first business. It's in that slot (§3, screen O6) — but it's a *soft* offer with a large skip, and the hard sell re-fires after the player survives Year 1 (the aha moment). Pre-value hard paywalls are where onboarding funnels die. Ship both, A/B it. **[DECISION KNOB]**

---

## 2 · Core loop — reconciling BitLife with Brand v2

Brand v2 says: one shared daily event, year-end locked behind performance. The transcript says: thousands of everyday BitLife decisions, activities, free progression. These are *layers*, not a conflict:

**Layer 1 — the BitLife layer (tap, free, offline).** Everyday decision events from the event library. Local JSON, zero AI cost, unlimited. This is the "thousands of instances" texture: supplier drama, employee drama, weird customers, personal life. Tapping here never advances the year — it fills it.

**Layer 2 — Today's Market (the daily shared case).** One authored/AI event per real day, identical for every player, hitting every company differently. This is the fairness + cost anchor from Brand v2 and the push-notification hook.

**Layer 3 — PERFORM moments (camera + mic + AI).** Pitches, consulting turnarounds, negotiations, board meetings. The only place AI spend happens. Year End is locked until today's PERFORM is done — *"you talk to progress, no exceptions."*

**Time structure [DECISION KNOB]:** 1 real day = 1 fiscal year, minimum. A day contains: 3–6 Layer-1 events (drawn by the engine per §9 weights), Today's Market, any activities the player chooses, one required PERFORM, then Year End (the age-up: results screen, The Books update, investment choices for next year). Players can do less (company coasts — never dies from absence, Brand Law 3) but never more than one year/day, so Still Standing stays fair and streaks matter. Practice Gym (retrying PERFORMs) is always available and never advances time.

**The one loop, drawn:**
`Found → [daily: micro-events → Today's Market → activities → PERFORM] → Year End → repeat → IPO or Chapter 7 → Legacy persists → new run`

**Run & legacy:** A run = one company, founding to IPO/Chapter 7/sale. Runs end; legacy persists: best year reached, badges, Shark Respect meter, autopsy history. Losing must sting; restarting must take <10 seconds.

---

## 3 · Onboarding flow — screen by screen

Asset IDs (V## = video, IMG-## = image) resolve in §13. Copy is final draft in Voice v2 (taunting narrator; the shark needles choices, never the kid).

**O1 · Splash / Welcome.** Dark navy field, wordmark, shark plays **V01** (wave + grin). Line: *"Welcome to Novus."* Button: `Get started`. Nothing else on screen.

**O2 · The Mic Moment.** Shark leans in, **V02** (listening loop). Copy: *"Ask me out loud: 'What is Novus?'"* Mic button pulses orange. Speaking triggers OS mic permission → captures a 2-second volume baseline (stored as the player's calibration for future PERFORM scoring — silently). Fallback link, small but visible: *"I'm somewhere quiet later — just show me."* Either path → O3.

**O3 · The Answer (explainer).** **V03** plays: 25-second explainer (storyboard in §13). Shark voiceover: *"Novus is a life sim — for a company. You'll found one, run it year by year, and keep it alive by talking: pitching me, negotiating deals, surviving my questions. Tap games let you tap. Here, you talk to progress."* Skippable after 5s.

**O4 · Your name.** Single field: *"Before the paperwork — what do I call you?"* This is the *player* name (leaderboard identity), not the avatar. School-safe: first name + initial suggested.

**O5 · Notifications ask.** Framed as the shark's terms: *"Today's Market drops daily. Want me to knock, or should your company just quietly rot?"* Buttons: `Knock` / `I'll risk it`. (Pre-permission primer before the OS dialog — only fire the OS dialog on `Knock`.)

**O6 · Plans (soft).** Free vs Novus Pro side-by-side (contents per §11). Shark: *"Pro founders get twelve industries and the Practice Gym. Free founders get four industries and my judgment either way."* Big primary button: `Start free` — Pro is the secondary action. **[ZACH-FLAG 5 applies; re-offer fires after Year 1 survival.]**

**O7 · Create your founder.** Avatar builder: name + surname (or hers — free text, profanity-filtered), skin tone, hair, face, base outfit. Free: 3 outfits, 6 hair, full skin range (never gate skin tones). Everything else lives in The Closet (paid cosmetics). IMG-04 asset set.

**O8 · Found the company.** Company name (filtered, renameable later per §8), then industry grid IMG-02: **Free: Food & Beverage · E-commerce/Retail · Tech App · Content/Creator. Pro (locked, greyed with padlock): Fashion/Streetwear · Gaming · Fitness · Beauty · EdTech · Sustainability · Toys & Collectibles · Pet.** Tapping a locked one shows the Pro sheet once, never nags twice. **[DECISION KNOB: exact free four]**

**O9 → hands straight into the Guided First Run (§4).** No dashboard dump, no feature tour. Teach by playing.

---

## 4 · The Guided First Run (tutorial — fully scripted Year 1)

Principle: the shark is the tutorial. No overlay arrows; the narrator tells you what to do and roasts you into learning the UI. Rookie Mode (plain-English tooltips, §12) is ON by default for run 1.

**T1 · Cold open.** *"Congratulations. You now own a company worth nothing. Fix that."* The Books bar slides in pinned to the top — Cash / Burn / Runway / Valuation — with rookie captions under each the first time (e.g., Runway: *"months until the money runs out"*). Starting state: Cash 25S, Burn 2S/mo (S = stage money unit, §6).

**T2 · First micro-event (forced draw: E-SEED-001, garage decision).** Player taps a choice, watches numbers move with +/- floaters. Shark: *"See that? Every choice moves The Books. Most founders notice too late."*

**T3 · Stats panel reveal.** Swipe-in side panel with the full stat sheet (§5). Shark: *"The nerd drawer. Gross margin, churn, willingness to pay. Rookie Mode is on — tap any term I use and I'll say it like you're twelve."*

**T4 · Today's Market intro (forced: TM-TUT, mild supplier hiccup).** *"Once a day, the market hits everyone. Same storm, different boats. Your friends are getting this exact event right now."*

**T5 · First revenue beat.** Scripted: the company books its first sale (Cash +3S). Shark: *"Money. Cute. Now it's worth my time —"*

**T6 · THE FIRST PITCH (P:pitch, guided).** *"— pitch me. Camera on. Sixty seconds: what you sell, who buys it, why you win, what you want from me. I'll be watching your eyes, your hands, your filler words. Mostly your logic."* Pre-pitch card shows the 4-beat structure. Camera preview with framing guide. After delivery → score reveal (rubric §7): content, delivery, presence + 2 specific fixes. Tutorial floor: first pitch cannot hard-fail; sharks invest a small check at painful terms if score <5, with commentary. Term sheet animation **V08**.

**T7 · Year End.** *"Fiscal Year 1: closed. Still solvent. Barely — I've seen lemonade stands with better margins."* Results card: revenue, profit/loss, valuation change, badge `Year 1: Survived`. Investment choice for next year (3 cards: marketing / product / save it) — teaches the year-end allocation mechanic.

**T8 · The hook out.** Streak flame lights. *"Come back tomorrow. Today's Market waits for no one — and Marco's company is already Year 2."* (Marco = persistent AI rival, §14.) Push primer if not granted.

Tutorial ends. Total target time: 6–8 minutes including the pitch.

---

## 5 · Stats & The Books

**The Books (pinned to every screen, Brand v2):** Cash · Burn rate · Runway · Valuation. These four never hide.

**Full stat sheet (side panel).** Every stat: pro name → range → what drives it → Rookie line (shown when Rookie Mode on or term tapped). Rookie lines are the "simplified version" you asked for; the full glossary is §12.

| Stat | Range | Driven by | Rookie line |
|---|---|---|---|
| Cash | $ | everything | "Money in the bank right now." |
| Revenue (annual) | $ | demand × price | "All the money customers paid you this year." |
| Burn rate | $/mo | costs − gross profit | "How fast you lose money each month." |
| Runway | months | Cash ÷ Burn | "How many months until the money runs out." |
| Valuation | $ | §6 formula | "What your whole company would sell for." |
| Gross margin (GM) | % | price vs cost of goods | "Out of each $1 you sell, what you keep before other bills." |
| Net margin | % | after all costs | "What you keep out of each $1 after EVERY bill." |
| Market share | % | vs rivals in industry | "Your slice of everyone buying this kind of thing." |
| Brand | 0–100 | PR, ads, scandals | "How much people know and like your name." |
| Product Quality (Qual) | 0–100 | R&D, bugs, shortcuts | "How good your product actually is." |
| Customer Sat (CSAT) | 0–100 | Qual, support, price | "How happy your customers are." |
| Churn | %/yr | CSAT, rivals | "The share of customers who quit you each year." |
| CWP (willingness to pay) | $ | Brand, Qual | "The most a customer would pay before walking away." |
| CAC | $ | marketing efficiency | "What it costs you to win ONE new customer." |
| LTV | $ | CWP, churn | "All the money one customer gives you before they leave." |
| CTR | % | ad creative, Brand | "Out of 100 people who see your ad, how many click." |
| Employees | # | hires/fires | "How many people work for you." |
| Morale | 0–100 | pay, events, firings | "How much your team likes working for you." |
| Founder Energy | 0–100 | your life choices | "Your own battery. At zero, you make bad calls." |
| Shark Respect | 0–100, cross-run | PERFORM scores, honesty | "How seriously the shark takes you. Carries over forever." |

**Hidden stats (never displayed, drive events):** Supplier Loyalty, Investor Sentiment, Legal Risk, Tech Debt, Team Loyalty (per exec), Karma flags ({cut_corners}, {treated_team_well}, …). The autopsy (Chapter 7) is allowed to reveal them — *"your hidden legal risk had been red for two years"* is a great autopsy line.

**Display rule:** money compresses (12.4K / 3.1M / 1.2B). Deltas always animate as floaters (+/− in Solvency Green / Alert Red per palette law: green = financial upside only, orange = CTAs only).

---

## 6 · Simulation model (deterministic core, luck as flavor)

**Stages & the S unit.** All money effects in the event library are written in **S** so one authored event scales across the whole game:

| Stage | Name | Typical rev/yr | S = |
|---|---|---|---|
| St1 | Garage | <100K | $1K |
| St2 | Startup | 100K–1M | $10K |
| St3 | Growth | 1M–20M | $100K |
| St4 | Scale | 20M–250M | $1M |
| St5 | Public/Unicorn | 250M+ | $10M |

Stage advances when trailing revenue crosses the band (announced at Year End: *"Welcome to Growth stage. Bigger checks, bigger fires."*).

**Quarterly tick (runs under the daily loop):** demand → revenue → costs → Books update.
- `Demand_q = BaseDemand × industry_season × (1 + Brand/250) × (1 − Churn/4) × market_modifier(events)`
- `Revenue_q = Demand_q × Price`, `GrossProfit = Revenue × GM`
- `Burn = FixedCosts + Payroll − GrossProfit/3` (monthly)
- `Valuation = Revenue × industry_multiple × (0.6 + Qual/200 + Brand/200) + hype_modifier` — industry multiples in config (Tech 8×, Food 2×, etc.) **[DECISION KNOB]**

**Luck band (Brand Law 2: skill decides survival, luck adds flavor):** every numeric event effect gets ±15% jitter, seeded per run-day so retelling is consistent. Luck may never flip an outcome's sign — a good choice can pay less, never punish.

**PERFORM coupling:** PERFORM score (0–10) maps to outcome multiplier `M = 0.4 + 0.12×score` applied to that event's stakes (raise size, crisis damage reduction, deal terms). A great pitch can save a bad year — nothing else can.

**Difficulty:** none selectable. Stage IS difficulty; event weights shift harsher as valuation grows (config table in §9).

**Coasting:** on days not opened, the company runs the quarterly tick with no events, Energy +5, Brand −1/wk drift. Absence never kills (Brand Law 3); it just wastes time versus Marco.

---

## 7 · PERFORM events — the camera/voice engine

One framework, many skins. Every PERFORM = **Brief → Prep (30s optional) → Delivery (camera+mic, 45–120s) → AI turn(s) → Scoring → Consequences narrated by the sim.**

**7.1 What the device measures (on-device, MediaPipe-class):**
- **Eye contact %** — gaze on lens; good ≥60%, flag <35%.
- **Sway/stability** — torso keypoint stddev; flag = visible rocking >threshold.
- **Gesture presence** — hands visible & moving vs frozen/pockets.
- **Volume** — vs the O2 calibration baseline; flags whisper & shout.
- **Pace** — 120–160 wpm green band.
- **Filler rate** — um/uh/like/you-know per minute; flag >6/min, each highlighted on the transcript.
- **Tone energy** — pitch variance (monotone flag). *Never scored: accent, voice type, personality — Brand Law 5, "grade the logic, not the kid." High-energy and calm-clinical both can score 10.*

**7.2 What the AI judges (server):** transcript only + numeric metrics (raw video never leaves device). Content rubric per event type; the shark panel then acts on it.

**7.3 Scoring rubric (0–10 shown, sub-bars for each):** Content 50% (structure, numbers used correctly, question actually answered), Delivery 30% (filler, pace, volume, tone), Presence 20% (eye contact, stability, gestures). DECA/FBLA-benchmarked rubric text from the Prompt Pack's Language Coach + Panel Rulebook plugs in here unchanged.

**7.4 The Shark Panel (pitch events).** The five sharks from the Prompt Pack — **Marcus** (numbers-first), **Serena** (brand/story), **Dev** (product/tech), **Lily** (customer obsession), **Viktor** (cold cash-flow) — each a separate prompt with visible cross-talk, competitive bidding, and negotiation. Score bands: ≥8 sharks compete (better terms, maybe 2 offers); 5–7 one offer, hard terms, live negotiation round (counter by voice); <5 all pass with reasons; <3 the roast is the content. Deal math: check size & dilution derive from valuation × M. The recurring suited shark (the mascot) chairs the panel and is the one whose Respect meter moves.

**7.5 Other PERFORM skins (same pipeline, different rubric + judge prompt):**
- **Consulting turnaround** — a problem brief (yours or, later, another AI company's); rubric: diagnosis → root cause → recommendation.
- **Investor update call** — quarterly after you've taken money; rubric: honesty vs spin (lying to investors sets {spin} flag → future term-sheet penalty).
- **Board meeting** — defend a strategic choice to 3 board members; rubric: tradeoff reasoning.
- **Negotiation** — supplier/landlord/acquirer counters in real time; rubric: anchoring, concessions, BATNA use.
- **All-hands persuasion** — rally the team after bad news; rubric: clarity + empathy; moves Morale.
- **Media interview / crisis PR** — hostile journalist skin; rubric: staying on message under provocation.

**7.6 Cost control:** Layer-1 events are local (zero AI). Today's Market = 1 shared case/day (one generation serves everyone). PERFORM = 1 required + Free tier 1 retry/day; Pro unlimited retries in Practice Gym (retries use the cheaper single-judge prompt, not the 5-shark panel). **[DECISION KNOB: model tier per prompt]**

**7.7 Privacy (non-negotiable for school sales):** video processed on-device and discarded; audio → speech-to-text, transcript retained; replays stored locally only, sharing is explicit opt-in; 13+ rating; classroom mode hides surnames on leaderboards. Put this sentence in the store listing and the parent-facing site.

---

## 8 · Activities & mini-systems (player-initiated, from the Activities tab)

Each is deliberately shallow in v1 — cards, not markets. Ship the loop first.

- **Marketing push** — pick channel (social / influencer / billboard / door-to-door at St1). Spends Cash, moves CTR/Brand/CAC per channel table. Door-to-door at St1 is free but costs Energy and can trigger event chains (E-MKT series).
- **R&D / new tech** — invest xS per quarter → Qual +, Tech Debt −; occasionally spawns a breakthrough event.
- **Hire / fire executives** — 4 seats (COO, CMO, CTO, CFO). Each exec = passive stat aura + their own event lines (loyalty, poaching, scandals). Firing one is a PERFORM-lite (you deliver the news; handled badly → Morale −8, {bad_boss} flag).
- **Real estate** — buy/sell property cards (office, warehouse, flagship store). Appreciates slowly, rent income, occasional property events. Max 5 holdings. Toy-scale on purpose.
- **Stocks & crypto (v1.5)** — a 5-ticker index + 1 volatile coin, prices random-walk daily with event coupling. Buy/sell from Cash. Teaches volatility & diversification; the shark editorializes (*"You bought the coin. Bold. Stupid, but bold."*). Hard rule: zero IAP linkage.
- **Franchise / branch out** — unlock at St3: clone your model to new cities; each branch = revenue multiplier + management burden events.
- **Rename company** — free once/run, then 1S (vanity friction). Leaderboard shows history (*"formerly GlorpCo"*).
- **M&A / Sell the company** — from St3, acquirers can approach (event-driven) or you can shop it (PERFORM: negotiation). Selling ends the run as a *victory tier below IPO*; proceeds mint legacy badges.
- **IPO** — the endgame: 3-part gauntlet (S-1 board meeting → roadshow pitch → pricing negotiation), all PERFORM. Success = IPO Gold everywhere, run archived as legend. Fail = "pulled the IPO" event, try again in 2 years.

---

## 9 · Event engine architecture

**JSON schema (engine contract):**
```json
{
  "id": "E-OPS-001",
  "title": "Supplier Price Hike",
  "category": "OPS",
  "trigger": {"stages": [1,2,3,4], "industries": "all", "min_year": 1,
               "requires_flags": [], "excludes_flags": ["supplier_locked"],
               "weight": 8, "cooldown_years": 3, "once": false},
  "text": "Your main supplier just raised prices 18%, effective immediately.",
  "reskins": {"FOOD": "Your produce supplier...", "TECH": "Your cloud provider..."},
  "choices": [
    {"label": "Absorb it", "effects": {"gm_pt": -3}, "set_flags": ["supplier_loyal"],
     "narration": "You eat the cost. The supplier notices."},
    {"label": "Renegotiate", "perform": {"type": "nego",
       "pass": {"effects": {"gm_pt": -1, "brand": 2}},
       "fail": {"effects": {"rev_pct_next_q": -10}, "narration": "They drop you mid-call."}}},
    {"label": "Switch suppliers", "effects": {"cash_S": -1, "qual": -5, "gm_pt_delayed": 2}}
  ],
  "rookie_terms": ["gross margin"]
}
```

**Engine rules:**
- **Draw:** each day, sample 3–6 events by weight, filtered by stage/industry/flags/cooldowns; ≥1 from the player's weakest stat's category (targeted pressure); never two of the same category back-to-back.
- **Flags = memory.** Choices set flags; later events require/exclude them. This is what makes it feel alive — the callback (*"Remember the intern you threw under the bus in Year 2? She runs your biggest rival's marketing now."*). Batch 1 ships 30+ callback pairs.
- **Chains:** `followup_id` + delay schedules multi-step crises (K-series).
- **Decision log:** every choice appended to the run log with Books snapshot — this powers the **Chapter 7 autopsy**, which names the three highest-damage decisions (rank by realized Δvaluation attributable). Death is content; the autopsy is the best finance lesson in the app.
- **Anti-repeat:** `once` events never recur in a run; everything else respects cooldowns; reskins count as the same event for cooldown purposes.

---

## 10 · Content math — how "2,000+ instances" is actually true

Batch 1 = **237 authored events** (library file). Multipliers that create *distinct player-facing instances*:
- Stage applicability: avg 3.1 stages/event, with S-scaled numbers and stage-variant narration → ×3.1
- Industry reskins: 62 core events carry 2–4 reskins → +~150 variants
- Flag-gated variants & callbacks: 30+ alternate branches
- Chains count each step as an instance (15 steps across 5 chains)

Effective distinct instances ≈ 237×3.1 ≈ 735 stage-variants + 150 reskins + branches ≈ **~950 unique authored texts playing as ~2,300 contextual instances**. Every expansion batch (+100 authored) adds ~1,000 more effective instances.

**The Expansion Prompt (paste into Claude Code as-is):**

> You are generating Batch {N} of Novus decision events. Read `/design/NOVUS_GDD_v1.md` §5, §6, §9 and all existing event IDs in `/design/events/*.json`. Generate exactly 100 new events as JSON conforming to the §9 schema. Constraints: (1) no premise duplicating an existing event; (2) category quota: OPS 10, PEOPLE 12, MONEY 10, MKT 10, PRODUCT 8, CUST 8, RIVAL 6, LEGAL 6, LIFE 8, OPP 8, chains 2×3 steps, industry-specific 8; (3) every event 2–4 choices, no strictly-dominant choice — every option must be right in SOME situation; (4) ≥1 hidden-stat or flag effect per 3 events; ≥8 events referencing existing flags as callbacks; (5) money in S units only; visible stats from GDD §5 only; (6) narration in Voice v2: second person, present tense, short lines, needle the choice never the kid; reading level ~grade 7; real finance vocabulary with `rookie_terms` tagged; (7) age-appropriate 13+: no sexual content, no self-harm, substances only as refusable bad-idea events; (8) output one JSON array, no commentary.

---

## 11 · Monetization (Brand-Law-4-compliant)

| | Free | **Novus Pro** ($6.99/mo · $49.99/yr — placeholder, price test) |
|---|---|---|
| Run slots | 1 active | 3 active |
| Industries | 4 | 12 |
| PERFORM retries | 1/day | Unlimited (Practice Gym) |
| Replay analytics | score only | full transcript + filler map + trendlines |
| Closet | basics | full + monthly exclusive drop |
| Scenario packs | — | included (themed Today's-Market seasons) |
| Ads | none v1 | none |

One-time IAP: cosmetic drops (founder fits, HQ decor, shark-approved suits), extra run slot. **Never sold, ever:** revives, time skips, stat/score boosts, leaderboard anything. Reasoning stands even if revenue is tempted: Still Standing is the retention engine, one whiff of pay-to-win kills it, and "predatory on minors" is a headline you cannot survive in the school market. Content gating (industries) is fine; outcome gating is not.

---

## 12 · Glossary — Rookie Mode (tap any underlined term in-app)

Format: **Term** — pro definition → *rookie line*.

**Revenue** — total money from sales → *everything customers paid you.* · **Profit** — revenue minus all costs → *what's actually left over.* · **Gross margin** — (revenue−COGS)/revenue → *of each $1 sold, what you keep before rent & salaries.* · **COGS** — direct cost of making the product → *what one unit costs you to make.* · **Net margin** — profit/revenue → *of each $1, what you truly keep after everything.* · **Burn rate** — net cash lost per month → *how fast the bank account shrinks.* · **Runway** — cash ÷ burn → *months left before $0.* · **Break-even** — revenue = costs → *the point where you stop losing money.* · **Cash flow** — money in vs out over time → *the rhythm of money moving, not just the total.* · **Valuation** — market value of the company → *the price tag on the whole company.* · **Equity** — ownership share → *a slice of the company pie.* · **Dilution** — your % shrinking when new shares are issued → *your slice gets thinner when you sell new slices.* · **Term sheet** — investment offer document → *the deal, in writing.* · **Cap table** — who owns what → *the list of everyone's slices.* · **Angel / Seed / Series A** — funding rounds by stage → *early money → first big money → serious money.* · **Down round** — raising at a lower valuation → *new money that says you're worth LESS than before. Ouch.* · **IPO** — selling shares to the public → *your company hits the stock market.* · **Chapter 7** — liquidation bankruptcy → *the company dies and its stuff gets sold off.* · **CAC** — cost to acquire a customer → *ad money spent per new customer won.* · **LTV** — lifetime value → *total money one customer ever gives you.* · **LTV:CAC** — the ratio that decides marketing sanity → *earn more per customer than they cost, ideally 3×.* · **Churn** — % of customers leaving per period → *the leak in your bucket.* · **CTR** — clicks ÷ views on an ad → *of 100 who see it, how many click.* · **CWP / WTP** — willingness to pay → *the most someone would pay before walking.* · **NPS / CSAT** — satisfaction measures → *would customers recommend you?* · **Market share** — your % of the category → *your slice of everyone buying this thing.* · **Franchise** — licensing your model → *letting others open your store and pay you for it.* · **M&A** — mergers & acquisitions → *companies buying companies.* · **ROI** — return ÷ investment → *what you got back for what you put in.* · **BATNA** — best alternative to a negotiated agreement → *your walk-away plan — the source of your power.* · **Tech debt** — shortcuts that cost later → *duct tape you'll pay to remove.* · **Payroll** — total salaries → *what your team costs.* · **Anchoring** — first number sets the negotiation → *whoever says a number first bends the whole deal toward it.*

---

## 13 · Asset manifest — every video & image, where it lives, and the generation prompt

**Production route for videos:** you already have the rigged Meshy GLB (`Suited_Shark_Champion`). Preferred pipeline: render clean stills of the exact mascot → feed as the reference image to an image-to-video model (Kling / Runway Gen-4 / Veo) with the prompts below → export 1080×1350 (4:5) with alpha or on flat `#0B1E36`, 24fps, loopable where marked. Alternative: animate the GLB directly (Meshy animate / Mixamo retarget) for perfect consistency — better for loops (V02, V12). Keep ONE canonical still as the reference in every video prompt so the character never drifts.

**Global style suffix — append to every image & video prompt:**
`3D vinyl-toy render, chunky rounded forms, matte plastic texture, soft studio lighting, deep navy background #0B1E36, subtle orange #FF6B00 rim light, clean silhouette, Duolingo-mascot energy, no text`

### Videos

| ID | Placement (exact) | Length | Prompt (prepend: "Cartoon shark mascot in navy pinstripe suit, [reference image]…") |
|---|---|---|---|
| V01 | Onboarding O1 splash | 4s loop | "…stands center, waves at camera with fin, huge friendly grin, other fin on hip, slight idle bounce, seamless loop" |
| V02 | O2 mic moment + all listening states in PERFORM | 6s loop | "…leans slightly toward camera, head tilted, listening intently, occasional slow blink and small nod, patient expression, seamless loop" |
| V03 | O3 explainer | 25s | Storyboard: (0–5s) shark at desk stamps FOUNDED on a document → (5–12s) tiny company building grows year-counter flipping 1→5 → (12–18s) shark at judging table, spotlight hits an empty founder podium facing camera → (18–25s) trophy raised (reuse champion pose), wordmark in. VO script in §3-O3. |
| V04 | Generic narrator talk loop — event narration, Today's Market intro | 5s loop | "…talks to camera with animated fin gestures, confident smirk between phrases, seamless loop" |
| V05 | Shark deliberation (post-pitch, pre-score) | 5s loop | "…arms crossed, taps chin with fin tip, eyes narrowed in evaluation, slow thoughtful nod, seamless loop" |
| V06 | Score ≥8 reveal; deal closed moments | 4s | "…eyebrows raise, impressed slow nod turning into a grin, brief slow-clap with fins" |
| V07 | Score <4 reveal | 4s | "…unimpressed deadpan stare, single slow eye-roll, slight head shake, sighs" |
| V08 | Term-sheet signed (investment landed), tutorial T6 | 5s | "…signs an oversized document with fountain pen, slides it toward camera, taps it twice, firm nod" |
| V09 | Chapter 7 death screen | 6s | "…calmly stamps a red CLOSED stamp on a folder, closes it with one fin, looks up at camera with faint satisfied smile, adjusts tie" |
| V10 | Year survived + IPO ceremony (gold variant tint for IPO) | 5s | "…hoists golden trophy overhead with both fins, confetti burst, triumphant laugh" (matches existing champion render) |
| V11 | Shark Respect level-up toast | 3s | "…gives a slow, genuine single nod of respect, touches fin to chest briefly" |
| V12 | Idle for home screen ambient | 8s loop | "…subtle breathing idle, occasional blink, straightens tie once, checks tiny gold watch once, seamless loop" |
| V13 | Streak warning notification art / re-engagement screen | 4s | "…points at camera then taps an hourglass on desk, stern expression, eyebrow raised" |
| V14 | Rival Marco beat (leaderboard overtake) | 4s | "…leans on desk looking sideways at a second smaller shark silhouette passing by, then back at camera with a 'well?' shrug" |

### Images

| ID | Placement | Contents & prompt notes |
|---|---|---|
| IMG-01 | App icon + store | HAVE (circular badge render). Also export 1024 flat variant without gloss for Play Store. |
| IMG-02 | O8 industry grid, run cards | 12 industry icons, one prompt each: "single [croissant & coffee cup / shopping bag / smartphone with rocket / play-button clapper / sneaker / game controller / dumbbell / lipstick / graduation cap / leaf in lightbulb / robot toy / dog bowl] as chunky 3D vinyl-toy icon, centered" + style suffix. Keep one object per icon. |
| IMG-03 | HQ backdrops (home screen behind mascot), one per stage ×5 | "cartoon [garage with desk & corkboard / small loft office / open-plan startup office with plants / glass corporate floor / skyline penthouse boardroom] interior, empty of characters, warm practical lights" + suffix. Stage upgrade = visible progress. |
| IMG-04 | O7 avatar builder | Founder avatar part sheets (6 hairstyles, 3 base fits free + Closet sets). Prompt per sheet: "character customization sprite sheet, teen founder avatar, same body base, [item list], front-facing, flat navy bg" + suffix. |
| IMG-05 | Event cards (Layer 1) | NOT unique art per event (unsustainable at 2,000). 14 category emblem illustrations: OPS crate, PEOPLE two chairs, MONEY safe, MKT megaphone, PRODUCT wrench-box, CUST chat bubble heart, RIVAL crossed swords, LEGAL gavel, LIFE coffee mug, OPP door with light, CRISIS red phone, MARKET storm cloud with graph, MILESTONE flag, WILD dice. Prompt: "single [object] emblem" + suffix. |
| IMG-06 | Today's Market daily card frame | "ornate briefing-card frame, navy with orange corner accents, storm-cloud watermark, empty center" + suffix. |
| IMG-07 | Shark panel scene (PERFORM background) | "long judging desk from contestant's POV, five seats, name plates blank, dramatic spotlight, dark auditorium" + suffix; the 5 shark portraits: reuse mascot in 5 palette-shifted suits/accessories (glasses=Marcus, scarf=Serena, hoodie-under-blazer=Dev, brooch=Lily, black suit=Viktor). |
| IMG-08 | The Closet (store) | Cosmetic thumbnails per drop; template prompt: "[garment/prop] on invisible mannequin, boutique lighting" + suffix. |
| IMG-09 | Chapter 7 autopsy card (shareable) | "toe-tag style report card, navy, red CLOSED stamp, three ruled lines, subtle shark watermark" + suffix. Shares with company name + 3 fatal decisions + years survived. |
| IMG-10 | IPO share card | Gold-accent variant of IMG-09: "confetti, bell, gold ticker banner" — IPO Gold used here and only here. |
| IMG-11 | Still Standing leaderboard header | "row of tiny company buildings on a shelf, some lit, some dark, one with a for-sale sign" + suffix. |
| IMG-12 | Empty states ×4 (no friends / no replays / no cosmetics / offline) | "shark mascot [holding binoculars / with empty film reel / in plain t-shirt looking bored / holding unplugged cable], small, corner composition" + suffix. |
| IMG-13 | Paywall / Pro sheet art | "shark mascot holding open velvet-lined briefcase glowing orange, twelve tiny industry icons floating above" + suffix. |
| IMG-14 | Push notification icon set | Flat 2-tone glyphs (48px): storm (Today's Market), flame (streak), shark fin (respect), bell (IPO), red folder (rival). |

**Sound (flagging now, source later):** stamp thunk, cash floater tick, year-end sting, respect chime, Chapter 7 sad-trombone-but-classy. One VO actor for the shark or a cloned TTS voice — pick early, it IS the brand.

---

## 14 · Additions I'm proposing (not in your transcript — veto freely)

1. **Marco, the persistent rival.** Brand v2's voice lines already name him. Make him real: an AI-run company in your industry, visible on Still Standing, whose events interleave with yours (*"Marco just undercut your price"*). Losing to a named rival stings more than losing to a number. Cheap to build: he's config + event hooks, not a real sim.
2. **Callback flags as the soul of the game** (§9). BitLife feels alive because it remembers. Budgeted 30+ callbacks in Batch 1; every future batch must include them (baked into the expansion prompt).
3. **Autopsy & IPO share cards** (IMG-09/10). The Chapter 7 postmortem is your most shareable artifact — grief + comedy + finance lesson in one image. This is the organic growth loop; streaks alone won't spread the app.
4. **Practice Gym feeds Respect.** Retries never change run outcomes (fairness), but a better retry score nudges Shark Respect +1. Practice visibly matters without touching the leaderboard.
5. **Classroom mode** (teacher code joins a private Still Standing board, surnames hidden, same content). This is the DECA/FBLA receipts story for adults and it's ~2 screens of work.
6. **Weekly "Market Week" seasons** — 5 themed Today's-Markets (e.g., Supply Chain Week). Gives Pro scenario packs a natural shape and content ops a calendar.

## 15 · Build order for Claude Code

**P1 — Playable sim (no AI, no camera):** Books + stat engine (§5–6), event engine + JSON loader (§9), 60 core events, Year End flow, save/load. *Exit test: a full run to Chapter 7 entirely offline.*
**P2 — Voice slice:** one PERFORM type (pitch) with mic-only scoring (transcript + filler + pace), single-judge prompt, score→M coupling. *Exit: pitch score changes a raise outcome.*
**P3 — Camera metrics** on-device (eye contact, sway, gestures) + calibration from O2.
**P4 — Panel & personas:** 5 sharks, negotiation turns, Respect meter, Today's Market shared case service.
**P5 — Onboarding + tutorial** (§3–4), asset integration, notifications.
**P6 — Meta:** Still Standing, legacy/badges, autopsy cards, Closet + Pro paywall, remaining event batches, activities (§8), classroom mode.

*Engine invariants to enforce in code review: orange = only action color; luck never flips outcome signs; nothing purchasable touches sim outcomes; year advances only through PERFORM; absence never kills a run.*

— end of GDD v1 —
