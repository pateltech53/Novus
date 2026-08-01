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
| `GlassChromeController.swift` | The tab bar, the advance deck, the masthead cluster, toasts |
| `NovusGlassPlugin.swift` | The Capacitor bridge |
| `NovusBridgeViewController.swift` | Registers the plugin explicitly |

and three on the web side: `lib/native/glass.ts` (the contract),
`lib/native/chrome.ts` (the handoff), `components/native/usePlayChrome.ts`
(what the play screen asks for).

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

The guided first play is the one case that runs the other way. It dims the
screen and cuts a hole around a DOM element, and it cannot cut a hole around a
UIKit view — so during coaching the DOM chrome comes back and the native chrome
stands down.

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
older the guards select the pre-26 material and the app still builds and runs.

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
