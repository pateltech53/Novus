# Shipping Novus to the App Store

What the code now does about App Review, what is still a form somebody has to
fill in, and the rejections this app has actually collected.

Nothing in here is speculative: every guideline number below was checked
against what the build actually does, on the screens the shipped app actually
opens. The app is iPhone-only (`TARGETED_DEVICE_FAMILY = "1"`), portrait-only,
iOS 15 and up — **and Apple reviews it on iPad anyway**, in iPadOS's window
for iPhone apps (see §0).

---

## 0. Build 1.0(3): the real rejection, in four parts

On 2026-08-31 Apple rejected build 1.0 (3) — reviewed on an iPad Air 11-inch
(M3), iPadOS 26.6.1 — on four guidelines. What each one actually was, and
what answered it:

1. **2.1(a) — "An error message was displayed when we attempted to Sign in
   with Apple."** A real defect, and a deterministic one: on iOS
   `lib/cloud/native-oauth.ts` offered the Apple button unconditionally but
   only passed an `apple` key to the plugin's `initialize()` when
   `NEXT_PUBLIC_APPLE_SERVICES_ID` was baked — so an unconfigured build
   errored on every tap ("No provider was initialized"), and a configured one
   handed the plugin a `redirectUrl` that hijacked its native flow into a
   backend exchange Supabase never answers, failing after the sheet instead
   of before it. Fixed: iOS always initializes `apple: {}` (the Services ID
   and return URL are Android's web-flow needs, not iOS's), the plugin is
   committed to `ios/App/CapApp-SPM/Package.swift` so a binary can no longer
   silently ship without it, and `scripts/build-native.mjs` fails the build
   if the manifest and package.json ever disagree again. The error surface
   now carries the underlying cause in parentheses, so the next screenshot
   diagnoses itself. Not iPad-specific — it reproduced identically on iPhone.
   Two dashboard checks remain for a person (§6a).

2. **3.1.1 — "The plans can be purchased in the app using payment mechanisms
   other than In-App Purchase."** The post-injunction GET PRO link-out
   (§1 below) opened the pricing page in SFSafariViewController — inside the
   app — where the plans were purchasable through Stripe. Withdrawn: store
   builds are sells-nothing again, and three ungated price surfaces found in
   the same audit (the prerendered landing pricing grid, `/chapter`'s licence
   blurb, `/product/institutions`) are now gated the same way. One accepted
   exception, on the record: the in-app Terms sheet states Pro's prices as
   part of the EULA's subscription-terms disclosure (3.1.2 asks for exactly
   that) — legal copy, changed only with the owner's sign-off.

3. **Guideline 4 — "crowded, laid out, or displayed in a way that made it
   difficult to use" on iPad.** iPadOS windows the iPhone app at widths the
   layout's `lg:` seam read as "desktop" while UIKit still owned the chrome:
   unrendered rail and footer, a window-wide ADVANCE slab, content under
   floating glass. The seam is now `desk:` — width AND not-a-shell — the
   phone composition is capped and centred at wide sizes, and every floating
   UIKit surface caps at the same 672 the DOM always used
   (`GlassChromeController.pinHorizontally`).

4. **2.3.6 — the Age Rating metadata claims In-App Controls the reviewer
   could not find.** They could not find them because they do not exist —
   the only age mechanism is a deliberate, self-declared 13+ age screen at
   onboarding (`lib/auth/age.ts`), not a parental control. The fix is the
   form, not the code: §6 item 2.

The lesson this file had wrong is recorded in §5: "no iPad build means no
iPad review" is false under current review practice.

---

## 1. The two rejections that were certain, and what replaced them

### 3.1.1 — In-App Purchase

**What it did.** `native/boot.html` sends a first-run cold start to `/welcome`,
whose seventh step is the Pro screen. That screen's CHOOSE PRO button called
`goToCheckout()`, which sets `location.href` to a Stripe Checkout URL. An iOS
app that sells a subscription for digital content through Stripe is the single
most reliably rejected thing an app can ship, and Guideline 3.1.3(a) closes the
obvious escape hatch: the app may not carry buttons, links or calls to action
pointing at any purchase mechanism outside the app either, so "buy it on our
website" is not the fix.

**What it does now.** `lib/commerce.ts` holds one rule — *a store build sells
nothing* — and every pricing surface is gated on it:

| Surface | Browser | iPhone / Android app |
|---|---|---|
| `/welcome` plans step | plan chips, CHOOSE PRO, renewal disclosure | what Pro contains, no price, START PLAYING |
| Chapter licences and one-time buys | price list | withdrawn |
| `ProSheet` (in-game) | plan chips, CHOOSE PRO, renewal disclosure | comparison table, no price |
| Restore purchases | yes | yes |
| Manage subscription | Stripe portal | states where the subscription lives |

Pro attaches to a Novus account rather than to a device, so a subscription
bought in a browser reaches the phone the moment that account signs in. That is
what keeps the removal of the buttons from being a dead end, and it is why
Restore is load-bearing here rather than ceremonial — it is the **only** way Pro
can appear on a phone.

The gate is a hook (`useSellsHere()`) rather than a plain call because the
prerendered HTML is built on a machine where Capacitor reports "web", so
anything read during render would paint one frame of a price inside the App
Store build. It answers `null` until the shell is known and every caller
renders nothing rather than the wrong thing.

**The interlude this table survived** (superseded, recorded so it is not
retried): after the April 2025 *Epic v. Apple* injunction, store builds
carried a GET PRO link-out with both plan prices, on the premise that
`Browser.open` "genuinely leaves" the app. It does not — on iOS it is
SFSafariViewController, a sheet inside the app — and build 1.0(3) was
rejected under 3.1.1 for exactly that (§0). The link, the prices and the
premise are gone; `lib/commerce.ts`'s header carries the full account. If Pro
is ever to be sold in-app, the path is §7 (StoreKit 2), not a link.

Android is gated with iOS. Google Play's Payments policy says the same thing
about Play Billing; if that ever changes, `STOREFRONTS` in `lib/commerce.ts` is
the one place to change it.

### 2.1 — a demo switch in a shipping build

`ProSheet` shipped a button reading **SIMULATE PRO**, which flipped `run.pro` on
and off with no payment involved. That is placeholder/test functionality
(Guideline 2.1) and a hidden mechanism handing out the paid tier (2.3.1) — and,
in a product whose whole pricing argument is that nothing purchasable changes an
outcome, plainly a cheat button. It is gone. The sheet now shows the real state
of the account, restores real purchases, and on the web opens real checkout.

---

## 2. 5.1.1(v) — account deletion, in the app

Required for any app that supports accounts, and it must be reachable **in the
app**: not by email, not on a website.

Deletion existed in `AccountGate`, on the landing page — a route the shipped app
never opens. In the app it therefore did not exist at all. It now lives in
**Settings › ACCOUNT › Delete my account**, behind one confirmation, and calls
the same `/api/auth/delete` route: the email, the progress and every company go,
on the server and on the device, immediately and for real.

The same section carries **sign in**, **sign out**, and the signed-in address.
Sign-*up* is deliberately not there. The original reason — Turnstile is not
loadable from the `capacitor://` origin — dissolved when the shell went
remote (the app's pages are served from `https://www.novuspitch.com` now, an
origin Turnstile is happy on), but the line stays drawn for the moment as a
product decision: the free game needs no account at all, and in-app account
creation for a product whose accounts belong to minors deserves its own
deliberate pass, not a side effect of a shell change. It is now an unlocked
follow-up rather than a technical impossibility.

---

## 3. 5.1.1 and 3.1.2 — the legal links

Both documents are now reachable from inside the app, and both exist as public
URLs for the App Store Connect form:

- **Privacy policy** — `/privacy`, and Settings › ABOUT NOVUS.
- **Terms of use (EULA)** — `/terms`, Settings › ABOUT NOVUS, and beside every
  subscription offer.

They render from one source, `lib/legal/documents.tsx`, so the version a
reviewer reads on the listing is the version the app shows. In the app they open
as a sheet rather than a route on purpose: the shipped iOS app draws its tab bar
and advance button as UIKit views composited **above** the webview, so
navigating the webview to `/privacy` would leave a game's chrome sitting on top
of a policy.

The terms are custom rather than Apple's standard EULA, because Pro is not sold
through the App Store and Apple's text describes a product that is. A custom
EULA has to carry Apple's minimum terms — Apple is not a party, has no support
obligation, and is a third-party beneficiary — and those are the last section of
`/terms`, in the order Schedule 1 asks for them.

Support is in the same block: **Contact support** opens a mail composer to the
address on the listing's support page. Reviewers do write to it.

---

## 4. 3.1.2 — subscription disclosure

Wherever a subscription can be started, the screen states the title, the length,
the price per period, that it renews automatically until cancelled, and where to
cancel — with Terms and Privacy next to it. That is the onboarding plans step,
the in-game `ProSheet`, and the landing page's pricing card.

---

## 5. What the code already had right

- **Camera and microphone.** `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription` say what is recorded and what happens to it.
  Both are asked for at the moment of use, denial is handled
  (`PerformScreen` reads `NotAllowedError` and offers the typed path), and the
  game is completable without either.
- **Speech recognition.** `lib/ai/transcribe.ts` reaches for the Web Speech API
  for live transcription, and inside a WKWebView that is `SFSpeechRecognizer`
  under a browser API's name — a TCC-protected resource that needs
  `NSSpeechRecognitionUsageDescription` or the request is refused before a
  prompt is ever shown. That string is now declared, and unlike the camera and
  microphone ones it does **not** say "stays on your device": the recogniser on
  that path is Apple's and may send audio to Apple. Refusal is survivable —
  the server endpoint and the typed path both remain.
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is declared false, so
  the question is answered once rather than on every upload.
- **Orientation and device family.** iPhone-only, portrait-only, and the layout
  is built for it. ~~No iPad build means no iPad review.~~ **Superseded by the
  1.0(3) review** (§0): Apple reviewed the iPhone binary on an iPad Air in
  iPadOS's iPhone-app window and rejected the layout it found there. The app
  must render sanely at any window size the shell can be handed — which is
  what the `desk:` variant and the 672-point chrome caps now guarantee — and
  iPad-width belongs in every future manual audit (`npm run audit:phone` has
  the sizes).
- **No tracking.** No advertising SDK, no analytics, no social pixel — so no App
  Tracking Transparency prompt is required, and the privacy nutrition label is
  short (see below).
- **Launch.** A launch storyboard, a real app icon, and a splash held until the
  first frame of the game rather than dismissed on a timer.
- `LSApplicationCategoryType` now declares simulation games, matching the
  category the listing should select.
- **Privacy manifest.** `ios/App/App/PrivacyInfo.xcprivacy` declares the three
  data types the app collects, `NSPrivacyTracking = false`, and the one
  required-reason API in play (`UserDefaults`, reason `CA92.1`, which is
  Capacitor's own bookkeeping). Without it the upload draws an **ITMS-91053
  "Missing API declaration"** email after the build has already processed —
  which is the worst moment to find out a file is missing. It must keep
  agreeing with the nutrition label below; the two are the same facts entered
  twice, months apart, which is exactly how they drift.

---

## 6. What is still a form, not code

These cannot be done from the repository. Fill them in before submitting.

1. **Privacy nutrition label.** Must match `PrivacyInfo.xcprivacy` exactly —
   a disagreement between the two is a question in review rather than an error
   at upload. Declare:
   - *Contact Info → Email Address* — linked to the user, for app functionality
     (account management).
   - *User Content → Other User Content* — game progress, linked, for app
     functionality.
   - *User Content → Audio Data* — **not** linked, for app functionality. This
     one is easy to talk yourself out of, because the pitch recording is
     transcribed and never stored. It still *leaves the device* whenever
     `/api/stt` has a key behind it (see the privacy note in
     `lib/ai/transcribe.ts`), and omitting a transmission on the grounds that
     retention is short reads as an omission rather than a fine distinction.
     **Video is deliberately not declared** — it genuinely never leaves the
     device; the delivery coach reads frames in memory and keeps only means and
     variances.

   Purchases are handled by Stripe on the web and are **not** collected by the
   app. Answer **No** to tracking, on every data type.
2. **Age rating.** 12+ is the honest answer for simulated gambling-free business
   content with no violence; the app is used by minors and the terms say 13+, so
   do not rate it 4+ — a 4+ rating puts the app in scope for the Kids Category
   rules it is not built for.

   **The questionnaire's capability questions (learned from the 2.3.6
   rejection of 1.0(3), §0):** answer **In-App Controls: None** and **Age
   Assurance: None**. The app has no parental controls, no guardian
   dashboard, no content restrictions and no age *verification* — the one
   age mechanism is `lib/auth/age.ts`, a self-declared 13+ age **screen**
   shown once at onboarding, whose own header says it is not verification,
   and whose answer deliberately never reaches a server
   (docs/LEADERBOARD.md §9.4). Claiming more than that in the form is what
   drew the rejection: a reviewer past onboarding goes looking for a
   control and correctly finds none. Do not "fix" this by building
   server-side age assurance — collecting a minor's age server-side is the
   thing the COPPA posture exists to avoid.
3. **Support URL** and **Marketing URL** — `novuspitch.com` and the support page
   behind the same address as `SUPPORT_EMAIL` in `lib/app-info.ts`.
4. **Privacy Policy URL** — `https://novuspitch.com/privacy`.
5. **Licence Agreement** — paste `https://novuspitch.com/terms`, or the text
   itself, in place of Apple's standard EULA.
6. **App Review notes.** Say four things, because a reviewer will otherwise
   look for a paywall and not find one, and will notice the app loads its
   content over the network:
   > Novus is free. Nothing is sold inside the app — the optional Pro
   > subscription is bought on the web and attaches to a Novus account, so it
   > appears in the app when that account signs in (Settings › Account › Sign
   > in, then Novus Pro › Restore purchases). The whole game is playable
   > without an account. The year-end pitch uses the camera, the microphone
   > and speech recognition to transcribe what is said; all three are optional
   > and the pitch can be typed instead. Video never leaves the device.
   > The app loads its interface from our own site (novuspitch.com); the tab
   > bar, advance control, decision sheets, widgets and Live Activities are
   > native UIKit/SwiftUI.
7. **A demo account** with Pro on it, in the review notes, if you want the Pro
   surfaces exercised.
8. **Version.** `MARKETING_VERSION` in the Xcode project, `versionName` in
   `android/app/build.gradle` and `APP_VERSION` in `lib/app-info.ts` all say
   1.0. Move all three together — Settings prints the third one. (The bumps
   to build (2) and (3) were made on the build machine and never committed —
   commit the next one, so the repo can say what shipped.)
9. **Before resubmitting over the 2.1(a) sign-in rejection**, two checks
   outside the repo (docs/OAUTH-SETUP.md §4 has the walkthrough): in the
   Supabase dashboard the Apple provider must be enabled with Client IDs
   containing **both** `com.novuspitch.web` (the Services ID) **and**
   `com.novuspitch.app` — the native token's audience is the *bundle id*,
   and a list without it 401s every in-app sign-in; and the client secret
   should be the auto-renewed .p8 flow, not a pasted six-month JWT nearing
   expiry. Then run the §7 checks of that doc on a physical iPhone *and* an
   iPad before submitting.
10. **Deploy order for the remote shell.** The binary loads
    `https://www.novuspitch.com/boot.html` at launch
    (capacitor.config.ts). Deploy the web build that carries
    `public/boot.html` and the gated pricing surfaces **before** submitting
    a binary for review — a reviewer meets the site as it is on review day,
    not as it was when the binary was built. That is the entire point of the
    remote shell (web fixes need no resubmission), and it cuts both ways.

---

## 7. If Pro should one day be sold inside the app

The honest path is StoreKit 2, not a webview. The shape:

1. Auto-renewable subscription products in App Store Connect, with ids mirroring
   `ProPlanId` in `lib/monetization.ts`.
2. A Swift Capacitor plugin beside `NovusGlassPlugin.swift` wrapping
   `Product.products(for:)`, `product.purchase()` and `Transaction.updates`.
3. Server-side receipt validation into the same `entitlements` row the Stripe
   webhook already writes, so the rest of the app cannot tell the two apart.
4. `sellsHere()` becomes "this platform has a purchase mechanism" rather than
   "this is a browser", and the pricing surfaces read their prices from
   StoreKit — App Review checks that the price shown matches the product.

Until then, `lib/commerce.ts` is the whole story and it is one file.
