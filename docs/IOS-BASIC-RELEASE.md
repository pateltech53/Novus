# iOS basic edition and StoreKit follow-up

Decision: September 19, 2026. Responds to review submission
`871d2d5f-14cc-4457-9d18-4013cd49281c`, version 1.0 (26.9.16).
This document supersedes older iOS Pro/Restore guidance in APP-STORE.md.

## Shipping behavior

The iOS app provides four basic industries, two active companies, one new
company per day and one fiscal-year close per day. The ordinary gameplay,
year-end pitch and leaderboard remain available. It offers no personal Pro
purchase, external purchase link, Pro restore button or paid-content unlock.
This applies to all iOS users, including existing subscribers and chapter seats;
it is not a reviewer/account-specific switch. Browser purchases remain unchanged.

The edition policy is in `lib/native/edition.ts`. Raw entitlements remain intact;
the gameplay accessors project basic limits. Native checkout and customer-portal
entry points return before any request or redirect, including pending purchases
resumed after login and operator checkout prompts.

Stored companies with Pro, a paid industry, a paid asset or a paid-pool hire are
preserved but cannot be played on iOS. The first two supported active companies
(ordered by storage slot) remain playable. Extra companies remain in the library.
Unsupported saves and pending decision tables are protected from game writes.
Existing subscription and cancellation help is available via support, without a
purchase invitation. Installing the app does not cancel a subscription.

**Existing subscriber impact:** all existing active companies count toward the
two-company creation limit. An account already holding two or more active Pro
companies cannot create another company in this edition, and cannot play those
Pro companies here. Its web access and original saves remain intact. Support
must be prepared to handle these accounts and subscription/refund requests;
do not tell customers to delete paid progress just to use the iOS app.

## Validation

Passed locally: `npm run check`, `npm run build` (including route budgets),
`npm run build:native:only`, and the focused browser regression below:

```sh
npm run start -- --port 4103
# Separate terminal; omit EDITION_TEST_CHANNEL when Playwright Chromium is installed.
EDITION_TEST_CHANNEL=chrome node scripts/ios-edition-ui.mjs
```

The browser test mocks all APIs and simulates Capacitor's iOS platform. It checks
basic industries, the edition dialog, settings, legal/product routes, protected
save navigation, preserved entitlements and no checkout/portal requests. It is
not an Xcode archive, a real StoreKit transaction, a real-account cloud test or
an iPhone device test. The broad `audit:phone` assertions were updated but that
full visual suite was not run for this change.

## Release procedure

1. Review and merge the release changes, then deploy the web application. The
   Capacitor shell loads `https://www.novuspitch.com/`; uploading a binary alone
   does not deploy these changes. The deployed edition policy also affects older
   iOS shells using that origin.
2. Inspect the public terms and App Store metadata together. Remove claims that
   web Pro arrives on iOS, paid-industry screenshots and external purchase CTAs.
   Use the actual basic-edition limits in the description. Keep privacy,
   subscription support, cancellation and refund disclosures accurate.
3. Run `npm run check`, `npm run build`, then `npm run build:native` to sync the
   remote-shell configuration. Use Xcode to archive the **App** target with
   marketing version 1.0 and a unique build number greater than 26.9.16; set the
   same build number for the app and widget extension. The repo's default build
   number is 1, so it must be set before uploading (26.9.19 is a candidate only
   if it has not already been used).
4. Install the resulting TestFlight build and test on a real iPhone: fresh
   account onboarding, sign-in, founding in each basic industry, a year-end
   pitch, the daily limit, account deletion, privacy/terms and offline handling.
   Also test a real existing subscriber, a full paid library and a paid save at
   an open decision. Verify the web still has its subscription and unchanged
   saved progress afterward. Browser platform emulation cannot replace this.
5. Provide Apple an active, email-verified basic demo account and clear paths to
   the gameplay. Select the new build, update Review Notes and resubmit. Do not
   claim a local code change has already been deployed or approved.

## Suggested App Review reply (after deployment and device verification)

> Thank you for the review. We have changed the iOS version to a free basic
> edition. It no longer offers Pro purchases, external payment links or
> calls to action to purchase elsewhere. Paid Pro content and additional
> purchased allowances are not accessible in this iOS edition, including
> when signing in with an existing web subscriber account.
>
> The basic gameplay, year-end pitch and leaderboard are available without a
> paid subscription. Existing subscription records and saved companies are
> preserved, but companies requiring unavailable content or additional slots
> cannot be played in this edition. The app provides account support and
> explains that installing it does not cancel an existing subscription.
>
> Please review the newly submitted build using the demo credentials in App
> Review Information. We have updated the app's terms and review information
> to describe the iOS basic edition.

This is a proposed remedy, not a guarantee of approval. Do not add a “pay on
the website” instruction to this worldwide edition. Apple's US storefront and
other regional programs have different rules and require a separate design.

## StoreKit phase two

Owner tasks in App Store Connect:

- Account Holder accepts the Paid Apps Agreement; complete tax and banking
  information and confirm that the agreement is active.
- Create a subscription group, e.g. “Novus Pro”. Add monthly and annual
  auto-renewable products. Candidate permanent product IDs are
  `com.novuspitch.app.pro.monthly` and `com.novuspitch.app.pro.yearly`; check
  existing products before creating them. Put equivalent Pro plans at the same
  subscription level. Configure duration, price, availability, localization,
  descriptions and review screenshots. Existing web prices are $6.99/month and
  $39.99/year; App Store pricing is configured separately.
- Add the In-App Purchase capability to the Xcode target. Prepare sandbox
  testers. Supply review credentials and purchase instructions.
- Once the server endpoints exist, configure App Store Server Notifications V2
  production and sandbox URLs in App Information. If App Store Server API
  authentication is needed, create the In-App Purchase key under Users and
  Access → Integrations → Keys. Keep the private key on the server only.

Engineering work (not implemented in this release):

- A Capacitor Swift bridge using StoreKit 2 product loading and purchase. Show
  Apple's localized price, handle cancellation/pending purchases and verify
  transactions before granting access. Observe transaction updates and finish
  transactions once fulfillment is durable.
- Verify signed Apple transaction data on the backend; bind purchases to the
  authenticated Novus account using an appAccountToken, and handle renewals,
  expiration, refunds, revocation and billing retry idempotently. Do not trust
  a client-supplied “pro=true” or overwrite a valid Stripe entitlement when an
  Apple subscription expires.
- Add real Restore Purchases and App Store subscription management. Existing
  web subscribers should not be encouraged to buy a duplicate subscription.
- Test StoreKit configuration, sandbox and TestFlight, including account
  switching, reinstall/restore, interrupted purchases and notification replay.
- Submit the first IAP/subscriptions together with the app version enabling
  them. Remove the basic-edition restriction only in that implemented release.

Official references, checked September 19, 2026:

- [App Review Guidelines 3.1.1 and 3.1.3](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)
- [Configure In-App Purchases](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/)
- [Offer auto-renewable subscriptions](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/)
- [Submit an In-App Purchase](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase)
