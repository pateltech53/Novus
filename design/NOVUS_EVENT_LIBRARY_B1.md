# NOVUS EVENT LIBRARY — Batch 1 (237 authored events)
Data source for the engine (§9 of GDD). Humans edit here; Claude Code converts to JSON via the §10 conversion rules.

## Legend
- Header: `ID · Title · Stages · Industries · w(eight)` — `all` = every industry. `once` = fires max once per run.
- Money in **S** (stage unit, GDD §6): St1=$1K St2=$10K St3=$100K St4=$1M St5=$10M.
- Stats: Cash, Rev% (revenue), GM(pt), Brand, Mor(ale), Qual, CSAT, Churn(pt), Emp, En(ergy), Val%, Resp(ect), Share(pt). Hidden: Risk(legal), TDebt, SupLoy, InvSent, TeamLoy. `(2Q)` = lasts 2 quarters; `(d)` = delayed one year.
- `{flag}` set / `req:{flag}` required / `x:{flag}` excluded. `[P:pitch|nego|consult|board|allhands|media]` = PERFORM; ✓/✗ = pass/fail branches (pass = score ≥6 unless noted).
- Choice rule: no dominant option — every choice is correct in some situation. Narration voice: shark narrator, second person, needles the choice, never the kid.

---

## A · OPS & SUPPLY (16)

**E-OPS-001 · Supplier Price Hike · St1-4 · all · w8**
Your main supplier raises prices 18%, effective now.
A) Absorb it → GM −3 | SupLoy+ {supplier_loyal} · B) Renegotiate [P:nego] ✓ GM −1, Brand +2 ✗ they drop you: Rev −10% (2Q) · C) Switch suppliers → Cash −1S, Qual −5 (2Q), then GM +2 · D) Raise your prices → if Brand ≥60: Rev −2%; else Rev −9%. Rookie: [gross margin]

**E-OPS-002 · The Golden Batch · St1-3 · all · w6 · req:{supplier_loyal}**
Your loyal supplier slips you first pick of premium stock at old prices — "for sticking with us."
A) Take it, market it → Qual +6, GM +2, Brand +3 · B) Take it quietly → Qual +6 · C) Decline, ask for cash discount instead → GM +3, SupLoy−

**E-OPS-003 · Shipment Vanishes · St1-4 · all · w7**
A full shipment is lost in transit. Insurance says 6–8 weeks.
A) Air-freight replacements → Cash −3S, customers never notice · B) Wait it out → Rev −8% (1Q), CSAT −6 · C) Sell what's left as "limited stock" → Rev −3%, Brand +2, {scarcity_play} · D) Blame the courier publicly → CSAT −2, Risk+, courier feud events unlock {courier_feud}

**E-OPS-004 · Warehouse Flood · St2-4 · all · w5**
Burst pipe. A third of inventory is soggy.
A) Write it off → Cash −4S · B) Liquidation flash sale → Cash +1S, Brand −4, CWP erodes: GM −1 · C) File inflated insurance claim → Cash +5S, Risk++ {insurance_fraud} (autopsy magnet)

**E-OPS-005 · The Cheap Factory · St2-4 · all · w7**
A factory abroad offers 40% lower unit costs. Their labor record is… unlisted.
A) Sign → GM +6, {cheap_labor}, Risk+ · B) Audit first (slow) → Cash −1S, then GM +4 clean {audited_supply} · C) Decline, market "made responsibly" → GM −0, Brand +4, {green_cred}. Rookie: [COGS]

**E-OPS-006 · Sweatshop Exposé · St3-5 · all · w6 · req:{cheap_labor} · once**
A journalist publishes your factory's conditions. Your name is in paragraph two.
A) Cut ties on camera [P:media] ✓ Brand −3 only, {reformed} ✗ Brand −12, CSAT −8 · B) Deny → Brand −15 (d), Risk++, {press_enemy} · C) Fund factory reform → Cash −6S, Brand +5 over 2Q, {green_cred}

**E-OPS-007 · Single Point of Failure · St2-4 · all · w6**
You realize 80% of output depends on one machine/vendor/tool.
A) Add a backup now → Cash −2S, immunity to next supply crisis {redundant} · B) Risk it → nothing… until K-SUP chain eligibility doubles · C) Lease instead of buy → Cash −0.5S/yr ongoing, {leasing}

**E-OPS-008 · Quality Shortcut · St1-4 · all · w8**
Ops proposes a cheaper material. Customers "probably won't notice."
A) Take it → GM +4, Qual −7, {cut_corners} · B) Refuse → Mor +2 with builders, GM −0, {quality_first} · C) Test on 10% of stock → GM +1, small CSAT risk, data for later. Rookie: [gross margin]

**E-OPS-009 · The Recall Question · St2-5 · all · w5 · req:{cut_corners}**
A defect traced to the cheap material surfaces in the field.
A) Voluntary recall → Cash −5S, Brand +6 (they remember honesty), clears {cut_corners} · B) Quiet replacements only for complainers → Cash −1S, Risk++, CSAT −4 · C) Ignore → Churn +3, Risk+++, K-LEGAL chain armed

**E-OPS-010 · Port Strike · St2-5 · all · w6**
Every import is stuck offshore for three weeks. (Today's-Market-style, solo version.)
A) Buy local at 2× cost → GM −5 (1Q), CSAT safe · B) Pause sales, be honest → Rev −12% (1Q), Brand +3 · C) Presell "delayed batch" at discount → Cash +2S now, CSAT −5 later

**E-OPS-011 · The Landlord's Squeeze · St1-3 · all · w7**
Lease renewal: rent +35%.
A) Pay → Burn +0.5S/mo · B) Negotiate multi-year lock [P:nego] ✓ +10% only, {rent_locked} ✗ +35% AND a bruised relationship {landlord_feud} · C) Relocate cheaper → Cash −2S once, Brand −2 (customers lose you), Burn −0.3S/mo · D) Go remote/dark kitchen/online-only (industry-dependent reskin) → Burn −0.6S/mo, Mor −5

**E-OPS-012 · Inventory Glut · St2-4 · all · w6**
You over-ordered. Storage is eating margin.
A) Deep discount blowout → Cash +2S, Brand −3, trains customers to wait for sales: CWP −, GM −1 · B) Bundle into gift sets → Rev +4% (1Q), En −5 (you build them) · C) Donate for the write-off → Cash +0.5S, Brand +4, {charity}. Rookie: [cash flow]

**E-OPS-013 · The Counterfeits · St3-5 · all · w6**
Fakes of your product are on marketplaces, at half price.
A) Legal takedowns → Cash −2S, Share +1 back · B) Ignore ("free marketing") → Share −2, but Brand +1 if Qual ≥70 (fakes flatter) · C) Launch verified-authentic program → Cash −1S, CWP +, GM +1, {authenticity}

**E-OPS-014 · Automation Offer · St3-5 · all · w6**
A robotics/software vendor promises −30% labor cost. It would replace nine humans.
A) Automate, lay off → Burn −1S/mo, Mor −12, {bad_boss} risk, Brand −2 if leaked · B) Automate, retrain & redeploy → Cash −3S, Burn −0.5S/mo, Mor +6, {treated_team_well} · C) Decline → Mor +3, cost stays

**E-OPS-015 · The Perfect Storm Forecast · St2-5 · all · w5**
Forecasts say demand doubles next quarter. Ordering ahead is a gamble.
A) Double the order → if next Q has positive market modifier: Rev +18%; else Cash −4S stuck in stock · B) Order +25% safe → Rev +6% either way · C) Hold steady → stockouts if demand spikes: CSAT −6. Rookie: [cash flow]

**E-OPS-016 · Courier Revenge · St2-4 · all · w4 · req:{courier_feud}**
Remember blaming the courier publicly? Their whole network now handles your parcels "carefully."
A) Apologize publicly → Brand −1, clears flag · B) Switch couriers → Cash −0.5S, +1 week delivery: CSAT −3 · C) Build in-house delivery → Cash −3S, Burn +0.3S/mo, CSAT +5, {own_fleet}

---

## B · PEOPLE & TEAM (18)

**E-PPL-001 · The First Hire · St1 · all · w9 · once**
You can't do everything anymore. Two candidates: a versatile friend, or a stranger with the exact skills.
A) The friend → Mor +6, Qual −3, {friend_hire} · B) The stranger → Qual +5, Mor −0, costs 0.2S/mo more · C) Nobody yet → En −8, everything stays yours

**E-PPL-002 · Friend vs Founder · St1-2 · all · w6 · req:{friend_hire}**
Your friend-employee is underperforming and everyone sees it.
A) Fire them yourself [P:allhands-lite] ✓ Mor −3 only, Resp +2, {hard_calls} ✗ Mor −9, friendship over · B) Move them to a role they fit → Mor +4, Burn +0.1S/mo · C) Ignore it → Qual −4, TeamLoy−, top performer notices…

**E-PPL-003 · The Star Asks Double · St2-4 · all · w8**
Your best employee has a competing offer at 2× salary.
A) Match it → Burn +0.3S/mo, others hear: Mor −3 OR +3 if {treated_team_well} · B) Counter with equity → dilution tiny, TeamLoy++, {equity_culture} · C) Let them walk → Qual −6, they may resurface at a rival {star_left} · D) Persuade with vision [P:allhands] ✓ they stay for +20% only ✗ they walk AND tell people why

**E-PPL-004 · Intern Season · St1-3 · all · w7**
Applications from local students. Free-ish labor, real responsibility.
A) Hire 2, mentor properly → En −5, Qual +2, Brand +2 locally, {mentor} · B) Hire 5, throw them in → output +, Risk+ (labor rules), Mor −2 · C) Skip → nothing

**E-PPL-005 · The Scapegoat · St2-4 · all · w6**
A public mistake needs a name attached. The intern touched it last.
A) Take the blame yourself → Brand −3, Mor +8, TeamLoy++, Resp +3 · B) Blame the intern → Brand +0, Mor −10, {intern_blamed} (callback armed) · C) Blame "process," fix it visibly → Brand −1, Qual +2

**E-PPL-006 · The Return · St3-5 · all · w5 · req:{intern_blamed} · once**
The intern you threw under the bus in Year {y}? She runs marketing at your biggest rival now. Their new campaign targets your weakest point precisely.
A) Apologize privately → 50%: neutralized, flag cleared / 50%: screenshot leaked, Brand −5 · B) Counter-campaign → Cash −3S, Share coin-flip ±2 · C) Try to hire her back at a big number [P:nego] ✓ Qual +6, story goes viral: Brand +4 ✗ Brand −3, everyone learns why she left

**E-PPL-007 · Burnout Watch · St2-5 · all · w7**
Your ops lead is answering emails at 3am and snapping at people.
A) Force 2 weeks off, cover it → En −4 (you cover), TeamLoy++, Mor +5 · B) Bonus instead of rest → Cash −1S, works 1Q, then worse: {burnout_risk} · C) "We're a family, push through" → Mor −6, {bad_boss}

**E-PPL-008 · Union Whispers · St3-5 · all · w5**
Employees are discussing organizing.
A) Meet them openly, negotiate [P:nego] ✓ Mor +8, Burn +0.4S/mo, {union_deal} ✗ Mor −5, talks continue · B) Improve pay preemptively → Burn +0.5S/mo, Mor +6 · C) Quietly discourage it → Risk+++, Mor −8, exposé eligibility {union_bust}

**E-PPL-009 · The Toxic Rainmaker · St2-5 · all · w7**
Your top seller brings 20% of revenue and makes two people cry a month.
A) Fire them → Rev −8% (2Q), Mor +10, {values_over_revenue}, Resp +2 · B) Keep, "manage" them → Rev safe, Mor −4/yr ongoing, Churn of staff · C) Final warning + coaching → 50% reform (Mor +4) / 50% they quit loudly (Rev −5%, Brand −2)

**E-PPL-010 · Poach or Grow · St2-4 · all · w6**
You need a marketing head. Poach a rival's (fast, pricey) or promote from within (slow, loyal)?
A) Poach → Cash −1S signing, Qual +4, {poached_star}, rival feud + · B) Promote → Mor +8, Qual +1 now +3 (d), TeamLoy++ · C) Fractional/agency → Burn +0.2S/mo, flexible, no loyalty

**E-PPL-011 · The Résumé Lie · St2-4 · all · w5 · req:{poached_star}**
Your poached star's famous "campaign they led"? They were an observer. A rival exec tells you at an event, smiling.
A) Confront & demote → Mor −2, Qual −2, honesty kept · B) Quietly verify then fire → Cash −0.5S severance, {hard_calls} · C) It's working, ignore → if exposed later: Brand −6

**E-PPL-012 · Pay Transparency Demand · St3-5 · all · w5**
Someone posts an anonymous spreadsheet of everyone's salaries. It's accurate. Gaps are visible.
A) Publish official bands, fix gaps → Cash −2S, Mor +9, Brand +3, {transparent_pay} · B) Hunt the leaker → Mor −10, {bad_boss} · C) Acknowledge, fix quietly over a year → Mor +2, slow burn

**E-PPL-013 · The Co-founder Question · St1-2 · all · w6 · once**
A talented friend wants in as co-founder for 30% equity.
A) Yes → En +10 ongoing, decisions get contested (new event line), dilution 30% {cofounder} · B) No, offer employee #1 + 5% → 60% they accept / 40% they walk and build something adjacent {rival_seed} · C) Trial project first → delays help 1Q, cleaner data

**E-PPL-014 · Co-founder Clash · St2-4 · all · w6 · req:{cofounder}**
Your co-founder wants to pivot. You don't. The team is picking sides.
A) Board-style debate, commit to winner [P:board] ✓ Mor +5, alignment ✗ Mor −6, wound festers · B) Split responsibilities ("you run that, I run this") → peace now, strategy drift: Qual −2/yr · C) Buy them out → Cash −6S or debt, {solo_again}, Mor −4 then recovers

**E-PPL-015 · Hiring Freeze or Slow Fire · St3-5 · all · w6**
Costs are up. Finance says cut payroll 10% — by freeze, layoff, or across-the-board pay cuts.
A) Layoff 10% cleanly, generous severance → Cash −2S once, Burn −0.8S/mo, Mor −8 (−4 if {treated_team_well}) · B) Everyone −10% pay incl. you → Burn −0.6S/mo, Mor −5, TeamLoy+ for staying visible · C) Freeze & attrition → slow: Burn −0.3S/mo, overwork: Qual −3

**E-PPL-016 · The Nephew · St2-5 · all · w4**
An investor "suggests" you hire their nephew. He is… enthusiastic.
A) Hire him somewhere harmless → InvSent +, Burn +0.1S/mo, Mor −2 · B) Decline politely → InvSent −, Resp +1 · C) Trial week, let results decide → 30% he's secretly great (Qual +3) / 70% awkward exit, InvSent −1

**E-PPL-017 · All-Hands After the Bad Quarter · St2-5 · all · w6**
Numbers are ugly. The team knows. Rumors are worse than reality.
[P:allhands only] ✓ Mor +8, Churn of staff avoided, Resp +1 ✗ Mor −4, two resignations (Emp −2, Qual −2). (No tap-out option — some moments you must speak.)

**E-PPL-018 · The Loyalty Test · St3-5 · all · w4 · req:{treated_team_well} · once**
A rival offers your whole senior team a package deal to defect. They show you the offer themselves — and stay.
→ Mor +10, Brand +3 (story spreads), TeamLoy locked max. Narration only; the reward IS the years of choices. Shark: "Can't buy that. You built it."

---

## C · MONEY & FINANCE (16)

**E-FIN-001 · The Bank Loan · St1-3 · all · w7**
The bank offers 8S at 12% interest. Runway says yes. Pride says no.
A) Take it → Cash +8S, Burn +0.1S/mo interest, {debt_taken}. Rookie: [runway] · B) Take half → Cash +4S, lighter drag · C) Decline → Resp +1 if you survive the year, autopsy line if you don't

**E-FIN-002 · The Family Check · St1 · all · w6 · once**
A relative offers 5S "no strings." There are always strings.
A) Accept → Cash +5S, {family_money}: future holiday events get spicy · B) Accept as a formal loan with paper → Cash +5S, small interest, relationship protected · C) Decline → En +2 (pride), harder year

**E-FIN-003 · Invoice Black Hole · St2-4 · all · w8**
Your biggest client is 90 days late on a 6S invoice. They're 30% of revenue.
A) Demand payment, halt service [P:nego] ✓ paid in full ✗ they leave: Rev −12% · B) Offer 10% discount for cash now → Cash +5.4S, GM −1, precedent {discounter} · C) Wait politely → 50% paid next Q / 50% they collapse owing you everything. Rookie: [cash flow]

**E-FIN-004 · The Tax Letter · St2-5 · all · w6**
An audit notice. Your books are… artisanal.
A) Hire a real accountant → Cash −1S, clean bill, Burn +0.1S/mo, {clean_books} · B) DIY the response → En −10, 60% fine 1S / 40% fine 4S + Risk+ · C) req:{insurance_fraud} or {cut_corners}: sweat → fine 6S, Risk++, autopsy magnet

**E-FIN-005 · Currency Whiplash · St3-5 · all · w5**
Your import currency jumps 15%.
A) Hedge going forward → Cash −0.5S/yr, immunity {hedged} · B) Eat it → GM −3 (2Q) · C) Reprice regionally → Rev −3% in that region, GM safe

**E-FIN-006 · The Convertible Note · St2-3 · all · w6**
An angel offers 10S on a convertible note, 20% discount cap. Founders around you pretend to understand it.
A) Sign after actually reading (Rookie explainer plays) → Cash +10S, dilution (d), InvSent +, Resp +1 · B) Ask for a priced round instead [P:pitch] ✓ better terms, dilution known ✗ they walk · C) Decline → independence, tighter year. Rookie: [dilution] [term sheet]

**E-FIN-007 · Down Round or Die · St3-4 · all · w5**
Runway: 3 months. The only term sheet values you 40% below last round.
A) Take it → Cash +12S, Val −40%, InvSent −, survival {down_round} · B) Bridge loan from insiders [P:board] ✓ Cash +6S, Val intact ✗ nothing, 2 months left · C) Emergency cost surgery → Burn −40%, Mor −10, Emp −15%. Rookie: [down round]

**E-FIN-008 · The Acquirer's First Kiss · St3-4 · all · w5 · once**
A bigger company "wants to explore synergies." Translation: they might buy you — or just photograph your kitchen.
A) Take the meeting, share carefully → 30% real offer event unlocks / 70% nothing, {shared_deck} risk · B) Decline flat → Resp +2, mystery forever · C) NDA first, then talk → slower, safer, {nda_shield}

**E-FIN-009 · Dividend or Reinvest · St4-5 · all · w6**
Profit is real this year. Take money off the table?
A) Pay yourself/shareholders → Cash −4S from company, En +10, growth −: Rev −2% next yr · B) Reinvest all → Rev +5% next yr, En −3 · C) 50/50 → halves of both. Rookie: [profit]

**E-FIN-010 · The Crypto Treasury Pitch · St3-5 · all · w4**
Your CFO (or a podcast) suggests holding 20% of treasury in crypto.
A) Do it → {crypto_bag}: treasury swings ±25% with coin events · B) 2% "learning position" → tiny swings, you learn the sim · C) Absolutely not → Viktor the shark nods somewhere. Rookie: [ROI]

**E-FIN-011 · Factoring Offer · St2-4 · all · w5**
A firm will buy your unpaid invoices at 92 cents on the dollar. Cash today, margin gone.
A) Factor them → Cash now, GM −2 that Q, {factoring} habit risk · B) Only the risky invoices → balanced · C) Never → patience, exposure to more E-FIN-003s

**E-FIN-012 · The Grant Maze · St1-2 · all · w6**
A small-business grant exists: 3S, forty pages of forms.
A) Grind the paperwork → En −8, 70% Cash +3S · B) Hire a grant writer → Cash −0.3S, 85% Cash +3S · C) Skip → time for product instead: Qual +1

**E-FIN-013 · Pricing Power Test · St2-5 · all · w7**
Data says customers' willingness to pay sits above your price.
A) Raise prices 10% → if Qual ≥60: Rev +6%, GM +3; else Churn +2 · B) Add a premium tier → Rev +4%, complexity: En −3 · C) Keep price, take share → Share +1, GM flat. Rookie: [CWP]

**E-FIN-014 · The Embezzler · St3-5 · all · w4 · once**
Numbers don't reconcile. Someone in finance skimmed 0.5S/quarter for a year.
A) Police + prosecute → 50% recovered, Brand −2 (leaks), {hard_calls} · B) Quiet firing + repayment plan → 80% back slowly, Risk+ (concealment) · C) req:{clean_books}: your accountant caught it in month two → 95% back, Mor +3 (systems work)

**E-FIN-015 · Buy vs Rent Everything · St2-3 · all · w5**
Equipment decision: own assets or stay lean?
A) Buy → Cash −4S, Burn −0.2S/mo, Val +2% · B) Rent → flexibility, Burn +0.3S/mo, {leasing} · C) Buy used → Cash −2S, 20% breakdown-event risk

**E-FIN-016 · The Personal Guarantee · St1-2 · all · w4 · req:{debt_taken}**
The bank wants YOUR name on the company's debt to extend the line.
A) Sign → Cash +4S available, Chapter 7 hits founder legacy harder (autopsy notes it) · B) Refuse, smaller line → Cash +1S · C) Refinance elsewhere [P:nego] ✓ same money, no guarantee ✗ nothing + this bank sulks

---

## D · MARKETING & GROWTH (16)

**E-MKT-001 · The Viral Accident · St1-3 · all · w5 · once**
Someone posts your product doing something unintended. 2M views overnight.
A) Lean in, remix it → Brand +10, Rev +12% (1Q), {viral_fame} · B) Correct the record → Brand +2, dignity intact · C) Stay silent → Brand +4, moment passes

**E-MKT-002 · Influencer Roulette · St1-4 · all · w8**
Same budget, three doors: one big influencer (2S), twenty micro-creators (2S), or performance ads (2S).
A) Big name → 60% Brand +8, CTR +2 / 40% dud {influencer_burn} · B) Micro army → Brand +4 reliable, CSAT +2 · C) Performance ads → CTR +3, CAC −, no Brand. Rookie: [CTR] [CAC]

**E-MKT-003 · The Edgy Ad · St2-5 · all · w7**
The new ad is genuinely funny and definitely risky.
A) Run it → 65% Brand +9 {edgy_brand} / 35% backlash: Brand −7 · B) Focus-group it → Cash −0.5S, sanded safe: Brand +3 · C) Kill it → Mor −3 (creatives sulk), nothing risked

**E-MKT-004 · Apology Tour · St2-5 · all · w5 · req:{edgy_brand}**
The follow-up ad went too far. Screenshots everywhere.
[P:media only] ✓ Brand −2, handled, {crisis_vet} ✗ Brand −9, boycott hashtags: Rev −6% (1Q). No tap-out — you're the face.

**E-MKT-005 · Sponsor the Local Team · St1-3 · all · w6**
The local youth league wants 0.5S for jersey space.
A) Yes → Brand +4 locally {community} · B) Yes + show up personally → En −4, Brand +6 {community} · C) No → 0.5S saved

**E-MKT-006 · Discount Spiral Warning · St2-4 · all · w7 · req:{discounter}**
Customers now wait for your sales. Full-price weeks are dead.
A) Cold turkey, no sales 2Q → Rev −8% (1Q), then CWP recovers: GM +2 · B) Loyalty program instead → Cash −1S build, Churn −2 · C) Keep discounting → GM −1/yr compounding (autopsy magnet)

**E-MKT-007 · The Rebrand Itch · St2-4 · all · w5**
Your logo looks tired next to competitors. Agency quote: 3S.
A) Full rebrand → Cash −3S, Brand −3 (1Q confusion) then +8 · B) Refresh only → Cash −1S, Brand +3 · C) "The logo isn't the problem" → Qual +2

**E-MKT-008 · Billboard vs Search · St3-5 · all · w6**
Same budget: one glorious downtown billboard, or a quarter of search ads.
A) Billboard → Brand +6, unmeasurable, Mor +2 (team pride) · B) Search → CTR +2, CAC data improves, Rev +3% · C) Split → Brand +3, Rev +1%, everyone mildly satisfied

**E-MKT-009 · The Comparison Ad · St3-5 · all · w5**
Legal says naming your rival in ads is technically allowed.
A) Name them, show benchmarks → Share +2, {marco_feud}, Risk+ · B) "The leading brand…" → Share +1, coward's discount · C) Ignore rivals → Brand +2 (confidence read)

**E-MKT-010 · Door to Door · St1 · all · w7**
Old school: you, a bag of product, every business on Main Street.
A) A full week → En −12, Rev +8%, 3 real relationships {street_cred}, Resp +2 · B) One afternoon → En −4, Rev +2% · C) Hire students to do it → Cash −0.5S, Rev +4%, no relationships

**E-MKT-011 · The Newsletter Nobody Reads · St2-4 · all · w5**
Email list: 12,000 addresses, 4% open rate.
A) Cut to the engaged 2,000, write like a human → CTR +3, CSAT +2 · B) Blast harder → Churn +1, spam-folder purgatory · C) Kill it → En +2, one channel fewer

**E-MKT-012 · Buy the Competitor's Keyword · St3-5 · all · w4**
Bidding on your rival's brand name in search: effective, petty, or both?
A) Bid → Share +1, {marco_feud}, they bid back: CAC + next Q · B) Don't → peace dividend · C) Propose a truce [P:nego] ✓ both stop, CAC −1 ✗ they screenshot your offer; mild embarrassment

**E-MKT-013 · The Documentary Request · St3-5 · all · w4 · once**
A streaming crew wants to film your company for a season. Warts and all.
A) Full access → 60% Brand +12 {famous} / 40% they find the warts: Brand −8 (auto-fail if {cut_corners} or {bad_boss} — the edit finds everything) · B) Controlled access → Brand +4, "authenticity" reviews mixed · C) Decline → mystique +1

**E-MKT-014 · Cause Marketing Fork · St2-5 · all · w5**
Marketing wants the brand attached to a social cause this quarter.
A) Pick one you actually act on → Brand +5 if {charity} or {green_cred}, else +1 and "performative" comments · B) Donate quietly, no campaign → CSAT +2, {charity} · C) Stay out of causes → controversy immunity

**E-MKT-015 · The Mascot Decision · St2-4 · all · w4**
An agency pitches a company mascot. Narrator: "Careful. Mascots judge you back."
A) Commission it → Cash −1S, Brand +5 with under-25s, Closet cosmetic line unlocks · B) Internal design contest → Mor +5, Brand +2, jank +1 · C) No mascot → seriousness preserved

**E-MKT-016 · Data-Driven or Gut · St3-5 · all · w5**
Your CMO's data says one thing. Your gut — and three loyal customers — say another.
A) Follow the data → Rev +3% · B) Follow the gut → 45% Rev +7% {founder_instinct} / 55% Rev −4% · C) Test both small → truth next Q, Resp +1 (the shark loves tests)

---

## E · PRODUCT & TECH (14)

**E-PRD-001 · Launch Now or Polish · St1-3 · all · w8**
The new product is 85% ready. Marketing wants it yesterday.
A) Ship now → Rev +6%, Qual −4, TDebt+ {ship_fast} · B) Six more weeks → Rev delayed, Qual +5, rival-window risk · C) Beta to superfans → Rev +2%, CSAT +4, Qual +3 (d)

**E-PRD-002 · The Big Flaw · St2-5 · all · w7 (2× weight if {ship_fast})**
A serious defect surfaces post-launch. Refund requests incoming.
A) Own it loudly, fix fast → Cash −2S, Brand +4, CSAT +3 {crisis_vet} · B) Patch quietly → Cash −1S, 40% it becomes a story: Brand −6 · C) req:{quality_first}: QA caught it pre-launch → narration-only flex, CSAT +2

**E-PRD-003 · Feature Creep Council · St2-4 · all · w7**
Every department wants one more feature before launch.
A) Cut to core, ship → Qual +3, Mor −2 (pet features die) {focus} · B) Take all requests → delay 1Q, TDebt++, Qual −2 · C) Public vote → Mor +3, mediocre middle

**E-PRD-004 · The Pivot Question · St1-3 · all · w5 · once**
Customers keep using your product for something you didn't intend — and paying for it.
A) Pivot to the real use → Rev −10% (1Q) then +20%/yr {pivot}, Resp +3 · B) Serve both → En −5, TDebt+ · C) Stay the course → vision intact, market shrugs

**E-PRD-005 · Patent or Speed · St2-4 · all · w5**
Your innovation is patentable. Filing costs 1.5S and a quarter of focus.
A) File → Cash −1.5S {patent}: license income + copycat immunity · B) Trade-secret it → speed kept {secret_sauce}, leak risk if Mor low · C) Publish it openly → Brand +6 with builders, moat −

**E-PRD-006 · The Copycat · St2-5 · all · w7**
A rival ships a near-clone of your best feature.
A) req:{patent}: lawyers feast → Cash +2S settlement, Resp +1 · B) Out-innovate, announce v2 [P:pitch-to-press] ✓ Brand +5, Share holds ✗ "vaporware" jokes: Brand −3 · C) Price-cut response → Share +1, GM −2, race to the bottom armed

**E-PRD-007 · Tech Debt Collector · St3-5 · all · w6**
Engineers: stop everything for a quarter and rebuild, or keep duct-taping.
A) The Great Refactor → Rev flat 1Q, TDebt cleared, Qual +6 (d), Mor +4 · B) Duct tape harder → speed now, outage odds double (arms K-TEC chain) · C) Rebuild in slices → Rev −2% (2Q), safe middle. Rookie: [tech debt]

**E-PRD-008 · The AI Feature Rush · St2-5 · all (2× TECH/EDTECH/ECOM) · w6**
Everyone's adding AI. Yours would be… fine.
A) Ship the fine version → Brand +3 now, CSAT −2 when novelty fades · B) Wait for a real use case → Brand −1 ("behind"), then +5 when yours lands (d) · C) Partner with a startup → Cash −1S, speed + credibility {partner_dependency}

**E-PRD-009 · Accessibility Audit · St2-5 · all · w5**
An audit finds your product excludes users with disabilities.
A) Fix comprehensively → Cash −1.5S, CSAT +4, Brand +3, market widens: Rev +2% {inclusive} · B) Legal minimum → Risk cleared, nothing gained · C) Backlog it → Risk+, a viral-complaint event armed

**E-PRD-010 · Good/Better/Best · St3-5 · all · w5**
Product wants three pricing tiers.
A) Three tiers → Rev +5%, support complexity: CSAT −2, GM +1 · B) Two tiers → Rev +3%, clean · C) One perfect thing → Brand +3 (clarity), lower ceiling. Rookie: [CWP]

**E-PRD-011 · The Supplier's New Toy · St2-4 · all · w5 · req:{supplier_loyal}**
Your supplier offers first access to a new material/tech before rivals see it.
A) Exclusive deal → Cash −1S, Qual +5, 2-year moat {exclusive_supply} · B) Non-exclusive, cheaper → Qual +3, rivals get it in 6 months · C) Pass → boring, safe

**E-PRD-012 · Kill Your Darling · St3-5 · all · w6**
Your original product — the one that started everything — now loses money monthly.
A) Sunset it with honors → Burn −0.4S/mo, Brand −2, Mor −3 then heals {focus} · B) Keep as loss-leader → Burn stays, Brand +2 (loyalty story) · C) License it out → Cash +1S {ip_sold}; it may compete with you someday

**E-PRD-013 · The Standards War · St3-5 · all (2× TECH/GAMING) · w4**
The industry is picking between two standards. You must bet.
A) Bet the leader → safe, Share +1 · B) Bet the underdog → 30% Share +5 {kingmaker} / 70% costly migration later: Cash −3S · C) Support both → double cost, immunity

**E-PRD-014 · Customer-Built Feature · St2-4 · all · w5**
A superfan built an unofficial add-on better than your roadmap version.
A) Hire them → Cash −0.5S, Qual +5, Brand +4 {mentor} · B) License it → Qual +4, they stay independent · C) Cease & desist → legal cleanliness, Brand −6 with your best fans. Shark: "You sued your biggest fan. Bold strategy."

---

## F · CUSTOMERS (12)

**E-CUS-001 · The One-Star Novelist · St1-4 · all · w8**
A detailed, viral, partly-unfair one-star review.
A) Reply publicly, fix the fair parts → CSAT +4, Brand +2 {listens} · B) Report it → 40% removed / 60% "company tried to silence critic": Brand −5 · C) Ignore → Churn +1

**E-CUS-002 · The Whale · St2-4 · all · w6**
One client wants a custom version — worth 25% of annual revenue, on their terms.
A) Take it → Rev +25% this yr, roadmap hijacked: Qual −3, {whale_dependency} · B) Take it with boundaries [P:nego] ✓ Rev +18%, roadmap safe ✗ they walk · C) Decline → focus intact, finance quietly weeps. Rookie: [LTV]

**E-CUS-003 · Whale Overboard · St3-4 · all · w5 · req:{whale_dependency}**
The whale demands exclusivity or they leave.
A) Concede exclusivity → Rev safe, growth capped: Share frozen 2yr · B) Refuse → Rev −20% (1Q), freedom, Resp +3 · C) Counter with premium pricing [P:nego] ✓ Rev +5%, terms yours ✗ they leave loudly: Brand −3

**E-CUS-004 · Refund Storm · St2-5 · all · w6**
A batch problem triggers 200 refund requests in a week.
A) No-questions refunds → Cash −2S, CSAT +6, {generous} · B) Case-by-case → Cash −1S, CSAT −2, support drowning: Mor −3 · C) Store credit only → Cash −0.2S, CSAT −5, Risk+ (consumer law)

**E-CUS-005 · The Superfan Club · St2-4 · all · w5**
Fans want an official community. Communities are wonderful until they aren't.
A) Build it, staff it → Burn +0.1S/mo, CSAT +5, Churn −2, free R&D {community} · B) Bless a fan-run one → free, 15% drama-event risk · C) No community → quiet

**E-CUS-006 · Grandma's Complaint · St1-3 · all · w5**
An elderly customer can't use your product and wrote you a paper letter about it.
A) Visit/call personally, fix her case → En −3, story spreads: Brand +5 {community} · B) Ship an easy-mode update → Cash −0.5S, market widens: Rev +2% · C) Politely template-reply → nothing, tiny shame

**E-CUS-007 · Data Request · St2-5 · all · w5**
A partner offers 2S/yr for your anonymized customer data.
A) Sell it → Cash +2S/yr, {data_loose}: exposé event armed, Risk+ · B) Decline, market privacy → Brand +4 with the paranoid, {privacy_first} · C) Sell aggregated stats only → Cash +0.5S/yr, defensible

**E-CUS-008 · The Loyalty Points Trap · St2-4 · all · w5**
Your points program is popular — and now a 3S liability on the books.
A) Devalue points quietly → Cash saved, 30% outrage: Brand −6 · B) Honor + sunset with notice → Cash −1.5S, CSAT +3 · C) Convert to experiences (events, merch) → Cash −0.5S, Brand +3

**E-CUS-009 · B2B Pivot Knock · St2-4 · all · w5**
A chain wants to stock/white-label you for wholesale prices.
A) Yes, volume game → Rev +15%, GM −4, {wholesale} · B) No, protect brand & margin → GM safe, slower growth · C) Limited exclusive line for them → Rev +8%, GM −1, complexity En −3

**E-CUS-010 · Review Bribery Temptation · St1-3 · all · w5**
An agency sells "guaranteed 5-star reviews." Rivals clearly use it.
A) Buy → CSAT display +, {fake_reviews}: platform-purge event armed, Risk++ · B) Ask real customers, incentives disclosed → CSAT +2 slow, clean · C) Report the agency → 20% rivals purged: Share +2 / 80% nothing, petty glow

**E-CUS-011 · The Accessibility Letter · St2-5 · all · w4 · req:{inclusive}**
A disability-advocacy org features you as a model company. Invites you to speak.
[P:media optional] ✓ Brand +6, hiring pipeline improves: Qual +2 ✗ Brand +1 (showing up counted) · or decline → nothing

**E-CUS-012 · Churn Autopsy · St3-5 · all · w6**
Churn ticked up two quarters straight. Nobody knows why.
A) Exit-interview 50 leavers → Cash −0.3S, truth revealed: pick a fix next Q (Churn −3 d) · B) Win-back discount blast → Churn −1 now, {discounter}, returns churn again later · C) Assume it's the market → autopsy magnet. Rookie: [churn]

---

## G · RIVALS (10) — Marco is the persistent rival (GDD §14); these interleave with his sim.

**E-RIV-001 · Marco Launches First · St1-3 · all · w7**
Marco ships the exact thing on your roadmap, two months early.
A) Ship yours anyway, better → delay pressure: Qual −2 or wait · B) Reposition against his flaws [P:pitch-to-press] ✓ Share +2 ✗ "salty" headlines: Brand −2 · C) Do nothing loudly, keep building → Resp +1

**E-RIV-002 · The Price War Bell · St2-4 · all · w7**
Marco cuts prices 20%.
A) Match → GM −5, Share holds · B) Hold price, add value → Share −2 (1Q), then CWP + if Qual ≥65 · C) Segment: cheap line + premium line → complexity En −4, Share +1. Rookie: [gross margin]

**E-RIV-003 · Poach Attempt Incoming · St2-4 · all · w6**
Marco offers your #2 a title bump and 40% raise.
A) Counter (money) → Burn +0.3S/mo · B) Counter (scope + equity) → TeamLoy++, dilution tiny · C) Let them go gracefully → Qual −4, alumni goodwill {alumni_network} · D) req:{treated_team_well}: they decline him unprompted → Mor +5, narration flex

**E-RIV-004 · The Leak · St3-5 · all · w5**
Your unannounced product appears on a rumor account. Only five people knew.
A) Internal hunt → Mor −6, 60% find them / 40% paranoia only · B) Shrug publicly, ship sooner → Rev pulled forward, Qual −2 · C) Feed a fake next time → {counterintel}: next leak event auto-wins, Resp +2

**E-RIV-005 · Marco Stumbles · St2-5 · all · w6**
Marco has a public quality scandal. His customers are shopping.
A) Attack ads now → Share +3, Brand −2 (kicking a man down), {marco_feud} · B) Welcome offer, classy tone → Share +2, Brand +2 · C) Silence + capacity prep → Share +1 slower, operationally safe

**E-RIV-006 · The Standards Cartel · St3-5 · all · w4**
Three rivals invite you to "align on industry standards." Half-noble, half-cartel.
A) Join → stability: market_modifier volatility −, Risk+ (antitrust if St5) · B) Decline, publicize your own open standard → Brand +4, {kingmaker} path · C) Attend, commit nothing → information +, one free rival-intel event

**E-RIV-007 · Copy His Homework · St2-4 · all · w5**
Marco's new feature is objectively good. Copying is legal and shameless.
A) Copy fast → Share holds, Brand −1 ("follower"), Marco taunt event · B) Copy + improve visibly → Qual +3, Share +1, slower · C) Refuse on principle → differentiation deepens: CWP +, Share −1 short-term

**E-RIV-008 · The Merger Whisper · St4-5 · all · w4 · once**
A banker floats it: you + Marco, merged, would dominate.
A) Explore [P:nego] ✓ MERGER arc unlocks (endgame variant) ✗ leak: both Brands −3, feud max · B) Never → Resp +2, rivalry eternal · C) Leak it yourself to spook him → 50% he stumbles / 50% you look desperate

**E-RIV-009 · Marco's Podcast Jab · St2-5 · all · w6**
On a popular podcast, Marco calls your company "a rounding error with a logo."
A) Reply with numbers, one post → Brand +3 if Rev grew last yr, else −2 · B) Invite him to a public debate [P:media] ✓ Brand +6, Resp +2 ✗ clipped and memed: Brand −4 · C) Silence → Resp +1, fans want blood

**E-RIV-010 · New Kid Undercuts Everyone · St3-5 · all · w5**
A tiny new startup does one thing you do — 10× cheaper, kind of broken.
A) Ignore (they're broken) → 30% they fix it: Share −3 (d) · B) Acquire them cheap → Cash −4S, talent + moat, integration drag: Qual −2 (1Q) · C) Partner: their edge, your scale → Rev +4%, {partner_dependency}

---

## H · LEGAL & RISK (12)

**E-LGL-001 · The Cease & Desist · St1-3 · all · w6**
A big company claims your name is too close to theirs. It isn't, really.
A) Fight it → Cash −1.5S legal, 75% win: Brand +3 (David story) / 25% forced rename · B) Rename preemptively → Cash −0.5S, Brand −3 (1Q), fresh start · C) Settle: tiny tweak to logo → Cash −0.2S, nobody notices

**E-LGL-002 · The Patent Troll · St3-5 · all · w5**
A shell company with a vague patent demands 2S "licensing."
A) Pay the toll → Cash −2S, {troll_marked}: they return bigger (d) · B) Fight → Cash −3S over a year, 80% win + troll immunity, Resp +2 · C) Rally the industry, share defense costs → Cash −1S, Brand +3 with peers

**E-LGL-003 · Regulation Drops · St3-5 · all · w6**
New rules hit your category. Compliance costs 3S; enforcement starts next year.
A) Comply early, market it → Cash −3S, Brand +4, {compliant}: inspection events auto-pass · B) Comply at deadline → Cash −3S (d), no glow · C) Lobby + delay → Cash −1S, 40% rules soften / 60% wasted + Risk+

**E-LGL-004 · The Handshake Deal · St1-2 · all · w6**
A partner wants to skip contracts. "We're friends."
A) Insist on paper → friction now, immunity to betrayal events · B) Handshake → speed, {handshake_deal}: betrayal event armed at 30% · C) Simple one-pager compromise → mostly safe, still friendly

**E-LGL-005 · Betrayed · St2-3 · all · w5 · req:{handshake_deal}**
The handshake partner "remembers the terms differently." Their memory favors them by 3S.
A) Sue → Cash −1S, 50/50, relationship dead · B) Renegotiate [P:nego] ✓ recover 2S, keep partner ✗ recover 0, keep dignity · C) Eat it, cut ties, tell the story → Cash −3S, Brand +2 (warning others) {hard_calls}

**E-LGL-006 · GDPR-ish Letter · St2-5 · all (2× TECH/ECOM/EDTECH) · w5**
A data-protection authority asks how you store customer data. You ask your engineer. Your engineer goes quiet.
A) Full audit + fix → Cash −1.5S, {privacy_first} · B) Answer optimistically → 65% fine 0 / 35% fine 4S + Brand −5 · C) req:{data_loose}: the letter is about the data you sold → fine 5S, Brand −8, flag cleared the hard way

**E-LGL-007 · The NDA Job Interview · St2-4 · all · w4**
A candidate from a rival offers "everything I know" in the interview.
A) Stop them, hire on merit only → Resp +3, {clean_hands} · B) Listen, don't hire → intel +1 free rival event, Risk+, karma − · C) Hire them AND use it → Qual +3, Risk+++, lawsuit event armed at 40%

**E-LGL-008 · Insurance Reckoning · St2-4 · all · w5**
Your broker upsells: full coverage costs 0.4S/yr more.
A) Full coverage → Burn +, next disaster event damage halves {insured} · B) Basic only → cheaper, pray · C) req:{insurance_fraud}: they investigated your old claim → policy canceled, Risk++, uninsurable 2yr

**E-LGL-009 · The Age Rating Fight · St2-4 · GAMING/CONTENT/TOYS · w5**
A ratings board challenges your product's age classification.
A) Comply, soften content → market widens: Rev +3%, superfans grumble: CSAT −2 · B) Fight with lawyers → Cash −1S, 60% win: Brand +3 edge intact · C) Two versions → cost +, both markets

**E-LGL-010 · Whistleblower Email · St3-5 · all · w4 · once**
An employee emails you directly: a manager has been falsifying safety/quality reports.
A) Investigate openly, protect the whistleblower → Mor +6, short-term Qual −2 (truth surfaces), {clean_hands}, Resp +3 · B) Quietly fix, quietly bury → Risk++, {coverup} autopsy magnet · C) Shoot the messenger → Mor −12, {bad_boss}, exposé event armed at 50%

**E-LGL-011 · Import Papers · St2-4 · all · w5**
Customs holds your shipment over a paperwork technicality. A "broker" offers to make it disappear for 0.3S.
A) Pay the broker → shipment freed, {grey_customs}: Risk+, repeat demands (d) · B) Do it properly, 3 weeks → Rev −4% (1Q), clean · C) Restructure supply to avoid the route → Cash −1S once, immunity

**E-LGL-012 · Terms of Service Nobody Read · St2-5 · all · w4**
A lawyer flags that your own ToS accidentally promises lifetime free support.
A) Honor it for existing users, fix for new → Burn +0.1S/mo, Brand +4 {generous} · B) Silent retroactive edit → 25% caught: Brand −7, Risk+ · C) Public oops + gift to affected users → Cash −0.5S, Brand +3, CSAT +3

---

## I · FOUNDER LIFE (12) — Energy is a real stat; the founder is a person. Teen-appropriate always.

**E-LIF-001 · The 3AM Idea · St1-3 · all · w7**
You wake up with a "brilliant" idea and the urge to rebuild everything.
A) Sleep on it 48h → 70% it evaporates (En +2) / 30% it's real: unlock a pivot-lite option next Q · B) Act tonight → En −8, 25% genius Qual +4 / 75% mess: TDebt+ · C) Write it down, park it → an idea-bank event later pays +Qual

**E-LIF-002 · Exam Season vs Launch Week · St1-2 · all · w6**
Real life collides: the biggest school/personal commitment of your year lands on launch week.
A) Delegate the launch → Mor +5 (trust), 20% minor launch stumble · B) Do both, sleep never → En −15, {burnout_risk}, both slightly worse · C) Move the launch → Rev delayed 1Q, sanity kept, Resp +1 ("knowing your limits is strategy")

**E-LIF-003 · The Burnout Wall · St2-5 · all · w6 · req:{burnout_risk} or En<25**
You snapped at someone who didn't deserve it. Your body is sending invoices.
A) Two real weeks off → En +30, Rev −2% (1Q), {balanced}, Mor +3 (you apologized) · B) Push through → En floor, next 3 decisions show one fewer choice option (impaired judgment — mechanical, felt) · C) Therapy/coach + boundaries → Cash −0.2S, En +15 sustained, {balanced}

**E-LIF-004 · Old Friends, New Distance · St2-4 · all · w5**
Your friends planned a trip. You "can't." You always "can't" now.
A) Go → En +12, Cash −0.3S, one random small fire unattended (−1% Rev) · B) Skip again → En −5, {isolating}: future morale events harder · C) Invite them into your world for a day → En +6, 30% one becomes a collaborator {friend_hire} eligible

**E-LIF-005 · The Health Scare Wakeup · St3-5 · all · w4 · once**
A routine checkup flags stress markers. Nothing serious — yet. The doctor uses the word "trajectory."
A) Restructure your life → En cap +10 permanently, Rev −1% (1Q), {balanced} · B) "After this quarter" → nothing changes; event re-fires harder in 2yr · C) Hire a COO to share load → Burn +0.4S/mo, En +10, {delegator}

**E-LIF-006 · Family Dinner Interrogation · St1-3 · all · w5 (2× if {family_money})**
Family dinner. Someone asks — with love and knives — "so when does this make real money?"
A) Answer with the real numbers [P:pitch-lite, no camera: voice only] ✓ family respect: En +6, if {family_money} they offer more ✗ awkward pasta, En −3 · B) Deflect with jokes → En 0, question returns yearly · C) "I'll show you next year" → self-imposed target: next Year End ±En swing

**E-LIF-007 · The Award Invitation · St3-5 · all · w4**
You're shortlisted for a "Founders Under 25" award. The gala costs a weekend and 0.2S.
A) Go, network hard → En −5, 2 contact cards → future opportunity events +weight, Brand +2 · B) Go, enjoy it → En +5, Brand +2 · C) Skip, work → Resp −1 (the shark: "Even I take a bow sometimes")

**E-LIF-008 · Imposter Hour · St1-4 · all · w6**
A podcast lists "founders who actually deserve it." You're not on it. It's 1am and you're rereading it.
A) Close the phone, list 3 real things you built → En +6, Resp +1 · B) Spiral productively: audit your weaknesses → En −4, one targeted stat +2 next Q · C) Post something bitter → Brand −2, delete-it-later event, En −2

**E-LIF-009 · The Mentor Appears · St1-3 · all · w5 · once**
A retired operator from your industry offers monthly coffee. No equity, no agenda. Probably.
A) Accept → {mentor}: once/yr a bad event's damage halves ("she warned you") · B) Accept but verify → same, delayed 1yr, no downside · C) Too busy → the coffee shop closes eventually; option gone

**E-LIF-010 · Side Quest Money · St1-2 · all · w5**
A quick freelance gig pays 1S personally — but eats a month of evenings.
A) Take it → founder Cash +1S (can inject into company), En −8 · B) Decline → focus, poverty, principle · C) Take it and outsource half → +0.5S, En −3, {delegator} seedling

**E-LIF-011 · The Comparison Trap · St2-4 · all · w5**
A same-age founder just raised a round 10× yours. Your feed won't stop.
A) Mute, run your race → En +4, Resp +2 ("their runway isn't your race") · B) Study their playbook coldly → one MKT or FIN event next Q shows a bonus option · C) Chase their strategy → strategy whiplash: Qual −3, {pivot} without the upside

**E-LIF-012 · Give Back Day · St2-5 · all · w4 · req:{street_cred} or {community}**
The local school asks you to speak to students about starting up.
A) Do it, tell the truth (failures included) → Brand +4 locally, En +8 (it feels good), {mentor} pipeline: intern events improve · B) Send a polished video → Brand +1 · C) Decline → nothing; the shark says nothing, loudly

---

## J · OPPORTUNITIES (12)

**E-OPP-001 · The Pop-Up Slot · St1-2 · all · w6**
A prime location offers a 2-week pop-up, half price, starting Friday.
A) Scramble and take it → En −8, Cash −1S, Rev +7%, Brand +4 local · B) Pass, not ready → nothing · C) Split it with a friendly brand → Cash −0.5S, Rev +4%, {ally_brand}

**E-OPP-002 · Celebrity Sighting · St2-4 · all · w4 · once**
A celebrity is photographed using your product. Unpaid. Unaware.
A) Repost respectfully, no claims → Brand +7 · B) Rush an ad implying endorsement → Brand +10 then legal letter: Cash −2S, Brand −6, Risk+ · C) Send a thank-you package → 30% they post it: Brand +12 / 70% nothing, class kept

**E-OPP-003 · The Accelerator Letter · St1-2 · all · w5 · once**
A famous accelerator accepts you: 7% equity for 6S + network.
A) Take it → Cash +6S, dilution 7%, {accelerated}: 2 bonus OPP events/yr, InvSent + · B) Decline, cite terms → Resp +2, independence · C) Negotiate to 5% [P:nego] ✓ better deal ✗ offer rescinded (they hate hagglers this early)

**E-OPP-004 · The TV Pitch Show Call · St2-3 · all · w4 · once**
A real pitch show wants you on air. Millions watching. Editors control the cut.
[P:pitch, televised rubric — presence weighted 2×] ✓ Brand +12, Rev +15% (1Q), {famous} ✗ the edit is unkind: Brand −5, Mor −2, but Resp +1 for going. Or decline → nothing.

**E-OPP-005 · Government Contract Maze · St3-5 · all · w5**
A public tender fits you perfectly. Paperwork is a part-time job; payment terms are 120 days.
A) Bid properly → En −6, 40% win: Rev +20%/yr stable {gov_contract} · B) Partner with an incumbent who knows the maze → win odds 70%, split: Rev +10%, GM −2 · C) Skip → private-sector purity

**E-OPP-006 · The Franchise Inquiry · St3-4 · all · w5**
Strangers keep asking to open "your" store/product line in their city.
A) Build a real franchise program → Cash −3S once, then Rev +6%/yr per region, management events unlock · B) One pilot partner first → slow, clean data · C) Never franchise → quality control absolute {quality_first}. Rookie: [franchise]

**E-OPP-007 · Conference Keynote Slot · St3-5 · all · w4**
The biggest industry conference offers you a keynote — in three weeks.
[P:pitch, thought-leadership rubric] ✓ Brand +8, 2 partnership events armed, Resp +2 ✗ Brand −3, clip lives forever. Or send the CMO → Brand +3, their TeamLoy +.

**E-OPP-008 · The Adjacent Market Door · St3-5 · all · w5**
Your product almost works for a neighboring market. "Almost" costs 2S.
A) Enter → Cash −2S, 55% Rev +12%/yr / 45% distraction: core Qual −3 · B) License a local player to try it → Rev +3%, no risk, less upside · C) Focus → Resp +1 (the shark respects "no")

**E-OPP-009 · Collab Drop Offer · St2-4 · all · w5 · req:{ally_brand} or {viral_fame}**
A beloved brand proposes a limited collab drop.
A) Yes, split 50/50 → Rev +8% (1Q), Brand +5, sellout-risk event 20% · B) Yes, but your terms [P:nego] ✓ Rev +10%, Brand +5 ✗ collab dies, mild public sulk · C) Decline → brand purity

**E-OPP-010 · The University Lab Call · St3-5 · all · w4**
A university lab wants to co-develop next-gen tech with you. Slow, cheap, credible.
A) Fund the lab → Cash −1S/yr, Qual +2/yr compounding, {research_ties}, talent pipeline · B) One-off project → Qual +3 once · C) Pass → speed over depth

**E-OPP-011 · Buy the Building · St3-5 · all · w4 · req:{rent_locked} excluded**
Your landlord is selling. You could own your HQ.
A) Buy → Cash −8S (or {debt_taken}), Burn −rent, asset: Val +3%, {own_building}: property events · B) Negotiate purchase option, decide next yr [P:nego] ✓ locked price ✗ sold to someone with plans · C) Let it go → a new-landlord event rolls next year

**E-OPP-012 · The Second Product Temptation · St2-4 · all · w6**
The team has a full concept for product #2. The first one isn't finished winning.
A) Greenlight → Rev +6% (d), focus tax: Qual −2 on core, {portfolio} · B) Kill it kindly, bank the idea → Mor −2, {focus}, idea-bank event later · C) 10% time skunkworks → slow burn, 25% breakthrough event (d)

---

## K · CRISIS CHAINS (5 chains × 3 steps — each step is drawn a day apart; choices in step 1 gate step 2, etc.)

**K-SUP-1 · The Silence · St2-4 · all (2× if not {redundant})**
Your key supplier stops answering. Orders due in 10 days.
A) Fly there / show up → En −6, truth next step, {showed_up} · B) Email harder → truth arrives late (step 2 harder) · C) Activate backup req:{redundant} → chain ends: Rev −1%, flex narration

**K-SUP-2 · The Truth**
They're insolvent. Your deposits (2S) are inside.
A) req:{showed_up}: negotiate salvage on-site [P:nego] ✓ recover stock + 1S ✗ recover stock only · B) Join creditor queue → 20% recover later (d) · C) Write it off, secure a new supplier today at premium → GM −3 (2Q), delivery saved

**K-SUP-3 · The Aftermath**
Customers heard. Two rivals are whispering "supply problems" to your accounts.
A) Publish the honest post-mortem → Brand +5, CSAT +3, {crisis_vet} · B) Quiet outreach to top accounts only → Churn contained: +1 only · C) Announce a resilience program (dual-sourcing) → Cash −1S, {redundant}, investor confidence: InvSent +

**K-PR-1 · The Screenshot · St2-5 · all**
An old post of an employee (or young you) surfaces. It's bad. Your brand is tagged.
A) Statement within 24h → controls step 2 tone · B) Investigate first, 72h silence → facts +, outrage compounds: Brand −3 now · C) Joke about it → 20% legend / 80% gasoline: Brand −6

**K-PR-2 · The Pile-On**
A big account demands you fire the person. The internet has voted.
A) Due process, publicly explained → Brand −2 short-term, Mor +8, {clean_hands} · B) Fire immediately → outrage ends, Mor −8, TeamLoy −, {bad_boss} risk · C) Defend unconditionally → superfans +: CSAT +3, mainstream −: Brand −4

**K-PR-3 · The Interview**
A major outlet offers one interview to close the story.
[P:media only] ✓ story closed: Brand recovers +4, {crisis_vet}, Resp +2 ✗ new clip fuels week two: Brand −5. Declining = story closes slowly: Brand −2.

**K-TEC-1 · The Outage · St3-5 · all (2× if TDebt high)**
Everything is down on your biggest day of the year.
A) All-hands war room, you visible → En −8, fix in hours, Mor +4 · B) Vendor blame + wait → fix tomorrow: Rev −6%, CSAT −6 · C) Manual workaround heroics → Rev −2%, team legend: Mor +6, {duct_tape_masters}

**K-TEC-2 · The Cause**
Post-mortem: the shortcut from Year {y}. Everyone in the room knows who approved it. You did.
A) Own it to the team → Mor +6, Resp +3, {accountable} · B) "Process failure" framing → Mor −4, TeamLoy − · C) Fund the fix on the spot → Cash −2S, TDebt cleared, Qual +4

**K-TEC-3 · The Customer Letter**
Enterprise customers want an SLA and credits, or they walk.
A) Credits + real SLA [P:nego on terms] ✓ Churn +0, Burn +0.1S/mo ✗ Churn +3 · B) Credits only → Churn +1 · C) req:{accountable}: your honesty bought grace → Churn +0, narration flex

**K-CASH-1 · The Squeeze · St2-4 · all (armed when Runway <5mo)**
Payroll is in 6 weeks. The bank line is maxed. Nobody outside knows yet.
A) Tell the team the truth [P:allhands] ✓ Mor −2 only, volunteers defer pay: Burn −20% (1Q), {truth_teller} ✗ two resign: Emp −2 · B) Silence + scramble → Mor safe for now, step 2 harder · C) Founder injects personal savings → Cash +1S, En −6, {all_in}

**K-CASH-2 · The Lifelines**
Three doors: an angel wants 25% for 6S; a revenue-based lender wants 8% of revenue for 2 years; a big customer will prepay a year at 20% discount.
A) Angel → dilution 25%, InvSent +, board seat events unlock · B) RBF loan → GM −8% equivalent 2yr, no dilution · C) Prepay deal → Cash +4S now, GM −2 for that account, {whale_dependency} seed. Rookie: [dilution]

**K-CASH-3 · The Other Side**
You made payroll. The team knows how close it was (or doesn't — per step 1).
A) req:{truth_teller}: pay back deferred + bonus → Cash −1.5S, TeamLoy max, Mor +10 · B) Celebrate, say nothing more → Mor +3 · C) Post-crisis austerity plan → Burn −15%, Mor −4, Runway +3mo

**K-MKT-1 · The Algorithm Change · St2-4 · all (2× ECOM/CONTENT)**
Overnight, the platform that drives 60% of your traffic changes its algorithm. Reach −70%.
A) Emergency budget into paid → Cash −2S, Rev −3% only · B) Sprint to owned channels (email/community) → Rev −8% (1Q), then platform-independent: {own_audience} · C) Chase the new meta → 50% Rev −1% / 50% cringe: Brand −3

**K-MKT-2 · The Consultant**
A "platform whisperer" guarantees recovery for 1S. Reviews are… curated.
A) Pay → 30% works / 70% snake oil: Cash −1S, nothing · B) DIY with the team → En −6, Rev recovers half · C) req:{own_audience}: you don't need them → flex, Resp +2

**K-MKT-3 · The Lesson**
Traffic stabilizes lower. The board (or your gut) asks: what did we learn?
A) Institutionalize: no channel >30% of traffic → resilience rule: future algorithm events damage −50% · B) Ride the next platform hard → growth +4% but re-arms this chain · C) Blame the platform publicly → catharsis, Brand −1, platform relations − (feature-access event lost)

---

## L · STAGE MILESTONE ARCS (26) — mostly `once`, scripted beats that give each stage a spine.

### Seed / Garage (St1) — 6
**E-SEED-001 · The Garage Decision · once** (tutorial forced draw)
Where does this company live for now?
A) Your room/garage → Burn 0, En −2 (no separation) · B) Shared workspace → Burn +0.1S/mo, network: 1 bonus OPP event/yr · C) Tiny shopfront/online storefront → Burn +0.2S/mo, Rev +2%

**E-SEED-002 · First Sale Ritual · once**
Your first real stranger-customer. They paid actual money.
A) Frame the receipt → Mor +3, Brand seed, {first_dollar} · B) Refund them and ask for brutal feedback → CSAT insight: Qual +3 · C) Post it everywhere → Brand +2, cringe risk 10%

**E-SEED-003 · The Logo Night · once**
It's 2am. You're choosing between three logos you made yourself.
A) The safe one → Brand +1 · B) The weird one → 50% Brand +4 distinctive / 50% Brand −1 confusing · C) Pay a student designer → Cash −0.1S, Brand +2, {ally_creative}

**E-SEED-004 · Price Tag Panic · once**
You have to write a price on the thing. Out loud. Forever. (Not forever.)
A) Cost-plus safe → GM +baseline, CWP unexplored · B) Premium and proud → GM +4, Demand −, {premium_position} · C) Underprice to enter → Demand +, GM −3, {discounter} seed. Rookie: [COGS] [CWP]

**E-SEED-005 · The First Pitch Gate · once** (scripted, GDD §4 T6)
Revenue exists. The shark clears its throat. [P:pitch — tutorial floor applies on run 1 only.]

**E-SEED-006 · Quit-Your-Other-Life Question · once**
The company needs more of you than your spare hours contain.
A) Go part-time on everything else → En +5, Rev +4%, income −: personal Cash − · B) Keep both, hire help → Burn +0.2S/mo, {delegator} seed · C) Stay safe, grow slow → Rev cap −2%/yr, zero regret events

### Growth (St3 entry) — 6
**E-GRW-001 · Welcome to Growth · once** — narration + choice: pick the year's doctrine.
A) Blitz (growth over margin) → Rev +8%/yr, GM −3, Burn + · B) Fortress (profit first) → GM +3, Rev +2%/yr, InvSent − (boring) · C) Product (quality compounding) → Qual +4/yr, slow Rev +4%/yr (d)

**E-GRW-002 · The First Real Office · once**
The team doesn't fit anymore.
A) Cool loft, slight overreach → Burn +0.5S/mo, Mor +6, Brand +2 · B) Boring and cheap → Burn +0.2S/mo, Mor −1 · C) Hybrid/remote-first → Burn +0.1S/mo, talent radius +: Qual +2, culture drift risk

**E-GRW-003 · The Org Chart Day · once**
Twenty people can't all report to you. (They currently all report to you.)
A) Hire managers externally → Cash −1S, structure fast, Mor −3 ("who are these people") · B) Promote from within + training → slower, Mor +6, TeamLoy + · C) Flat forever → Mor +2 now, chaos events +weight at St4

**E-GRW-004 · First Board Meeting · once · req: any investor flag**
Your investors want quarterly board meetings now. [P:board] ✓ InvSent +, guidance: one FIN event/yr shows bonus option ✗ InvSent −, micromanagement events armed

**E-GRW-005 · The Process Religion · once**
Someone says the word "OKRs" in a meeting and people nod.
A) Adopt lightweight process → Qual +2, Mor −1 (meetings), scaling smoother · B) Full framework religion → Qual +3, Mor −4, {process_heavy} · C) Vibes and heroes → Mor +3, K-TEC chain weight +

**E-GRW-006 · National or Deep · once**
Expand to the whole country, or dominate your region completely first?
A) National → Rev +10%/yr, thin everywhere: CSAT −3, Burn ++ · B) Regional fortress → Share +4 local, Brand +5 local, slower · C) Follow the data city-by-city → measured: Rev +6%/yr, En −3 (constant analysis)

### Scale (St4 entry) — 6
**E-SCL-001 · Welcome to Scale · once** — "You employ more people than your school year. Act like it."
A) Professional CFO hire → Burn +0.5S/mo, FIN event bonus options, {grown_up} · B) Keep the scrappy machine → Mor +3, audit-risk events + · C) COO to run inside, you run outside → En +10, Qual −1 (translation loss)

**E-SCL-002 · The Culture Fork · once**
New hires outnumber the old guard 5:1. The founding culture is diluting.
A) Codify values, live them visibly → Mor +5, hiring filter: Qual +2 · B) Let culture evolve → Mor −2, friction events, occasional pleasant surprise · C) Old-guard privileges → veterans Mor +6, newcomers Mor −5, {two_tier}

**E-SCL-003 · International Door · once**
A foreign distributor offers to take you abroad.
A) Partner-led entry → Rev +8%/yr, GM −2, {intl_partner} · B) Own subsidiary → Cash −6S, Rev +12%/yr (d), management strain · C) Not yet → focus, door re-opens smaller in 2yr

**E-SCL-004 · The Platform Decision · once (TECH/ECOM/GAMING 2×)**
Open your product as a platform others build on?
A) Open it → ecosystem: Rev +6%/yr (d), support burden, {platform} · B) Stay closed → control, ceiling · C) Selective partners → middle path, politics events

**E-SCL-005 · Acquire or Build · once**
A capability you need exists inside a small company you could buy for 8S.
A) Acquire [P:nego on price] ✓ 6S, capability now ✗ 8S or walk · B) Build it → 18 months, Cash −4S spread, culture intact · C) Acqui-hire just the team → Cash −3S, product dies, talent lands, karma −1 with their users

**E-SCL-006 · The Founder's Role · once**
Honestly: are you still the right CEO for this stage?
A) Yes — and get a coach → Cash −0.3S, Resp +3, blind-spot events −50% damage · B) Hire a CEO, become Chairman/Product → En +15, company Qual +2, identity events unlock · C) Yes, and prove it alone → high variance: next 2 Year Ends ±extra swing

### Public / Endgame (St4-5) — 8
**E-IPO-001 · The Bankers Call · once** — IPO window is open. Begin the gauntlet? (arms IPO arc)
**E-IPO-002 · The S-1 Board Review · once** [P:board] — defend your risk-factors section honestly ✓ proceed ✗ delayed a year, InvSent −
**E-IPO-003 · The Roadshow · once** [P:pitch, institutional rubric: numbers weighted 2×] ✓ demand strong: price at top of range ✗ price cut 20% or pull (choice)
**E-IPO-004 · Pricing Night · once** [P:nego with bankers] ✓ +15% first-day pop sized right ✗ mispriced: Brand −3 or money left on table (coin flip which)
**E-IPO-005 · The Bell · once** — narration ceremony, IPO Gold everywhere, V10 gold variant, legacy badge, Resp +5. Run archives as LEGEND.
**E-PUB-001 · First Earnings Miss · St5 · w6** — you missed guidance by 2%.
A) Own it plainly [P:media] ✓ Val −4% only ✗ Val −12% · B) Blame macro → Val −8%, InvSent − · C) req:{truth_teller}: your credibility cushions it → Val −3%
**E-PUB-002 · The Activist Investor · St5 · w4 · once** — a fund takes 6% and publishes a letter demanding changes.
A) Fight [P:media + board] ✓ they retreat, Resp +3 ✗ proxy fight: En −15, coin flip control · B) Negotiate a board seat → peace, strategy friction events · C) Adopt the good 30% of their ideas → Val +3%, letter defanged
**E-PUB-003 · Go Private Again? · St5 · w3 · once** — a PE firm offers to take you private at +25%.
A) Take it → run ends: victory tier "Full Circle", legacy cash badge · B) Stay public → the long game continues · C) Counter +40% [P:nego] ✓ legendary exit ✗ offer withdrawn, Val −5% (market saw you shopping)

---

## M · INDUSTRY PACKS (12 × 4 = 48) — flavor + industry-true tradeoffs. Free industries first.

### FOOD & BEVERAGE
**E-IND-FOOD-1 · Health Inspector Tuesday · St1-3 · w7** — Surprise inspection during the lunch rush.
A) req:{quality_first}: pass with praise → Brand +4 · B) Pass, minor notes → Cash −0.2S fixes · C) req:{cut_corners}: violations posted on the door → CSAT −8, Brand −6, cleanup Cash −1S
**E-IND-FOOD-2 · The Food Critic · St2-4 · w5** — A feared critic booked a table under a fake name. Staff spotted them.
A) Treat like anyone → integrity: 60% good review Brand +6 / 40% mixed +1 · B) Secret VIP treatment → 50% glowing +8 / 50% they noticed the act: −5 · C) Comp everything → they must disclose it; review void, mild embarrassment
**E-IND-FOOD-3 · Recipe Walkout · St2-4 · w5** — Your head chef quits… for Marco. The signature dish walks with them.
A) req:{patent}/documented recipes → dish stays, they get sued if used · B) New signature, publicity stunt tasting → Cash −0.5S, 55% Brand +5 · C) Buy the recipe rights back [P:nego] ✓ Cash −1S, dish stays ✗ menu gap: Rev −5% (1Q)
**E-IND-FOOD-4 · Cold Chain Gamble · St2-4 · w5** — The freezer truck died overnight. The stock is… probably fine.
A) Destroy it all → Cash −2S, {quality_first} · B) Sell it fast → Cash saved, 25% illness scandal: Brand −12, Risk++ · C) Donate it TODAY with disclosure → Cash −1S, Brand +3, karma

### E-COMMERCE / RETAIL
**E-IND-ECOM-1 · Cart Abandon Mystery · St2-4 · w6** — 70% abandon at checkout. Something in the flow is broken or scary.
A) UX audit + fix → Cash −0.5S, Rev +6% · B) Retargeting ads at abandoners → Rev +3%, "stalker ad" complaints: Brand −1 · C) Exit-discount popup → Rev +4%, {discounter} seed
**E-IND-ECOM-2 · Marketplace Squeeze · St2-4 · w6** — The big marketplace raises its take rate to 25%.
A) Stay → GM −4 · B) Push your own site hard → Rev −6% (2Q), then {own_audience}, GM +5 · C) Both + raise prices on marketplace only → channel conflict events, GM −1
**E-IND-ECOM-3 · The Returns Tsunami · St2-4 · w6** — Serial returners are bleeding you; one influencer teaches "the trick."
A) Tighten policy → Cash saved, CSAT −3 · B) Free returns as brand promise → Cash −1S/yr, CSAT +5, LTV + · C) AI-flag abusers only → Cash −0.3S, fair, 10% false-positive drama event
**E-IND-ECOM-4 · Packaging Identity · St1-3 · w5** — Unboxing videos are free ads — if the box deserves it.
A) Premium unboxing → COGS +2%, Brand +5, {viral_fame} eligibility + · B) Minimal eco-pack → COGS −1%, {green_cred} · C) Plain brown honesty → cheapest, forgettable

### TECH APP
**E-IND-TECH-1 · Store Rejection · St1-3 · w6** — The app store rejects your update over a vague guideline.
A) Comply quickly → feature diluted: Qual −2, ship on time · B) Appeal with precedent → 55% win, 2-week delay · C) Public thread about it → 30% policy exception + Brand +4 / 70% relations −: future reviews slower
**E-IND-TECH-2 · The Churn Cliff · St2-4 · w6** — Day-30 retention is a cliff. Investors will ask.
A) Fix onboarding (boring, right) → Churn −3 (d) · B) Notification blitz → DAU + now, uninstalls +: Churn +1 later · C) Add streaks/gamification → Churn −2, "dark pattern" think-pieces: Brand −1
**E-IND-TECH-3 · Open Source Fork · St3-5 · w4** — Your free tier just got cloned as an open-source project. It's popular.
A) Embrace: hire top contributors → Qual +4, Brand +5 with devs · B) Lawyer letters → Brand −6 with devs, 40% effective · C) Out-feature the fork → R&D Cash −1S, Qual +3
**E-IND-TECH-4 · The Data Center Bill · St3-5 · w6** — Cloud costs doubled with usage. Success is expensive.
A) Optimize sprint → Eng focus 1Q: features pause, Burn −0.6S/mo · B) Pass to enterprise tier pricing → Rev +4%, Churn +1 SMBs · C) Own hardware → Cash −5S, Burn −1S/mo (d), {own_infra}

### CONTENT / CREATOR
**E-IND-CONT-1 · The Algorithm Favors You · St1-3 · w5 · once** — One video prints. A million new eyes. They expect this weekly now.
A) Chase the format → Rev +8%, creative soul −: Qual −2/yr if repeated · B) Use the spike to funnel owned channels → {own_audience}, Rev +4% · C) Post what you love anyway → variance: ±Brand 4
**E-IND-CONT-2 · Brand Deal Dilemma · St2-4 · w6** — A big sponsor pays 3S. Their product is… not good.
A) Take it, disclose hard → Cash +3S, CSAT −4, {sellout_whispers} · B) Decline publicly → Brand +5, Cash 0, sponsors wary: deal flow −1yr · C) Negotiate approval rights [P:nego] ✓ Cash +2S, integrity ✗ deal dies
**E-IND-CONT-3 · Copyright Strike · St1-4 · w6** — A strike lands on your best-performing piece. Fair use is a gray zone.
A) Dispute → 60% win / 40% escalation risk · B) Edit + repost → reach reset −, safe · C) License properly going forward → Cash −0.3S/yr, {clean_hands}
**E-IND-CONT-4 · The Ghostwriter Question · St2-4 · w5** — You can't make everything yourself anymore.
A) Build a writers' room, credit them → Qual +3, Mor +4, "it's a team?" discourse: Brand −1 once · B) Ghost quietly → output +, exposure risk 20%: Brand −6 · C) Slow down, stay solo → Brand +2 (authenticity), growth cap

### FASHION / STREETWEAR (Pro)
**E-IND-FASH-1 · Drop Day Chaos · St2-4 · w6** — Bots bought 60% of the drop in 90 seconds. Real fans got nothing.
A) Anti-bot systems → Cash −0.5S, CSAT +5 · B) Ignore (sold out is sold out) → Rev safe, community sours: Churn +2 · C) Raffle system next drop → CSAT +3, hype −1
**E-IND-FASH-2 · The Knockoff Haul Video · St2-4 · w5** — A viral video says the fake "is basically the same."
A) Side-by-side teardown content → Brand +5, {authenticity} · B) Ignore → CWP −2 · C) Release a budget line yourself → Rev +5%, brand dilution: CWP −1 premium
**E-IND-FASH-3 · Celebrity Stylist DM · St2-4 · w4** — A stylist wants free pieces for an A-lister. No promises.
A) Send the good stuff → 40% worn in public: Brand +10 / 60% silence · B) Ask for guarantees → stylist ghosts (they always do) · C) Decline → nothing, discipline
**E-IND-FASH-4 · Season vs Seasonless · St3-5 · w4** — Fashion calendar says 4 collections/yr. Your team says 2 good ones.
A) 4 collections → Rev +4%, Qual −2, En −5 · B) 2 strong drops → Qual +4, hype concentration: {scarcity_play} · C) Continuous capsule model → steady Rev +2%, no "moments"

### GAMING (Pro)
**E-IND-GAME-1 · Crunch Decision · St2-4 · w6** — Launch is close. The industry's ugly word is in the room: crunch.
A) Delay instead → Brand −1 ("delayed again"), Mor +6, Qual +4 · B) Paid overtime, capped → Cash −1S, on time, Mor −2 · C) Uncapped crunch → on time, Mor −10, {bad_boss}, exposé risk 25%
**E-IND-GAME-2 · Monetization Fork · St2-4 · w6** — Publisher pressure: add aggressive microtransactions?
A) Cosmetics only → Rev +3%, community trust: CSAT +4 (the shark: "Familiar.") · B) Pay-to-win → Rev +8% (1yr) then Churn +4, Brand −6 · C) Premium price, no IAP → Rev +2%, purist Brand +4
**E-IND-GAME-3 · The Streamer Effect · St1-3 · w5 · once** — A giant streamer plays your game unprompted. Servers are melting.
A) Emergency scale-up → Cash −1S, ride it: Rev +12% (1Q) · B) Queue + apologize with charm → Rev +6%, memes both ways · C) Do nothing → crash clips: CSAT −5, "dead game" jokes
**E-IND-GAME-4 · Patch or Content · St3-5 · w5** — Players demand bug fixes; the roadmap promises new content. Team does one.
A) Fix first → CSAT +5, "no content" grumbles · B) Content first → hype +, bug compilation videos: Qual −3 visible · C) Split team → both mediocre this Q, then fine

### FITNESS (Pro)
**E-IND-FIT-1 · Injury Claim · St2-4 · w5** — A member says your equipment/program injured them.
A) req:{insured}: process cleanly → Cash −0.2S deductible · B) Settle quietly → Cash −1S, Risk+ (precedent) · C) Fight with evidence → 70% win, Brand −1 either way (headlines)
**E-IND-FIT-2 · The Transformation Post · St1-3 · w5** — A member's before/after goes viral, crediting you.
A) Amplify with consent → Brand +7, member becomes ambassador {community} · B) Amplify without asking → Brand +4 then consent backlash: −6, Risk+ · C) Congratulate privately → CSAT +3, quiet class
**E-IND-FIT-3 · Supplement Money · St2-4 · w5** — A supplement brand offers 2S/yr for exclusive promotion. Ingredients: mostly hope.
A) Take it → Cash +2S/yr, CSAT −3, {sellout_whispers} · B) Take it with third-party testing demand [P:nego] ✓ Cash +1.5S/yr, clean ✗ they walk · C) Decline, sell your own tested line → Cash −1S build, GM +3 (d)
**E-IND-FIT-4 · January Tsunami · St1-4 · w6 (fires Q1)** — Resolution season triples signups. February will triple cancellations.
A) Onboard hard: coaching for newbies → Cash −0.5S, Churn −4 (they stay!) · B) Ride the wave, oversell → Rev +8% (1Q), CSAT −5, Churn +5 in Q2 · C) Cap intake, waitlist → Brand +3 (exclusive), Rev +3% steady

### BEAUTY (Pro)
**E-IND-BEA-1 · The Reaction Reports · St2-4 · w6** — A small % of customers report skin reactions to a bestseller.
A) Pull + reformulate → Cash −3S, Brand +5 long-term, {quality_first} · B) Warning label only → Cash −0.2S, Risk++, slow drip of bad posts · C) req:{cut_corners}: it's the cheap ingredient → recall forced: Cash −5S, Brand −8
**E-IND-BEA-2 · Shade Range Callout · St1-3 · w5** — A viral post: your range excludes deeper skin tones.
A) Expand the range properly → Cash −1S, Rev +4% (new market), Brand +5 {inclusive} · B) Promise "coming soon" → clock starts: deliver in 2Q or Brand −6 · C) Ignore → Brand −5, {press_enemy} seed
**E-IND-BEA-3 · Dupe Culture Hit · St2-4 · w5** — A drugstore dupe of your hero product trends.
A) Ingredient-transparency campaign → CWP +, Brand +4 · B) Lower your price → GM −3, prestige −1 · C) Launch your own budget sister brand → Rev +5%, complexity, {portfolio}
**E-IND-BEA-4 · The Clean Beauty Audit · St2-4 · w4** — A watchdog grades brands on ingredient claims. Yours are… enthusiastic.
A) Reformulate + re-certify → Cash −2S, {green_cred} · B) Soften the marketing claims → Brand −1, Risk cleared · C) Double down on the claims → 35% nothing / 65% exposé: Brand −7, Risk++

### EDTECH (Pro)
**E-IND-EDU-1 · The School District Pilot · St2-4 · w6** — A district offers a pilot: 10 schools, brutal procurement, slow pay.
A) All in → En −6, 50% win: Rev +15%/yr stable {gov_contract} · B) One school first → clean data, slower · C) Stay direct-to-consumer → freedom, smaller checks
**E-IND-EDU-2 · Cheating Headline · St2-4 · w5** — A news story: students use tools like yours to cheat.
A) Ship academic-integrity features, join the panel discussion [P:media] ✓ Brand +5, districts reassured ✗ soundbite backfires −3 · B) Quiet lobbying → Risk managed, no glow · C) "Not our problem" → districts freeze: Rev −6%
**E-IND-EDU-3 · Efficacy Study Ask · St3-5 · w4** — Districts want proof your product improves outcomes. A real study costs 2S and might say "meh."
A) Fund independent study → Cash −2S, 60% positive: {evidence} Rev +8%/yr / 40% mixed: honest marketing required · B) Cherry-pick internal data → sales now, credibility bomb armed 30% · C) Partner with the university lab req:{research_ties} → half cost, credibility +
**E-IND-EDU-4 · Summer Cliff · St1-4 · w6 (fires Q2)** — School's out. Usage falls off a cliff every summer.
A) Summer-camp/parent mode → Rev −5% only, {portfolio} seed · B) Accept seasonality, cut costs in summer → Burn −20% (Q3), Mor −2 (furlough feel) · C) International counter-seasonal push → Rev −2%, {intl_partner} seed

### SUSTAINABILITY / GREEN (Pro)
**E-IND-GRN-1 · Greenwash Accusation · St2-4 · w6** — An activist thread audits your claims. Two of seven don't hold up.
A) Concede the two, fix publicly → Brand −2 then +5, {green_cred} hardened · B) Fight all seven → 20% vindicated / 80% pile-on: Brand −8 · C) Go quiet, fix silently → slow leak −1 Brand/Q for 2Q
**E-IND-GRN-2 · The Cheaper Gray Option · St2-4 · w6** — A supplier offers non-certified materials at −30%. Nobody would know. (You would.)
A) Decline → GM −0, {green_cred}, Resp +2 · B) Accept → GM +5, {greenwash_bomb} armed 40% · C) Blend + disclose % honestly → GM +2, purists −: CSAT −2, pragmatists +
**E-IND-GRN-3 · Certification Maze · St1-3 · w5** — The credible eco-label costs 1S and a year of audits.
A) Get certified → Cash −1S, CWP +, B2B doors open: Rev +5% (d) · B) Self-declared standards page → cheap, skeptics unimpressed · C) req:{audited_supply}: fast-tracked → half cost, flex
**E-IND-GRN-4 · The Oil Money Offer · St3-5 · w4 · once** — A fossil-fuel giant's venture arm offers 10S. The optics write themselves.
A) Take it, spend it loudly on mission → Cash +10S, Brand −6 with the base, reach +: Rev +5% · B) Decline publicly → Brand +7 with the base, Cash 0, Resp +2 · C) Take it silently → 50% leak: Brand −10

### TOYS & COLLECTIBLES (Pro)
**E-IND-TOY-1 · Safety Test Surprise · St2-4 · w6** — A component fails a choking-hazard test margin. Barely.
A) Redesign before ship → delay 1Q, {quality_first} · B) Ship with age-label change → legal, 20% retailer pushback · C) req:{cut_corners}: ship as is → recall event armed 45%, autopsy magnet
**E-IND-TOY-2 · Scalper Economy · St2-4 · w5** — Your limited figure resells at 5×. Kids can't get it; flippers can.
A) Reprint openly → collectors furious: CSAT −4, kids happy: Brand +4 · B) Keep it rare → {scarcity_play}, resale mythology: CWP + · C) Ticketed fair-purchase system → Cash −0.3S, CSAT +4
**E-IND-TOY-3 · The License Temptation · St3-5 · w5** — A giant franchise offers a license: guaranteed sales, 18% royalty, creative shackles.
A) Take it → Rev +12%/yr, GM −4, {licensed}: creative events restricted · B) Decline, build own IP → slower, {ip_owner}: media-deal events unlock (d) · C) One limited collab → Rev +5% (1Q), test data
**E-IND-TOY-4 · Holiday Bet · St2-4 · w6 (fires Q3)** — Retailers want holiday orders NOW: how much do you commit to produce?
A) Aggressive → if season strong Rev +18% / else Cash −4S stuck · B) Conservative → Rev +6% either way, stockout risk: CSAT −3 if strong · C) Preorder-driven → data-safe, hype tax: Rev +9% cap

### PET (Pro)
**E-IND-PET-1 · The Recall Scare · St2-4 · w5** — A competitor's recall makes owners paranoid about the whole category.
A) Publish your testing openly → Brand +5, {quality_first} halo · B) Attack ads on the competitor → Share +2, Brand −2 (ambulance chasing) · C) Say nothing → category Rev −4% washes over you
**E-IND-PET-2 · Vet Endorsement Path · St2-4 · w5** — Clinical credibility costs: a vet advisory board wants 0.5S/yr.
A) Build the board → CWP +, B2B vet channel: Rev +6% (d) · B) One celebrity vet influencer → Brand +4, credibility thin · C) Skip → price-shopper positioning
**E-IND-PET-3 · The Emotional Support Story · St1-3 · w4 · once** — A customer credits your product in a tearjerker story about their elderly dog. It's spreading.
A) Amplify with their consent, donate to shelters → Brand +8, {charity}, {community} · B) Amplify without asking → Brand +5 then consent backlash −4 · C) Private thank-you only → CSAT +3, class
**E-IND-PET-4 · Subscription Fatigue · St2-4 · w5** — Your subscription boxes churn as pets (and owners) get bored.
A) Personalization engine → Cash −1S, Churn −3 · B) Skip-a-month flexibility → Churn −2, Rev −3% (breathing room beats cancellation) · C) Lock-in annual discounts → Cash +now, resentment churn later +2 (d)

---

## N · WILDCARDS (10) — rare, memorable, weight 1-2. The stories players screenshot.

**E-WLD-001 · The Time Capsule · St3-5 · once** — Year 1 you left a note in the books: "If we made it this far, do the thing we were scared of." You remember exactly what it was. (Engine: re-offers the biggest declined `once` opportunity from run history.)
**E-WLD-002 · Wrong Send · St2-4** — Your unfiltered internal rant just went to the all-customers list.
A) Own it with humor in 1 hour → 60% Brand +5 legendary / 40% −3 · B) "We were hacked" → Risk++, 30% caught lying: Brand −10 · C) Formal apology → Brand −1, forgettable, safe
**E-WLD-003 · The Look-alike · St2-5** — A company in another country has your exact name and a worse reputation. Confused reviews are landing on you.
A) Buy their name/domain → Cash −1S, cleaned · B) Public "we are not them" campaign → Brand +2, Streisand risk 20% · C) Outrank them with content → slow, free, mostly works
**E-WLD-004 · Weather Event · St1-4** — A storm/heatwave hits your region. (Reskins: kitchen floods / delivery freeze / server AC failure / event canceled.)
A) Close + pay staff anyway → Cash −1S, Mor +8, {treated_team_well} · B) Stay open heroically → Rev protected, 15% safety incident: Risk++ · C) Turn it into content → Brand +3, mild cringe risk
**E-WLD-005 · The Superstition · St1-3** — The team credits a lucky object for the recent win streak. It has a name now.
A) Embrace the bit → Mor +4, merch idea: Closet cosmetic unlock · B) Ban it, we are professionals → Mor −3, the shark judges YOU for once · C) Sell replicas → Cash +0.3S, Brand +2, absurd
**E-WLD-006 · Mystery Benefactor · St2-3 · once** — An envelope: 2S cash, a note: "Don't sell out. — A fan."
A) Bank it, honor it → Cash +2S, {mystery_promise}: next sellout-flavored choice shows a conscience prompt · B) Donate it → Brand +4 when story surfaces, karma · C) Investigate → 50% sweet story: Brand +3 / 50% it's Marco testing you: feud event
**E-WLD-007 · The Documentary About Marco · St3-5 · req:{marco_feud}** — A film about your rivalry is happening with or without you.
A) Participate, gracious cut → Brand +5, feud cools −1 · B) Refuse → portrayed by an empty chair: Brand −2, mystique +1 · C) Counter-program your own film → Cash −2S, 50% Brand +8 / 50% "trying too hard" −3
**E-WLD-008 · Lottery Logic · St1-2** — A customer suggests you two split a lottery ticket "for the story." (Rookie: [ROI] — the shark explains expected value, delighted.)
A) Buy it → Cash −0.001S, 1-in-a-zillion: nothing happens, but the shark's EV lecture plays: Resp +1 for listening · B) Decline with the math → Resp +2 · C) Buy 100 "for marketing" → Brand +1, the lecture is longer
**E-WLD-009 · The Old Rival Returns · St4-5 · once · req:{rival_seed}** — The friend you turned down in Year 1 built something adjacent. It's good. They want to talk — merger, revenge, or closure; even they don't know.
[P:nego, emotional rubric] ✓ alliance: Rev +6%/yr, story: Brand +5, {full_circle} ✗ cordial nothing; the ache is content
**E-WLD-010 · The Shark's Question · St3-5 · once · req: Resp ≥70** — No crisis today. The shark just asks, on camera: "Why are you doing this? Really." [P:free-response, honesty rubric — scored on coherence & self-awareness, not 'right answers'] Any sincere answer: Resp +3, En +8, a line of it echoed at your eventual endgame screen (IPO or Chapter 7). Skipping: the shark nods. "Later, then." Re-arms in 2 years.

---

## Batch 1 count & coverage
OPS 16 · PEOPLE 18 · FIN 16 · MKT 16 · PRD 14 · CUS 12 · RIV 10 · LGL 12 · LIF 12 · OPP 12 · CHAINS 15 · MILESTONES 26 · INDUSTRY 48 · WILD 10 = **237 authored events**, ~40 flag callbacks, 21 PERFORM hooks, 5 multi-day chains, every visible stat touched. Expansion batches: run the §10 prompt (GDD).
