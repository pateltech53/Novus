# The app

Novus ships as an iOS app, an Android app and a website from one codebase.
The shells are **remote**: Capacitor points the webview at the live site
(`server.url` in `capacitor.config.ts`), so a web deploy IS an app release
and nothing but native code ever needs a store resubmission. What the shells
add is the chrome: on iOS the tab bar, the advance button and the masthead
controls are withdrawn from the DOM and re-drawn by UIKit, so they are the
system's real Liquid Glass rather than a CSS impression of it — the whole
handoff is plugin traffic over the injected bridge, which is exactly why it
is indifferent to where the page came from.

```bash
npm install
npm run build:native          # export (for audits) + verify + copy the shell
npm run ios                   # …and open Xcode
npm run android               # …and open Android Studio
```

---

## How the two builds differ

| | web (`npm run build`) | app |
|---|---|---|
| Output | `.next` server build | the same deploy, loaded remotely |
| On device | — | `native/shell/index.html` (the offline notice) |
| Entry | `/` — the landing page | `/boot.html` → the right screen |
| API routes | same origin | same origin (`www.novuspitch.com` serves both) |
| Tab bar / CTA / masthead controls | React + CSS glass | UIKit Liquid Glass (iOS) |
| Haptics | `navigator.vibrate` (nothing on iOS) | the Taptic Engine |

`NEXT_PUBLIC_NATIVE=1` still exists and still flips `next.config.ts` into a
static export — but the export's remaining job is the Playwright audits and a
compile gate, not the binaries (`scripts/build-native.mjs`'s header carries
the whole accounting of what was retired with the bundle).

### One origin now, and what that retired (superseded 2026-08-31)

The bundled shell served itself from `app.novuspitch.com` (`capacitor://` on
iOS, `https://` on Android) and called the API cross-origin — a design that
required CORS in `middleware.ts`, the `NATIVE_ORIGINS` allow-list feeding the
CSRF guard, the native cookie jar for the session, and a build-time
`NEXT_PUBLIC_API_ORIGIN` verified against the emitted chunks because a
redirecting host fails every preflight. The remote shell is served from
`https://www.novuspitch.com` — the same host the API answers at — so inside
the app everything is **same-origin** again: the CSP's `connect-src 'self'`
passes, `Sec-Fetch-Site` says `same-origin` and the CSRF guard needs no
carve-out, and the session cookie is an ordinary first-party cookie.

The old machinery deliberately stays: `NATIVE_ORIGINS`, the CORS middleware
and `CapacitorCookies` keep serving any bundled TestFlight build still out
there, and `lib/native/origin.ts` keeps `apiUrl()` absolute (an absolute URL
to your own origin is still `'self'` to CSP). `build-native.mjs` still reads
the origin back out of the artifact — and now also asserts that
`capacitor.config.ts`'s `server.url`, the offline page's RETRY link and the
API origin are one host, because the whole security story above is
same-origin and three files carry the value.

**The web's security headers apply inside the app now.** The bundled shell
never saw `next.config.ts`'s CSP; the remote one lives under it. That is a
feature — the child-safety rule (`connect-src 'self'`, nothing third-party
from a page a minor is looking at) is now enforced in the app by the same
header that enforces it in the browser.

### What the shells gave up, on the record

- **Offline play.** The bundled app played entirely offline; the remote one
  needs the network and shows `native/shell/index.html`
  (`server.errorPath`) when it has none. Accepted deliberately in exchange
  for web-deploy releases — the app was pre-release, so no player lost
  anything. If offline ever matters again the honest path is
  WKAppBoundDomains + a service worker, recorded as an open item in
  docs/HANDOFF.md.
- **The capacitor:// origin's localStorage.** An origin change orphans
  per-origin storage; only TestFlight installs existed, and cloud sync
  covers any signed-in account.
- **A network-free cold start.** The splash still holds until the first real
  frame (`lib/native/boot.ts`), but the first frame now arrives over TLS.
  The 6-second `launchShowDuration` backstop in `capacitor.config.ts` was
  calibrated to a local bundle and is now doing real work on bad networks.

### What the build script still does, and why

**`app/api` moves aside for the export.** `output: "export"` refuses to build
a dynamic route handler, and all seven of ours are — they read cookies, verify
Stripe signatures and talk to Supabase. There is no per-route opt-out.
Narrowing `pageExtensions` to `.tsx` looks tidier and breaks Next's own
resolution of its page aliases, so the directory moves and moves back in a
`finally` that also runs on Ctrl-C.

**`public/boot.html` is the app's entry point** — `server.appStartPath`
points every launch at it. A Next.js route cannot answer "which screen does
this player belong on" until the framework, the router and the page chunk
have all parsed. That document reads two keys out of `localStorage` and
redirects, in one parse. `/` — the marketing landing, with a WebGL scene on
it — is never the first thing a cold start pays for. (Its bundled ancestor,
`native/boot.html`, needed `index.html`-suffixed targets for the local file
server's routing rule; the remote one navigates real routes, and
`lib/native/href.ts` applies the suffix only when a document really is served
by the bundled router.)

**It verifies the native projects hold this build's shell** — the offline
document byte-for-byte, and a generated `capacitor.config.json` carrying
`server.url`, `appStartPath` and `errorPath`, because losing that config does
not fail, it ships an app that opens on the offline page forever. And it
fails the build if `package.json` carries a Capacitor plugin that
`ios/App/CapApp-SPM/Package.swift` does not — the sign-in plugin shipped
missing from build 1.0(3) exactly that way.

---

## The Liquid Glass chrome

Five Swift files in `ios/App/App/Native/`:

| File | What it is |
|---|---|
| `GlassKit.swift` | The material, and the only place that decides what "glass" means |
| `GlassChromeController.swift` | The play screen: tab bar, advance deck, masthead cluster, glass notes |
| `GlassOverlayController.swift` | Every other screen: floating toolbar, segmented control, action dock |
| `GlassSheetController.swift` | The month's decision, presented over a blurred game |
| `NovusGlassPlugin.swift` | The Capacitor bridge |
| `NovusBridgeViewController.swift` | Registers the plugin explicitly |

and on the web side: `lib/native/glass.ts` (the contract), `lib/native/chrome.ts`
(the handoff), and four hooks in `components/native/` for what the play screen
asks for, what any other screen asks for, the decision sheet, and
term-on-first-use.

### Every surface design.md allows

`design.md` §0 draws one line: **glass is a material for the control layer,
never for content**, and *money is read on solid ground*.

For a long time "the control layer" was read as *the chrome* — five named
surfaces on one screen — and everything else in the app was a flat fill. §0 now
says what it always meant: a **button is** the control layer. What that buys,
natively:

| Sanctioned surface | Where it is |
|---|---|
| floating tab bar / bottom nav | system `UITabBar` |
| the FAB | tinted `UIGlassEffect` capsule — orange, or gold at the year gate |
| a screen's toolbar, its filter and its primary action | `GlassOverlayController` |
| every button on a screen the DOM still draws | `.nv-gc` in `globals.css` |
| sheet grabber | `GlassSheetController` |
| a sheet header once content scrolls under it | same, fading in on overscroll |
| toasts | `toast(title:text:tone:)`, which term-on-first-use now uses |
| the year-gate banner | the gold state of the FAB |
| modal scrims | `GlassKit.backdrop()` behind the decision sheet |

### The screens that used to have no glass at all

`GlassChromeController` draws the play screen, and it was the only thing that
drew anything. Every other screen in this game — the six activity screens, the
closet, settings, the in-fiction phone, the panel room, onboarding, the year-end
statement — is a full-screen web overlay, and a native view always composites
above the webview, so the moment one opened the chrome had to withdraw
(`mode: "hidden"`).

Which meant the deeper a player went, the less Liquid Glass there was, until
there was none. The material was a property of one screen rather than of the
app.

`GlassOverlayController` is the other half, and it is the same three rules:

- **A floating glass toolbar** at the top — a leading cluster, a title on its
  own plate, a trailing cluster, each cluster inside a `UIGlassContainerEffect`
  so its circles merge and separate as the system's own do.
- **A glass segmented control** under it, where a screen has a filter.
- **A floating glass dock** at the bottom for what the screen is asking you to
  do, built on `UIButton.Configuration.prominentGlass()` — Apple's own Liquid
  Glass button, with the system's own metrics, disabled behaviour and contrast
  handling, rather than a plain button laid on top of a blurred view.

It measures itself after layout and reports `--nv-overlay-top` and
`--nv-overlay-bottom`, and the screen underneath reserves exactly that. The
sheet screens cap their own height against it — `max-h-[min(88dvh,calc(100dvh
- var(--nv-overlay-top) - 0.75rem))]` — which is 88dvh everywhere there is no
toolbar, because the variable is 0 there.

### What is actually native, screen by screen

Every full-screen overlay in the app now hands its way out to UIKit —
`useNativeGlassClose(label, onClose)` is one line and declares a real
`UIGlassEffect` circle over the scrim:

| Screen | Native |
|---|---|
| the six activity screens | close, via `ScreenSheet` |
| settings | close, and the account's actions in the glass dock |
| the company dossier | back / close (`chevron.backward` in the overlay variant) |
| Still Standing | close |
| the in-fiction phone | PUT IT DOWN |
| the Pro sheet, the upgrade screen | close |
| a legal document | back — it opens *from* another screen |
| an activity sheet | close |
| the team screen | close, **and "Hire on LinkedOut" in the glass dock** |

Two of those are worth naming, because they are the pattern for the rest:

**Settings' theme picker is NOT in the toolbar**, and that is worth writing
down because it was, briefly. The reasoning for putting it there was sound —
the toolbar is the only part of that screen that holds still, so it is the only
part that *can* be native — and it was still the wrong call. A three-way choice
about how the app looks is a setting, and a setting belongs in the list of
settings under the heading that names it, not in the chrome sixty points above
the sentence explaining it, where it reads as a filter over the page rather
than a row of it.

`GlassOverlayController` keeps its segmented control. It has no caller today;
`ScreenSheet.nativeSegments` is the handoff for the first screen whose filter
genuinely is chrome.

**The team screen's one action is in the dock.** Hiring has exactly one route,
and the screen used to say so twice in two orange buttons because there was
nowhere fixed to put it. `UIButton.Configuration.prominentGlass()`, pinned
above the safe area, reachable without scrolling the roster.

### What stays CSS, and why it is not a shortfall

A native view composites **above** the webview and cannot scroll with web
content. So a surface can be native if and only if it holds still. That is the
whole rule, and it is not a matter of effort:

- **Can be native, and is**: the tab bar, the advance deck, the masthead
  cluster, every screen's toolbar and dock, the decision sheet, toasts.
- **Cannot be, and is CSS**: anything inline in a scroll — the ledger tiles,
  the life log's cards, the dossier's stat tiles, a screen's body copy and the
  controls inside it.

Pushing scroll offsets across the bridge to chase the webview would put an
async hop between a finger and a view that the webview itself is scrolling on
its own compositor thread. It would visibly lag, and a lagging native overlay
looks worse than a CSS one that is simply attached to the content. The way to
make those genuinely native is to take them out of the webview entirely — a
native scrolling region with the web layer drawing only the masthead — which
is a different and much larger change.

Registration is a **stack**, not a setter (`components/native/useNativeOverlay.ts`).
Screens genuinely nest — settings opens a legal document over itself, the closet
previews an item — and whichever is on top is the one whose chrome is on screen.
Unmounting re-pushes whatever is underneath, so closing a legal sheet does not
leave a settings screen with no way out of it.

### And inside the iOS app: the control material

Native draws the chrome. It cannot draw the other 170 buttons — they are DOM,
they scroll, and a native view cannot be inside a web scroll container. So
`globals.css` grew the control half of the material to sit beside the panel
half, and **it is gated to iOS**: `[data-platform="ios"]`, written on `<html>`
by a blocking script in `<head>`, decides whether any of it renders.

On Android and on the web every one of these is a solid, shadowed panel
instead. Liquid Glass is a material iOS renders; everywhere else it is an
approximation of one, and an approximation of a lens invites the one
comparison it cannot win. The gate moves two properties — the backdrop and the
fill — so the layout, the tap targets and the ink are identical on all three
platforms and only the substance differs.

| Class | What it is |
|---|---|
| `.nv-gc` | A control. Blur, tint, specular crest, shadowed underside, ring, and a press that scales and brightens on the curve UIKit uses |
| `.nv-ggroup` | The web's `UIGlassContainerEffect` — one blur for a whole cluster, children get a hairline. A thirteen-row settings list costs one compositor pass, not thirteen |
| `nv-flat` | A control that is already ON glass. Keeps the tint and the press, drops the blur, because two stacked backdrops are a smudge rather than deeper glass |
| `nv-t-*` | The tone, which colours the material rather than painting over it — the web's `UIGlassEffect.tintColor` |
| `data-live-3d` | On a screen that runs a WebGL canvas. Every control inside it goes opaque |
| `[data-platform="ios"]` | The gate. Absent → no backdrop, no crest, no sheen, anywhere |

`components/ui/Glass.tsx` is still the only file allowed to reach for the
material, and it now exports `GlassButton`, `GlassLink`, `GlassGroup`,
`GlassRow`, `GlassSegmented` and `GlassPane` alongside the original panel.

The masthead cluster additionally sits inside a `UIGlassContainerEffect`, so
the circles merge and separate as the system's own do rather than reading as
three unrelated panes.

The decision sheet's own surface and its choice rows are glass too — the named
exception in `design.md` §0, taken deliberately rather than by erosion. It is
iOS-only (the web and Android sheet stays opaque), the cost chip moved to
`label` semibold to pay for the legibility it costs, and it is one line to undo
in `choiceRow` if it reads muddy on a device.

### Why the sheet is native at all

For the scrim. A `backdrop-filter` inside the webview can only blur other web
content, and the thing worth blurring is the game the sheet is covering. Only
a native presentation can put a real system material between the player and
the board. Real sheet physics, pull-to-dismiss and scroll deceleration come
along with being there anyway.

### The three rules it is built on

**The material is never approximated.** On iOS 26 it is `UIGlassEffect` and a
system `UITabBar`, composited by the OS. Before iOS 26 there is no Liquid Glass
to ask for, so it falls back to `.systemThinMaterial` — still a real native
material, just an older one. `#if compiler(>=6.2)` guards the SDK; `#available`
guards the runtime. Both are needed and neither is sufficient alone.

**Nothing is ever occluded.** The web layer is never told how tall the tab bar
is. UIKit measures itself after layout and reports back as `--nv-chrome-top`,
`--nv-chrome-bottom` and `--nv-chrome-tabbar`, and the play screen reserves
exactly that. If a bar comes out 4pt taller on some device than any constant
would have predicted, the content above it moves by 4pt.

**Anything drawn over the game hides all of it.** A native view always
composites above the webview — there is no z-index on the web side that can win
that argument. Every sheet and screen in this app is a full-screen web overlay,
so the moment one opens, `mode: "hidden"` goes across the bridge. The
reservation stays, though: collapsing it would reflow the play screen behind
the sheet and reflow it back on dismiss.

The guided first play used to be the one case that ran the other way. It dims
the screen and cuts a hole around a DOM element, which cannot work on a UIKit
view: native composites above the webview, so a web scrim cannot dim it and a
web hole cannot expose it. The old answer was to hand the chrome back to the
DOM for the duration.

That answer was wrong, and the reason is not visible in the code. The guided
run is a new player's entire first session — so the app's first impression
contained no Liquid Glass anywhere, on the one screen most worth showing it on.

`mode: "coach"` is the fix. The chrome dims and disables itself, leaves exactly
one surface lit and tappable, and reports that surface's frame back with the
insets so the coachmark card can sit beside it. Lit and tappable are both
required: a native control left live over a dimmed screen is a player
advancing the month in the middle of being told what a month is. Steps declare
their own native surface (`CoachStep.native`), and on Android and the web the
same steps find real DOM elements and are measured the ordinary way.

### Telling which material you are actually looking at

Two things silently produce a native chrome that is *not* Liquid Glass: an
Xcode older than 26 compiles the fallback, and a device older than iOS 26
declines it at runtime. Both leave `.systemThinMaterial` on screen — a real
native material, and a frosted pane rather than a lens. The difference is
obvious side by side and nobody has them side by side, so the app writes it
down on the root element at launch:

```js
document.documentElement.dataset.nativeGlass   // "true" — the plugin answered
document.documentElement.dataset.liquidGlass   // "true" — it is UIGlassEffect
document.documentElement.dataset.nativeOs      // "26"
```

Safari ▸ Develop ▸ Simulator ▸ the app, and read them. The same line goes to
the console once per launch. `liquidGlass: false` on a green build is not a
bug — it is the simulator runtime, and the fix is a newer one in Xcode ▸
Settings ▸ Components.

---

## Outside the app

The chrome above is what the game looks like while you are in it. The Home
Screen, the Lock Screen and the Dynamic Island are the other half, and they are
a second build target — `ios/App/NovusWidgets/` — reading a snapshot the app
publishes into a shared App Group.

| | |
|---|---|
| `lib/outside/` | the snapshot, the plugin contract, the publisher, the links |
| `ios/App/Shared/` | the Swift both targets compile |
| `ios/App/App/Outside/` | the Capacitor plugin and the Live Activity director |
| `ios/App/NovusWidgets/` | nine surfaces, one timeline provider, two Live Activities |

Same contract as the chrome, deliberately: the web layer publishes **the whole
of what should be true** and native works out whether that means starting an
activity, updating one, ending one or reloading a timeline. `publish()` is the
`setChrome()` of this half.

Every figure crosses the bridge twice — as a number, for a gauge or a meter,
and as the exact string `fmtMoney` produced, for the label — so
nothing in the extension re-implements a display rule. The one exception is
RobinGhood, which is priced from the real clock and therefore has to produce
numbers the app never saw; that port and the money format's are both checked
against the engine on every debug launch by a fixture CI keeps current.

**[docs/WIDGETS.md](WIDGETS.md)** is the whole of it, including the four things
that need a developer account rather than a commit.

### If the plugin is not there

Every path degrades to "the web chrome, exactly as before": not iOS, plugin
missing, old binary, native threw. There is no state in which the player ends
up with no way to advance the month. `probeNativeChrome()` asks once per
launch and the answer is a `useSyncExternalStore` the whole tree reads.

---

## Checking it

```bash
npm run check          # content pipeline + typecheck + a 30×8 simulation
npm run build:native:only
npm run audit:phone    # play + all six screens at 320 / 375 / 393 / 430
```

`audit:phone` drives the real export with a real five-month run and fails on
type under the 12px floor, text clipped by its own box, controls a thumb cannot
land on, anything genuinely unreachable under the bottom bar, and any page
wider than the screen. Screenshots land in `.audit-shots/`.

It hit-tests rather than reading boxes, which matters: a 28px switch with a
44px touch area is correct, and only `document.elementFromPoint` knows the
difference. It also distinguishes "below the fold" from "covered" by scrolling
a covered element into view and re-testing.

CI covers the rest — `.github/workflows/ci.yml` builds both outputs and an
Android APK, and `ios-build.yml` compiles the Swift on a macOS runner, which is
the only thing standing between a typo in `Native/` and finding it in Xcode.

---

## Shipping

### iOS

Open `ios/App/App.xcodeproj`, set the team, archive. The bundle id is
`com.novuspitch.app`, portrait-only, iPhone-only, iOS 15 and up.

Portrait-only is a real decision, not an oversight: the whole layout is a phone
held upright — masthead, ledger, log, one button — and there is no landscape
composition of that. iPhone-only follows from it, because iPadOS 26 no longer
lets an app opt out of resizing. Both are one line each
(`UISupportedInterfaceOrientations` in `Info.plist`, `TARGETED_DEVICE_FAMILY`
in the project) if that changes.

**iPhone-only does not mean iPad-free** — App Review ran build 1.0(3) on an
iPad Air in iPadOS's window for iPhone apps and rejected what it saw
(docs/APP-STORE.md §0). The answer is not an iPad build; it is that the
layout now tolerates any window width the shell is handed: the `desk:`
variant in `globals.css` keeps shells on the phone composition, capped and
centred, and the UIKit chrome caps its floating surfaces at the DOM's own
672 (`GlassChromeController.pinHorizontally`).

Xcode 26 is needed for the Liquid Glass path to compile at all. On anything
older the `#if compiler(>=6.2)` guards select the pre-26 material and the app
still builds and runs — which is why `ios-build.yml` fails outright on an
older toolchain rather than reporting a green run that only type-checked the
fallback.

### Android

Tag a release and the workflow does the rest:

```bash
git tag v1.0.0 && git push --tags
```

`android-release.yml` builds the APK and the AAB, publishes them to a GitHub
release as `novus.apk` / `novus.aab`, and `/download` links
`releases/latest/download/novus.apk`, which always resolves to the newest one.
The page never needs editing when a build ships.

**Signing.** Set four repository secrets and releases are signed with your own
key, so each one installs over the last:

```
ANDROID_KEYSTORE_BASE64      base64 -w0 novus.jks
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Without them the job still publishes an installable APK, signed with the
runner's throwaway debug key — playable, but the key changes every build, so
each one has to be uninstalled before the next goes on. The release notes say
so rather than leaving someone to find out.

### The download page

`/download` is static and needs no deploy step to stay current. The two iOS
links are environment-driven and absent by default, because an App Store URL
cannot be guessed and a download page whose main button 404s is worse than one
that says the build is not out yet:

```
NEXT_PUBLIC_IOS_APP_URL=https://apps.apple.com/app/id…
NEXT_PUBLIC_TESTFLIGHT_URL=https://testflight.apple.com/join/…
```

---

## Known edges

- **Android gets CSS glass, not Liquid Glass.** The layered material in
  `globals.css` is built out of what a browser is fast at: blur, saturate, a lit
  top edge and a shadowed underside. The next step up is an SVG
  `feDisplacementMap` on the backdrop — the one effect that actually separates
  liquid glass from frosted glass — which Safari does not support in
  `backdrop-filter` at all and which costs a full-surface GPU pass per frame on
  the phones that most need to stay smooth. The platform that can do it
  properly does it natively.
- **The binary carries one page.** The ~58 MB export that used to ship on
  device (mascot GLB, onboarding clips, the MediaPipe runtime) is served
  from the site now, like everything else — still all first-party on
  purpose: a minors' product should not open a connection to a CDN every
  time a camera turns on, and `connect-src 'self'` now enforces that inside
  the app too. What remains on device is `native/shell/index.html`, the
  offline notice.
- **Nothing is sold in the app.** Store builds price nothing and link to
  nothing (`lib/commerce.ts`; docs/APP-STORE.md §§0–1 for the two
  experiments that preceded that rule and how each ended); Pro arrives via
  account sign-in and Restore.
