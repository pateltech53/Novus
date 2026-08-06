# Outside the app

Novus draws itself on three surfaces it does not own: the Home Screen, the Lock
Screen, and the Dynamic Island. This is how, and what you have to do once to
make it real on a device.

```
lib/outside/            the snapshot, the plugin contract, the publisher, the links
ios/App/Shared/         the Swift both targets compile
ios/App/App/Outside/    the Capacitor plugin and the Live Activity director
ios/App/NovusWidgets/   the extension: nine surfaces, one provider, two activities
```

---

## What you have to do

Everything below is done. These four steps are the parts only you can do,
because three of them are an Apple Developer account and the fourth is a
person deciding.

### 1. An App Group, once, on the developer account

The widget extension is a **separate process with a separate container**. It
cannot read the app's `localStorage`, its `Documents` directory or its
`UserDefaults`. The one thing the two share is an App Group, and everything
that crosses goes through it.

1. developer.apple.com ▸ Certificates, Identifiers & Profiles ▸ **Identifiers**
   ▸ **App Groups** ▸ ＋
2. Description `Novus`, Identifier **`group.com.novuspitch.app`** — this exact
   string. It is already written into both entitlements files and into
   `OutsideStore.swift`, and `npm run test:outside` fails if the three ever
   disagree.
3. Under **App IDs**, open `com.novuspitch.app` and `com.novuspitch.app.widgets`
   and tick **App Groups** on each, then pick the group.

> If the widget is permanently empty and nothing else is wrong, this is why. A
> group the app can write and the widget cannot read fails silently and looks
> exactly like a widget nobody ever published to.

### 2. A second bundle ID

The extension ships as `com.novuspitch.app.widgets`. With automatic signing,
Xcode registers it for you the first time you build to a device — you do not
have to create it by hand, but it does have to be **prefixed by the app's own
bundle ID**, which it is.

### 3. Open Xcode once and set the team

```bash
npm run ios
```

`NovusWidgets` is already a target in the project — sources, Info.plist,
entitlements, the embed phase and the app's dependency on it are all committed.
Select the **NovusWidgets** target ▸ Signing & Capabilities ▸ set **Team** to
the same one the App target uses. That is the whole of it.

Check that **App Groups** shows `group.com.novuspitch.app` on both targets. If
it is missing, ＋ Capability ▸ App Groups and tick it — Xcode is reading the
entitlements file that is already there.

### 4. Decide about the Lock Screen default

`Settings ▸ THE GAME ▸ Company on the Lock Screen` is **on by default**. The
reasoning is in `lib/outside/publish.ts`: the activity only ever exists while a
company is open, it carries no notification, and it is swipe-dismissable. If
you would rather it be opt-in, one line:

```ts
// lib/outside/publish.ts
return window.localStorage?.getItem(PREF_KEY) === "on";   // was !== "off"
```

---

## Checking it worked

```bash
npm run test:outside      # the project file and the Swift ports' fixture
npm run ios               # build, then run on a device or simulator
```

Then, in the app, Safari ▸ Develop ▸ your device ▸ the app, and read:

```js
document.documentElement.dataset.outside      // "true" — the plugin answered
document.documentElement.dataset.outsideLive  // "true" — ActivityKit will take a request
```

The same line goes to the console once per launch, next to the one the Liquid
Glass chrome writes:

```
[novus] outside on · widgets yes · live activities yes · iOS 26
```

`live activities no` on a real device is usually not a bug: it is
**Settings ▸ Face ID & Passcode ▸ Live Activities** turned off, and the app is
reporting it rather than failing silently. The Settings row hides itself in
that case, because a switch that cannot change anything reads as a broken
feature.

**The simulator does not show Live Activities on the Lock Screen** in a way
worth judging. Use a device with a Dynamic Island for anything to do with the
compact and minimal presentations; the expanded one can be previewed in Xcode.

---

## How it works

### One snapshot, published declaratively

`lib/outside/snapshot.ts` builds a small, versioned struct out of `RunState`
and the island index. `lib/outside/publish.ts` hands it to native whenever it
changes — coalesced at 400 ms, de-duplicated against the last one actually
sent, and flushed on `pagehide` so the last state before the app goes away is
never left sitting in a timer.

The web layer never says *start* or *end*. It publishes the whole of what
should be true and `LiveActivityDirector` works out the difference. This is the
same contract `setChrome` has with `GlassChromeController`, for the same
reason: a start/update/end protocol across a bridge is a second source of truth
about what is on screen, and the two disagree the first time a message is
dropped, replayed or reordered.

The snapshot rides as a **JSON string**, not an object. Capacitor flattens a JS
object into `JSObject` of `Any`, and a cash figure that happens to be whole
arrives as `Int` while the same figure a month later arrives as `Double` — a
`Codable` struct accepts the first and refuses the second. A string has one
shape and `JSONDecoder` is the only thing that reads it.

### Every figure carries its own text

`fmtMoney` is the app's answer to "what does $12,400 look like": `12.4K`, with
a U+2212 minus and a trim rule for the decimal. Re-deriving that in Swift would
be a second implementation of a *display rule* across a process boundary.

So each figure ships as a pair — the raw number, for a gauge and a sparkline,
and the exact string the app itself would print, for the label. **Nothing in
the extension formats a number that has a `text` beside it.**

There is exactly one exception and it is documented at the top of
`NvFormat.swift`: RobinGhood is priced from the real clock and the extension
re-prices it for minutes the app never saw, so those numbers cannot arrive with
strings attached. That port is checked against the real `format.ts` on every
debug launch.

### The two Swift ports, and what stops them drifting

`ios/App/Shared/MarketMath.swift` and `ios/App/Shared/NvFormat.swift` are ports
of `lib/engine/market.ts` and `lib/engine/format.ts`. They exist because a
widget process cannot call the engine, and they are kept honest by three
things:

1. **No constants live in them.** `base`, `drift` and `vol` ride in the
   snapshot from `TICKERS`. Retuning a ticker changes nothing in Swift.
2. **The app's answer is the anchor.** Every snapshot carries the engine's own
   `value` and `unrealised` at a known minute; `repriced(at:)` returns those
   verbatim for that minute and extrapolates only forward.
3. **A fixture.** `npm run market:fixture` runs the real TypeScript over a
   spread of symbols, minutes and boundary values and writes the answers into
   `MarketFixture.swift`. Both ports replay it in `#if DEBUG` from the widget
   bundle's initialiser, and `npm run test:outside` fails CI if the committed
   fixture is stale.

Run `npm run market:fixture` whenever `market.ts` or `format.ts` changes what a
number is or how it is written, and **read the diff**: a change there means
every position on every Lock Screen is repriced.

### What is drawn, and where

| Surface | Family | Leads with |
|---|---|---|
| The Books | `systemSmall` | Runway, and the twelve-segment gauge under it |
| The Books | `systemMedium` | All four figures, plus twelve months of valuation |
| The Year | `systemSmall` | The month dial. Gold, and a different card, at the gate |
| Still Standing | `systemMedium` / `Large` | Every company, by peak valuation |
| RobinGhood | `systemSmall` | Book value, priced on a ticking timeline |
| Runway | `accessoryCircular` | A system `Gauge`. StandBy gets this for free |
| The Books | `accessoryRectangular` | Who, how long, how much — in that order |
| Runway | `accessoryInline` | One clause beside the clock |
| The fiscal year | Live Activity | Runway in the compact slot; the gate in gold |
| RobinGhood | Live Activity | Day change in the compact slot |

Small widgets lead with **runway**, not valuation, and that is a decision:
valuation is what a run is scored on, runway is what decides whether there is a
run left to score.

`design.md` §0 is enforced throughout — glass is a material for the control
layer, and **money is read on solid ground**. There is no glass anywhere in the
extension.

### What "live" honestly means

A Live Activity is **not a running process**. iOS renders these views as
snapshots: when the activity starts, when the app updates it, and when the
Dynamic Island is expanded. There is no timer in the extension that could fire
between those moments, and no server pushing to one — this app has no push
infrastructure and deliberately does not want any.

So:

- **The fiscal year activity** is exactly right between renders, because time
  in this game does not move on its own. `staleDate` is eight hours.
- **The RobinGhood activity** re-derives its numbers at *render* time rather
  than carrying them from publish time, so an expanded Dynamic Island shows the
  price now. Between renders it holds still. `staleDate` is two hours, and what
  actually goes stale there is the share count, not the price.
- **`MarketWidget` is the surface that genuinely ticks.** A widget timeline can
  return entries stamped with **future** dates, and the system renders each one
  at its moment without waking the app and without spending refresh budget.
  Because the tape is a pure function of the minute, four hours of it can be
  computed in one pass. This widget was not on the original list and is one
  file to delete if it is not wanted — it is here because without it "live P&L"
  is a claim the platform cannot keep.

### Where a tap lands

`novus://` — four destinations, parsed in `lib/outside/links.ts`, routed by the
web layer. `SceneDelegateProxy` already forwards `openURLContexts`, so the
whole native side is `CFBundleURLTypes` in `Info.plist`.

```
novus://play             the board
novus://gate             the board, with the year gate as the reason
novus://island/3         that company, then the board
novus://islands          the picker
novus://market           the board, with RobinGhood open on the phone
```

Anything unrecognised falls through to the board rather than failing: a widget
on someone's Home Screen outlives the version of the app that drew it.

---

## Known edges

- **The extension targets iOS 17; the app targets 15.** An extension may have a
  higher floor than its host. iOS 17 is where `containerBackground` became
  mandatory for Home Screen widgets — a widget that does not adopt it renders
  with no background at all, which looks broken rather than transparent. Below
  17 the app runs exactly as before and `capabilities()` reports
  `widgets: false`.

- **The widgets are set in SF, not in Urbanist and IBM Plex Mono.** Both of the
  app's faces come from `next/font/google`, which self-hosts them into the web
  build as WOFF2 — a format iOS cannot load, and a licence that would need
  re-checking to ship as a TTF inside a binary. What the extension draws instead
  is the same *distinction*: SF for labels, SF Mono for every figure, because
  The Books is a column of numbers that changes every month and proportional
  digits make the column jitter. Embedding the real faces is a later decision,
  not an oversight — it needs the TTFs added to the NovusWidgets target and
  `UIAppFonts` in its Info.plist.

- **Android has none of this.** `capabilities()` returns `available: false`,
  every publish is a no-op, and the Settings row does not render — the same
  shape `NovusGlass` already has there. The Android equivalents (a RemoteViews
  App Widget, and `Notification.ProgressStyle` for the Live Update capsule) are
  a separate piece of work and nothing here blocks it.

- **The dark ground is `--n-1` (#101214), not `THEME_COLOR_DARK` (#1c1d21).**
  Those two have always disagreed by one step; the first is what the app's
  screens paint and the second is the browser chrome and the shell's pre-paint
  background. The widget follows what a player actually looks at.
