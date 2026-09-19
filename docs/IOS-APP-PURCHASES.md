# iOS account access without in-app checkout

Updated September 19, 2026 to match the owner's clarified requirement:
**existing Pro users can play normally in the app; only payment is unavailable.**
This replaces the earlier basic-edition proposal in PR #127. No production
rollout of that proposal was performed.

## Behavior

- Keep the existing account entitlement model on iOS: Pro industries, content,
  extra company slots, chapter access and paid saves work normally. Do not
  rewrite or downgrade account entitlements or mark saved companies unavailable.
- Free accounts retain their ordinary free limits. Signing in as a subscriber
  unlocks the account's existing benefits through the usual sync flow.
- Native checkout and billing-portal entry points return before a request or
  redirect, including pending purchases after sign-in and operator checkout.
  Local fallback grants cannot create a purchase in a native app.
- iOS purchase/plan surfaces explain that purchases are unavailable, show the
  current account's actual benefits, and provide **Refresh account access**.
  This reads the existing Novus entitlement API; it is not Apple StoreKit restore.
- No iOS price picker, external payment link or instruction to buy on the web.
  Existing subscription support remains available. Installing the app does not
  change or cancel billing. Browser checkout is unchanged.

## App Review remains unresolved

Apple's September 18 rejection (submission
`871d2d5f-14cc-4457-9d18-4013cd49281c`, build 1.0/26.9.16) specifically cites
3.1.1 and 3.1.3(b). The published multiplatform rule generally requires paid
content used in an app to also be available through IAP. Removing checkout
alone does not establish an exception for this game. Reader apps, qualifying
web-tool companions and regional programs have different requirements; this
implementation does not claim Novus qualifies for them.

This PR implements the requested product behavior. **It is not a confirmed
App Review remedy and must not be described as removing paid content.**
Do not claim StoreKit is implemented or promise approval. Before resubmission,
seek clarification from App Review about this exact model and intended
storefronts, or implement the StoreKit phase below. No message has been sent
and no App Store Connect metadata has been changed by this work.

Suggested clarification message (owner to review and send):

> Thank you for clarifying the 3.1.1 issue. Our intended iOS behavior is to
> disable all purchases and external purchase links in the app, while allowing
> users with an existing Novus Pro account to sign in and continue using their
> existing benefits and saved companies. Free accounts keep the free gameplay.
> The app will not instruct users to purchase on our website.
>
> We understand that your feedback references 3.1.3(b). Can you confirm whether
> this model is eligible for any applicable exception in our intended
> storefronts, or whether Pro must also be offered through In-App Purchase?
> We want to resolve the requirement without removing existing customers'
> access. The proposed code has not yet been submitted in a new reviewed build.

## Verification and release

Run `npm run check`, `npm run build` and `npm run build:native:only`.
For the focused UI regression, run the production server on port 4103 and then:

```sh
EDITION_TEST_CHANNEL=chrome node scripts/ios-edition-ui.mjs
```

Omit the channel variable if Playwright Chromium is installed. APIs are mocked;
the test emulates iOS and verifies Pro industries, a third paid company, new
Pro-company registration, extra slots, account refresh, subscription settings
and no checkout/portal requests.
It does not validate a real iPhone or live-account cloud sync.

The Capacitor shell loads `https://www.novuspitch.com/`, so deployment changes
existing iOS shells too. After the review path is decided, deploy the web code,
archive a new unique build greater than 26.9.16 (same number for App and Widget),
and validate on TestFlight with both a free and existing paid account. Test
paid industries, more than two active companies, new-company creation, saving,
account refresh, sign-out/sign-in and browser access afterward. Update review
notes accurately and provide working demo accounts for both access levels.
No production deployment, Xcode archive or App Store resubmission is included.

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
  them. Enable in-app purchasing only in that implemented release.

Official references, checked September 19, 2026:

- [App Review Guidelines 3.1.1 and 3.1.3](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)
- [Configure In-App Purchases](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/)
- [Offer auto-renewable subscriptions](https://developer.apple.com/help/app-store-connect/manage-subscriptions/offer-auto-renewable-subscriptions/)
- [Submit an In-App Purchase](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase)
