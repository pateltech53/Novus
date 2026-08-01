# Shipping Novus to the App Store

What the code now does about App Review, what is still a form somebody has to
fill in, and the two rejections this app was previously guaranteed to collect.

Nothing in here is speculative: every guideline number below was checked
against what the build actually does, on the screens the shipped app actually
opens. The app is iPhone-only (`TARGETED_DEVICE_FAMILY = "1"`), portrait-only,
iOS 15 and up.

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

The gate is a hook (`useSellsHere()`) rather than a plain call because the app
ships as a static export: its HTML is prerendered on a machine where Capacitor
reports "web", so anything read during render would paint one frame of a price
inside the App Store build. It answers `null` until the shell is known and every
caller renders nothing rather than the wrong thing.

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
Sign-*up* is deliberately not there: creating an account passes a Cloudflare
Turnstile check, and that widget is not loadable from the `capacitor://` origin
the app runs on. A create form that fails on device is worse than one that was
never offered, and the free game needs no account at all — which is what makes
that an acceptable line to draw. If in-app sign-up is ever wanted, the work is a
Turnstile-free path on `/api/auth/signup` with its own rate limit, not a widget
in a webview.

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
- **Export compliance.** `ITSAppUsesNonExemptEncryption` is declared false, so
  the question is answered once rather than on every upload.
- **Orientation and device family.** iPhone-only, portrait-only, and the layout
  is built for it. No iPad build means no iPad review.
- **No tracking.** No advertising SDK, no analytics, no social pixel — so no App
  Tracking Transparency prompt is required, and the privacy nutrition label is
  short (see below).
- **Launch.** A launch storyboard, a real app icon, and a splash held until the
  first frame of the game rather than dismissed on a timer.
- `LSApplicationCategoryType` now declares simulation games, matching the
  category the listing should select.

---

## 6. What is still a form, not code

These cannot be done from the repository. Fill them in before submitting.

1. **Privacy nutrition label.** Declare: *Contact Info → Email Address* (linked
   to the user, for account management) and *User Content → Other User Content*
   (game progress, linked, for app functionality). Purchases are handled by
   Stripe on the web and are **not** collected by the app. Answer **No** to
   tracking, on every data type.
2. **Age rating.** 12+ is the honest answer for simulated gambling-free business
   content with no violence; the app is used by minors and the terms say 13+, so
   do not rate it 4+ — a 4+ rating puts the app in scope for the Kids Category
   rules it is not built for.
3. **Support URL** and **Marketing URL** — `novuspitch.com` and the support page
   behind the same address as `SUPPORT_EMAIL` in `lib/app-info.ts`.
4. **Privacy Policy URL** — `https://novuspitch.com/privacy`.
5. **Licence Agreement** — paste `https://novuspitch.com/terms`, or the text
   itself, in place of Apple's standard EULA.
6. **App Review notes.** Say three things, because a reviewer will otherwise
   look for a paywall and not find one:
   > Novus is free. Nothing is sold inside the app — the optional Pro
   > subscription is bought on the web and attaches to a Novus account, so it
   > appears in the app when that account signs in (Settings › Account › Sign
   > in, then Novus Pro › Restore purchases). The whole game is playable
   > without an account. The year-end pitch uses the camera and microphone;
   > both are optional and the pitch can be typed instead.
7. **A demo account** with Pro on it, in the review notes, if you want the Pro
   surfaces exercised.
8. **Version.** `MARKETING_VERSION` in the Xcode project, `versionName` in
   `android/app/build.gradle` and `APP_VERSION` in `lib/app-info.ts` all say
   1.0. Move all three together — Settings prints the third one.

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
