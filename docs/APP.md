# The app

Novus ships as an iOS app, an Android app and a website from one codebase.
Capacitor wraps the same static export in both shells. What differs is the
chrome: on iOS the tab bar, the advance button and the masthead controls are
withdrawn from the DOM and re-drawn by UIKit, so they are the system's real
Liquid Glass rather than a CSS impression of it.

```bash
npm install
npm run build:native          # export + copy into ios/ and android/
npm run ios                   # …and open Xcode
npm run android               # …and open Android Studio
```

---

## How the two builds differ

| | web (`npm run build`) | app (`npm run build:native`) |
|---|---|---|
| Output | `.next` server build | `out/` static export |
| Entry | `/` — the landing page | `boot.html` → the right screen |
| API routes | served from the same origin | called at `NEXT_PUBLIC_API_ORIGIN` |
| Tab bar / CTA / masthead controls | React + CSS glass | UIKit Liquid Glass (iOS) |
| Haptics | `navigator.vibrate` (nothing on iOS) | the Taptic Engine |

`NEXT_PUBLIC_NATIVE=1` is the switch. Everything it changes is in
`next.config.ts` and `scripts/build-native.mjs`.

### The app's calls are cross-origin, and that has two consequences

The bundle is served from `app.novuspitch.com` — `capacitor://` on iOS,
`https://` on Android — while the route handlers live at the real origin. Every
call the app makes is therefore cross-origin, which the web build never is. Two
things follow, and both were learned the hard way:

**CORS is required.** A JSON POST asking for credentials is preflighted, and a
preflight with no `Access-Control-Allow-Origin` is refused before the real
request is ever sent. `middleware.ts` answers it, echoing only the two origins
in `lib/native/origins.ts` — never `*`, which is invalid with credentials
anyway. Every other origin gets no CORS headers and stays blocked.

**`NEXT_PUBLIC_API_ORIGIN` must be the canonical host.** Browsers do not follow
redirects on a preflight, so an origin that 308s (`novuspitch.com` →
`www.novuspitch.com`) fails every call from the app while working perfectly in
a browser tab. Point it at the host that answers, not the one that redirects.

Its default lives in `lib/native/origin.ts` and **only** there. It briefly lived
in two places — `scripts/build-native.mjs` carried a copy — and when the one in
source was corrected, the copy went on overriding it on every native build. The
fix shipped, the build was green, the export was fresh, and no binary ever got
it. So `build-native.mjs` now reads the origin back out of the chunks it just
emitted and fails the build if the string that landed is not the string the
repo declared. It prints the host on every run:

```
· the app will call https://www.novuspitch.com
```

That line is worth reading. A value that can be overridden from three places
needs to be checked against the artifact, not against the configuration.

Both failures look identical from inside the app — "network error" — and
neither can reproduce on the web, where the same code is same-origin and no
preflight happens at all. That asymmetry is why they survived every check that
ran on the web build.

The same origin list drives the CSRF guard in `lib/supabase/route.ts`: the app
is first-party and genuinely cross-site, so `Sec-Fetch-Site` says "cross-site"
and is right. `crossSite()` checks the allow-list first for exactly that
reason.

### Two things that build script does, and why

**`app/api` moves aside for the duration.** `output: "export"` refuses to build
a dynamic route handler, and all seven of ours are — they read cookies, verify
Stripe signatures and talk to Supabase. There is no per-route opt-out.
Narrowing `pageExtensions` to `.tsx` looks tidier and breaks Next's own
resolution of its page aliases, so the directory moves and moves back in a
`finally` that also runs on Ctrl-C.

**`native/boot.html` becomes the app's entry point.** A Next.js route cannot
answer "which screen does this player belong on" until the framework, the
router and the page chunk have all parsed. That document reads two keys out of
`localStorage` and redirects, in one parse. `index.html` — the marketing
landing, with a WebGL scene on it — is never the first thing a cold start pays
for.

---

## The Liquid Glass chrome

Four Swift files in `ios/App/App/Native/`:

| File | What it is |
|---|---|
| `GlassKit.swift` | The material, and the only place that decides what "glass" means |
| `GlassChromeController.swift` | Tab bar, advance deck, masthead cluster, scroll-edge bar, glass notes |
| `GlassSheetController.swift` | The month's decision, presented over a blurred game |
| `NovusGlassPlugin.swift` | The Capacitor bridge |
| `NovusBridgeViewController.swift` | Registers the plugin explicitly |

and on the web side: `lib/native/glass.ts` (the contract), `lib/native/chrome.ts`
(the handoff), and three hooks in `components/native/` for what the play screen
asks for, the decision sheet, and term-on-first-use.

### Every surface design.md allows, and no others

`design.md` §0 draws one line: **glass is a material for the control layer,
never for content**, and *money is read on solid ground*. It then names the
exact surfaces that may be glass. All of them now are, natively:

| Sanctioned surface | Where it is |
|---|---|
| floating tab bar / bottom nav | system `UITabBar` |
| the FAB | tinted `UIGlassEffect` capsule — orange, or gold at the year gate |
| sheet grabber | `GlassSheetController` |
| a sheet header once content scrolls under it | same, fading in on overscroll |
| toasts | `toast(title:text:tone:)`, which term-on-first-use now uses |
| the year-gate banner | the gold state of the FAB |
| modal scrims | `GlassKit.backdrop()` behind the decision sheet |

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
- **The bundle is ~58 MB on device**, most of it the mascot GLB, the onboarding
  clips and the MediaPipe runtime that scores pitch delivery. All of it is
  same-origin on purpose: a minors' product should not open a connection to a
  CDN every time a camera turns on.
- **Pro is still simulated.** `ProSheet` is a switch, not a purchase, so
  nothing in the app touches Stripe and App Store guideline 3.1.1 does not
  apply yet. It will the day that button becomes real.
