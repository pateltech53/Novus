# PROGRESSION — why year two has to be worth playing

> The brief, in the founder's own words: *"rn as the founder after 1 year it's
> boring and repetitive to keep clicking options."*

That sentence is a bug report about the loop, not about any screen in it. This
document is the diagnosis, the model it is being fixed against, and the rules
that any future change to the year loop has to satisfy. It is written to be read
by whoever picks this up next — including a future session of me — and it is
deliberately longer than the change it justifies, because the change is easy and
the reasoning is the part that gets lost.

---

## 1 · What the player actually experienced

A first fiscal year in Novus is good. There is a lot in it that only happens
once: choosing an industry, naming the company, the tutorial's eight steps, the
first hire, the first month that ends with less money than it started with, the
first pitch to the Tank, the first year-end report, the first badge.

The second year is the same twelve months with different numbers, and that is
the whole complaint. Concretely, on the day the report was made:

| What the year loop offered | Year 1 | Year 5 |
|---|---|---|
| Shared activities across six tabs | 17 | 17 |
| Industry activities (the lens) | 8–9 | 8–9 |
| Activities that can only be done **once a year** | 7 | 7 |
| Activities that can only be done **once ever** | 2 | 2 |
| Activities that unlock later | 4 (by stage) | 0 left |
| Anything the game asks you *to do* this year | none | none |

Read that last row again, because it is the actual defect. **Nothing in the game
ever asks the player for anything.** Events happen *to* you and you answer them;
the Tank asks a question at the gate; the rest of the year is a menu that is
identical in December to the one it was in January, and identical in year 5 to
the one it was in year 1. The player is not pursuing anything. They are
maintaining something.

Three narrower faults sit underneath it:

1. **The menu is short and it is flat.** Seventeen shared verbs, of which four
   are the whole of the market tab and one is "change your fit". Every one is a
   single tap with a single outcome. There is no verb in the game with a
   *second* question attached to it.
2. **Growth removes content instead of adding it.** The four stage-gated
   activities have all opened by stage 5, so a late company has strictly fewer
   new things available than an early one. Progression currently *closes* doors.
3. **The only long-term ladder was a counter.** The wardrobe track — the one
   thing in the app that spans runs — asked for 1, 2, 4, 6, 9 and 12 *finished
   runs* and nothing else. It could not tell a founder who reached year 12 from
   one who founded twelve companies and let each die in March. It rewarded
   volume, which is the one thing a game about compounding should never reward.

None of this is a balance problem. `scripts/simulate.mjs` — the harness that
owns the balance target — does not fire a single activity, and never has. The
numbers are fine. The reasons to come back are missing.

---

## 2 · What BitLife is doing that works

The brief names BitLife, and it is the right reference, so it is worth being
precise about *what* it is doing rather than borrowing its surface.

BitLife's loop is one button — *Age* — and a list of things you may do before
you press it. That is structurally the same loop Novus has: `advanceMonth` is
the only time-mover (Brand Law 1), and everything else is optional. So the
difference is not the shape. It is four properties of the list.

### 2.1 · Breadth — the list is absurdly wide

At any age a BitLife player can go to the gym, take a class, see a doctor,
gamble, adopt a pet, join the mafia, write a book, get a tattoo, run for office,
emigrate, take a walk. Most of these do very little. That is the point: breadth
is what makes the list feel like *a life* rather than a control panel. A player
who opens the menu and finds something they have never tapped before has a
reason to open the menu.

Novus has seventeen. Seventeen is a control panel.

### 2.2 · Two-level specificity — the verb, then the *which*

This is the property the brief singles out, and it is the one that matters
most. BitLife does not offer "Commit crime". It offers **Commit crime**, and
then asks *which*: pickpocket, burglary, grand theft auto, murder. It does not
offer "Get a job". It offers a job list.

The second question is where all the character is. It costs almost nothing to
build — the same verb, four outcomes — and it multiplies the surface enormously,
because now the player is not choosing *whether*, they are choosing *how far*.
"Talk to the press" is a shrug. "Talk to the press → the trade weekly, or the
national business desk?" is a decision with a spine, because one of those two
can end you.

**Novus has no two-level activity anywhere.** Adding the mechanic is the single
highest-leverage change available, and it is the core of the work this document
covers.

### 2.3 · Narrated consequence — the game says what happened

Every BitLife action returns a sentence. Not a stat delta — a sentence, in
character, that tells you the story of what you just did. The stat moved too,
but the sentence is what the player remembers and repeats.

Novus is already good at this and must stay good at it. Every `spend()` call
writes a log line in the house voice, and Addendum A §7.1 forbids showing an
effect preview before committing. **That rule holds for everything below.** A
two-level activity shows the player the *shape* of the choice ("cheaper, and
they will not print a correction") and never the numbers behind it.

### 2.4 · Escalation — the list changes as the life goes on

A BitLife 8-year-old cannot buy a house. A 40-year-old cannot join the school
band. The menu is *different* at every stage of life, not merely longer.

Novus does this in one direction only: things open, and once they are open they
never close and nothing new arrives. The fix is not "more stage gates". It is
that the year loop needs content keyed to **the year**, not only to the stage —
because the stage stops moving long before the years do.

---

## 3 · The translation to business

The brief is explicit that this is a business game and the verbs have to stay
business verbs. BitLife's crime menu maps onto something real here, and it is
not crime — it is **the things a founder can do that are legal, aggressive, and
capable of ending the company**.

| BitLife | Novus |
|---|---|
| Commit crime → murder / theft / arson | Go after a competitor → cease-and-desist / sue / brief a journalist |
| Write a book | Write the book → memoir / playbook / an honest post-mortem |
| Get interviewed | Talk to the press → local paper / trade weekly / national desk |
| Go to the gym | Take a real weekend · Take the team offsite |
| Gamble | Run a pricing experiment · Sue the copycat |
| Join a club | Join a trade body · Form an advisory board |
| Run for office | Join the trade body · Speak on the mainstage |
| Adopt a pet | (does not translate — do not force it) |
| Take a class | Send the team to training · Sit in on customer calls |

The last row is the rule for this table: **when something does not translate,
it does not ship.** Novus is a business simulation handed to minors, and the
whole reason it is trusted is that every verb in it is a real thing a founder
does. A joke verb costs more than it earns.

---

## 4 · The four rules the fix has to satisfy

Everything built for this document obeys these. A future change that breaks one
of them is a regression whether or not a test catches it.

### Rule 1 · Every year must contain at least one thing that year 1 did not

Not a bigger number — a *different offer*. This is served three ways, in
increasing order of how much work they are:

- **The Playbook** — a much wider shared menu, with roughly a third of it
  arriving only at stage 2, 3 or 4, so growth adds doors instead of closing
  them.
- **`yearly` activities**, which now actually work. The flag had been declared,
  documented and set on seven activities since the interface was written, and
  read by nothing. It is read now (`isSpentThisYear`), so a once-a-year lever is
  once a year, and the December menu is genuinely shorter than the January one.
- **Second questions**, which make a repeat of the same verb a different act.
  Talking to the trade weekly in year 2 and the national desk in year 4 are the
  same row and two different years.

### Rule 2 · Two-level decisions are the default for anything with a range

If a verb could sensibly be done cautiously or recklessly, it must ask which.
The machinery is `Activity.options`: a list of named branches, each with its own
label, its own signal line, its own price and its own `apply`. The row opens a
chooser; the chooser is where the character lives.

The tape records the branch (`{ t: "activity", id, option }`), so a replayed run
takes the same branch it took the first time. Old tapes carry no `option` and
old activities have no `options`, so nothing already on a leaderboard changes —
the field is additive in exactly the way `docs/DO-NOT-TOUCH.md` asks for.

### Rule 3 · Progression across runs is measured in *years survived*, never in runs started

This is the wardrobe fix, and it is a correction of an incentive that pointed
the wrong way. Six fits used to cost 1, 2, 4, 6, 9 and 12 finished runs. The
fastest route to all six was to found a company, let it die, and repeat — the
opposite of the behaviour the game exists to teach.

They now cost **achievements**, in the founder's own words from the brief:
reach fiscal year 3; close five fiscal years across your two best companies;
and so on up. Every demand is read from `LegacyState`, which already survives
runs and already syncs. Four shapes of demand, so the ladder is not one number
in a coat:

| Shape | Reads | Reads as |
|---|---|---|
| `bestYear` | furthest year reached in a single company | *go deep* |
| `topRuns` | years summed across your best *n* companies | *go deep more than once* |
| `careerYears` | every fiscal year you have ever closed | *keep playing* |
| `runsFinished` | companies taken to an ending | *finish what you start* |

Two further properties, both learned the hard way:

- **Nothing un-earns.** `legacy.autopsies` is capped at ten entries, so a
  career-total demand computed live would *fall* as old companies aged off the
  list, and a player could lose a fit they had worn for a month. The earned set
  is therefore a sticky ledger in the wardrobe store: a demand met once is met
  forever.
- **Nothing already unlocked is taken away.** On first read under the new rules
  the ledger is seeded from the old run-count thresholds, so every fit a player
  had yesterday is a fit they have today.

Brand Law 4 is untouched by all of this: the fits are cosmetic, the demands are
about years played and not money spent, and nothing purchasable moves any of it.

### Rule 4 · Nothing here becomes a currency

Brand Law 6 forbids coins, energy, gems and XP, and the temptation in a document
titled "progression" is to invent one. There is no points balance in any of
this. The wardrobe reads **fiscal years**, which is a real unit the game already
teaches. The Playbook spends **cash, founder energy and morale**, which are real
units the game already teaches. If a future change needs a number that does not
already mean something in a business, it is the wrong change.

---

## 5 · The Playbook — what actually got built

The shared activity list nearly triples, from 17 verbs to 48, and gains its
first nine two-level rows — 29 branches between them. Every entry follows the existing house rules:
`signal` is qualitative, the only number allowed before committing is the price,
the log line is a sentence, and none of it advances time.

The shape of it, by tab:

**Company** — the founder's public life and the company's legal skin, and the
tab with the most choosers on it, because it is where the range between cautious
and reckless is widest. Talk to the press (four outlets). Write the book (three
books). Speak somewhere (three rooms). Deal with the copycat (four answers, from
out-building them to briefing a journalist about them). File a patent.
Commission an audit. Form an advisory board. Join the trade body. Restructure.
Hire somebody to run the day.

**Team** — everything that happens to people. An offsite. Training. Equity
grants. Proper health cover. A senior hire, and whether they come from a rival,
a much bigger company, or the desk outside your office. Mentoring somebody.
Closing a whole function, and which one. The team tab had four rows and no way
to spend real money on people, which made "morale" a stat you watched rather
than one you touched.

**Product** — the shared half of it, which did not exist: the six industry
lenses owned the product tab entirely, so a player learned nothing transferable
about product from playing two industries. Sit in on customer calls. Kill your
worst feature. Ship a smaller version on purpose.

**Market** — sponsorship (three things to sponsor). A pricing experiment (three
directions, and one of them is down, which the tab could not previously
express). A distribution partner. A loyalty programme. A rebrand.

**Assets** — insurance, which finally gives `insurance_halves_damage` a way into
a run that is not an authored event. A ring-fenced reserve. A warehouse. Selling
the building back when the runway gets short. Giving something away, and
choosing whether it is money, product or your own time.

Costs stay inside the range the library already uses — no activity moves cash by
more than the IPO does, and none of them touch dilution except the two that
obviously must.

---

## 6 · What this document does *not* authorise

Stated explicitly, because the next session will be tempted:

- **No second time-advancing path.** Not a "run the year" button, not a
  fast-forward, not a debug skip. Brand Law 1, and `lib/engine/run.ts` is
  protected precisely so this stays true.
- **No rewriting `data/sections/*.json`.** The 255 authored events are verbatim
  prose. More *decisions* means more activities, not edited events.
- **No retuning the sim to accommodate a new activity.** If a Playbook entry
  turns out to be overpowered, the entry is wrong, not `sim.ts`.
- **No purchasable progression.** Not a fit, not an activity, not a year.
- **No scoring of how anybody sounds.** Brand Law 5 binds The Room, and the
  wider cast added for the daily rotation changes who answers, never how they
  are judged.

---

## 7 · How to tell whether it worked

The honest measure is retention, which this repo cannot see from here. The
proxies it *can* check, and which the test suite now asserts:

- A stage-5 company in year 6 is offered **more** activities than a stage-1
  company in year 1, not fewer. (`scripts/playbook-test.mjs`)
- Every two-level activity's branches are distinct, priced, and reachable, and
  every branch id round-trips through the tape.
- The wardrobe's six fits are bought with four *different* shapes of demand,
  and none of them is satisfiable by founding-and-abandoning alone.
- The Room's cast rotates on the real day, so a player who opens the trade index
  on Tuesday does not read Monday's page.

And the one that is not automatable, written down so it gets asked: **open the
company tab in year 3 and count how many rows you have never pressed.** If the
answer is zero, this document has stopped being true and the work starts again.
