# App Store listing copy

The text for the App Store Connect metadata form, ready to paste. Companion to
[APP-STORE.md](APP-STORE.md), which covers what the *code* does about review —
this file is part of §6, "what is still a form". All fields are English
(en-US, the app's only language).

Character counts below were measured with `len()` in Python over the exact
strings; App Store Connect counts the same way (every character including
spaces). Apple's limits: subtitle 30, promotional text 170, description
4,000, keywords 100. The subtitle is additionally held to 20 by team
preference.

Two deliberate omissions, both load-bearing:

- **No mention of Novus Pro, prices, or "buy on the web" anywhere.** Guideline
  3.1.3(a) reaches metadata too — a description that points at an external
  purchase is the same rejection as a button that does. The free game is
  complete, so the copy sells that.
- **No competitor trademarks.** "BitLife-style" is fine in a README and a
  2.3.7 metadata rejection on a listing, so the description says what the
  game is instead of what it resembles.

---

## Name — 5/30

```
Novus
```

## Subtitle — 20/20

```
The startup life sim
```

Descriptive beats clever here: the subtitle is indexed for search, so it earns
"startup", "life" and "sim" — which is why those words are *not* spent again
in the keyword field below (Apple ignores duplicates; the characters would be
wasted).

---

## Promotional text — 158/170

Updatable at any time without a new build or review; use it for launch news
later.

```
Keep a company alive — and defend it out loud. Run your startup month by month, then pitch five AI sharks on camera to close the year. Your pitch is the game.
```

---

## Description — 2,664/4,000

```
Novus is a life sim where the life is a company.

Found a startup, run it month by month, and try to keep it alive — through hiring calls, pricing wars, supplier drama and the occasional disaster. Time only moves when you say so. But a fiscal year only closes one way: you turn on the camera and pitch, out loud, to a panel of five AI investors who have read your books.

Tap games let you tap. Here, you talk to progress.

RUN THE COMPANY
• Hundreds of hand-authored decision events that play out as thousands of distinct situations across stages and industries.
• Watch The Books react to every choice: cash, burn rate, runway, valuation.
• Grow from a garage to an IPO — or go down honestly, in Chapter 7.
• Today's Market: one shared event each day — the same storm for every player, hitting every company differently.

FACE THE SHARKS
• Close each fiscal year by pitching on camera to five AI investors, each with their own temperament and agenda — then survive their questions.
• They have read your numbers. Claim a margin you don't have, and they will notice.
• Earn a score, a debrief with specific fixes, and — if you deserve one — a term sheet.
• No camera? Type your pitch instead. It is scored exactly the same way.

SCORED ON SUBSTANCE, NEVER ON YOUR VOICE
Novus never grades your accent, tone, energy or how confident you sound. Your score comes from what you said and whether your claims survive a look at your own books. Delivery figures like pace are reported back to you as coaching — they never touch the grade.

LEARN THE REAL LANGUAGE
Burn rate, runway, dilution, gross margin, Chapter 7 — Novus speaks the words real founders use, and Rookie Mode explains every term in plain English the first time it appears. No coins. No XP. Nothing to unlearn later.

LOSE, THEN LEARN WHY
Every dead company gets an autopsy: the decisions that actually killed you, ranked by the damage they did. Losing stings. Restarting takes ten seconds.

FAIR BY DESIGN
The whole game is free — every mechanic, the full pitch, the same scoring, the same leaderboard as everyone else. Nothing purchasable changes a score, a survival or a place on the board.

YOUR VIDEO STAYS YOURS
Pitch video never leaves your device: delivery coaching reads frames in memory and keeps only averages. Audio is used for transcription only and is never stored. Camera, microphone and speech recognition are all optional. No ads. No tracking.

Built in one summer by five students at the LaunchX Flagship program — for everyone who has ever talked back to a pitch on TV, and for every DECA and FBLA competitor who wants reps before the real thing.

Found it. Run it. Defend it out loud.
```

---

## Keywords — 99/100

Single words, half-width commas, no spaces; the algorithm composes phrases
("business simulator", "startup tycoon") from the parts, including words it
takes from the name and subtitle. "novus", "startup", "life" and "sim" are
not spent here because the name and subtitle already earn them.

```
business,simulator,tycoon,pitch,entrepreneur,ceo,investor,shark,founder,money,empire,boss,deca,fbla
```

Caveat: `deca` and `fbla` are the names of the student organizations the game
courts. Keywords are invisible to users and this is common practice for
education-adjacent apps, but if a metadata rejection ever cites 2.3.7, those
two are the first to drop — swap in `job,bank`.
