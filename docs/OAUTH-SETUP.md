# Sign in with Google and Apple

Everything outside the code: the two developer consoles, the Supabase panel,
the environment variables, and what to check before believing any of it works.

`docs/ACCOUNTS-SETUP.md` is still the document for email and password accounts.
This one is additive — nothing here changes how those work, and turning all of
it off leaves the app exactly as it was.

---

## 0. Read this before you start

**This is the one feature in Novus that contacts a third party from a page a
minor is looking at.** The rest of the app is arranged specifically so it never
has to: Supabase and Stripe are both reached through our own origin, the anon
key lives in a server module, and `docs/LEADERBOARD.md` §1.4 and §9.6 rule out
third-party scripts on these pages. Pressing "Continue with Google" sends a
child's browser to `accounts.google.com`, and Google learns that they use Novus.

That is a product decision, not a technical one, and it is why the whole feature
is **off by default**: with `NEXT_PUBLIC_OAUTH_PROVIDERS` unset, no button
renders, no route is reachable in a way that matters, and nothing is contacted.
Turning it on is a decision to take knowingly. Two things are worth weighing:

- **Apple is much the cheaper of the two.** Sign in with Apple does not build a
  cross-site profile, and *Hide My Email* means a player can make an account
  here without giving us — or Apple — a real address to correlate on. Enabling
  Apple alone is a coherent position.
- **On iOS the two are linked.** App Store Review Guideline 4.8 requires an app
  offering a third-party login to also offer an equivalent privacy-preserving
  one. Sign in with Apple is the ordinary way to satisfy it. So the shipped iOS
  app may offer Apple alone, or both — never Google alone.

There is no equivalent Play Store rule, so Android may ship Google alone.

---

## 1. Environment variables

```sh
# Which buttons the web front door shows. Unset = neither = nothing changes.
NEXT_PUBLIC_OAUTH_PROVIDERS=google,apple

# ── The shipped app only. Ignored by the web build. ────────────────────────
NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID=000000-xxxx.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID=000000-yyyy.apps.googleusercontent.com
NEXT_PUBLIC_APPLE_SERVICES_ID=com.novuspitch.web
NEXT_PUBLIC_APPLE_REDIRECT_URL=https://<project-ref>.supabase.co/auth/v1/callback

# ── Optional. ─────────────────────────────────────────────────────────────
# Pin the origin the provider returns to. Normally unnecessary: the start route
# derives it from the request, which is what makes localhost and preview
# deploys work without a second Supabase project. Set it only if you are behind
# something that rewrites Host in a way you cannot control.
OAUTH_REDIRECT_ORIGIN=https://www.novuspitch.com
```

Every `NEXT_PUBLIC_` value here is public by nature — a client id is in the
first request the consent screen makes. **No secret belongs in this list.** The
Google client secret and the Apple `.p8` go into the Supabase dashboard and
nowhere else.

`NEXT_PUBLIC_*` is read at build time, so a change means a rebuild and, for the
app, a `npm run build:native`.

---

## 2. Supabase → URL Configuration

**Authentication → URL Configuration → Redirect URLs.** Add one entry per
origin the app is served from:

```
https://www.novuspitch.com/api/auth/oauth/callback
https://novuspitch.com/api/auth/oauth/callback
http://localhost:3000/api/auth/oauth/callback
```

A missing entry does not fail loudly — GoTrue redirects to the project's **Site
URL** instead, so the player lands on the marketing page and the sign-in appears
to have done nothing. That is the same trap `components/AuthHashRelay.tsx` was
written for, and it is worth checking twice.

---

## 3. Google

### 3.0 Where these pages are now

Google has split the old two-page setup into a section called **Google Auth
Platform** (`console.cloud.google.com/auth`), and every tutorial written before
that — including the first draft of this one — names pages that no longer
exist. The mapping, once:

| What older guides call it | Where it is now |
|---|---|
| OAuth consent screen → app name, support email | **Branding** (品牌塑造) |
| OAuth consent screen → user type, test users, Publish | **Audience** (目标对象) |
| OAuth consent screen → Scopes | **Data Access** (数据访问) |
| APIs & Services → Credentials → OAuth client ID | **Clients** (客户端) |

The fields and the values are unchanged; only the menu moved.

### 3.1 The consent screen

1. `console.cloud.google.com` → create or pick a project.
2. **Google Auth Platform → Branding.** App name, user support email,
   developer contact email. The app name is what the consent screen says to
   the player, so make it "Novus", not the project id.
3. **Audience** → user type **External**.
4. **Data Access** → add scopes: `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile`. Nothing else. Every extra scope is something
   you have to justify at verification and something a parent has to read on
   the consent screen.
5. While **Audience** says **Testing**, only listed test users can sign in.
   Publish there before launch; with only those three scopes it stays out of
   the review queue that sensitive scopes trigger.

### 3.2 The web client — this is the one Supabase needs

**Clients → Create client → Web application.**

| Field | Value |
|---|---|
| Authorized JavaScript origins | `https://www.novuspitch.com` (and `http://localhost:3000`) |
| Authorized redirect URIs | `https://<project-ref>.supabase.co/auth/v1/callback` |

The redirect URI is **Supabase's**, not ours. The browser goes Google →
Supabase → our `/api/auth/oauth/callback`, and Google only ever needs to know
about the first hop.

Copy the **Client ID** and **Client secret** into
**Supabase → Authentication → Sign In / Providers → Google**, and enable it.

### 3.3 The two native clients

Only needed if you ship the app.

- **iOS:** Clients → Create client → **iOS** → bundle ID
  `com.novuspitch.app`. This id goes in `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
- **Android:** Clients → Create client → **Android** → package name
  `com.novuspitch.app` plus the signing certificate's SHA-1. Debug builds and
  Play-signed builds have **different** SHA-1s, so register both:

  ```sh
  # debug
  keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey \
          -storepass android -keypass android
  # release: Play Console → Setup → App integrity → App signing key certificate
  ```

Then, back in Supabase's Google provider, put both native client ids in
**Authorized Client IDs** (comma-separated).

> **This field is the one people miss.** A token minted by the native SDK has
> the *native* client id in its `aud`, not the web one — so without this entry
> every sign-in from the app is rejected as an invalid audience while the same
> code works perfectly in a browser. `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` is
> still the **web** id: Android's Credential Manager takes it as the
> `serverClientId` and mints a token whose audience is that web id.

---

## 4. Apple

Needs a paid Apple Developer Program membership. If you are already shipping
`ios/`, you have one.

### 4.1 App ID

**Certificates, Identifiers & Profiles → Identifiers →** your App ID
(`com.novuspitch.app`) → tick **Sign in with Apple** → Save.

### 4.2 Services ID — the web half

**Identifiers → + → Services IDs.** Description "Novus Web", identifier
something like `com.novuspitch.web`. It must NOT equal the bundle id.

Enable **Sign in with Apple** → **Configure**:

| Field | Value |
|---|---|
| Primary App ID | `com.novuspitch.app` |
| Domains and Subdomains | `<project-ref>.supabase.co` |
| Return URLs | `https://<project-ref>.supabase.co/auth/v1/callback` |

Apple will not accept `localhost` here. Local testing of the *web* Apple flow
therefore needs a tunnel, or you test Apple on a deploy and Google locally.

### 4.3 The key

**Keys → + →** tick **Sign in with Apple** → Configure → primary App ID →
Register → **Download the `.p8`**.

**It downloads once.** There is no second chance and no way to re-read it from
the portal. Put it somewhere your team will still have it in a year.

Note the **Key ID** (on the key page) and your **Team ID** (top right of the
portal).

### 4.4 Supabase → Providers → Apple

Enable it, then:

- **Client IDs** — a comma-separated list, and it needs **both**:
  ```
  com.novuspitch.web,com.novuspitch.app
  ```
  The Services ID for the web redirect flow, the **bundle id** for tokens the
  app mints natively. Same trap as Google's Authorized Client IDs, same symptom
  if you leave the second one out.
- **Secret Key (for OAuth)** — Team ID, Key ID and the `.p8` contents. Some
  dashboard versions take those three fields and sign the client secret for
  you; older ones want a pre-signed JWT, and the provider panel links Supabase's
  generator for that case.

> **Apple client secrets expire — six months, maximum, by Apple's rule.** If
> Supabase signs it from your key it renews itself. If you pasted a JWT, put a
> calendar reminder at five months now: the failure mode is every Apple sign-in
> breaking at once, on a date nobody wrote down.

### 4.5 Xcode

Target → **Signing & Capabilities → + Capability → Sign in with Apple**. Without
it the system sheet does not appear and the plugin call fails.

---

## 5. The app (Capacitor)

The web flow cannot be used inside the app. `Browser.open` is a real Safari
view with Safari's cookie jar — so the session the callback sets lands in a
browser the webview cannot read, and the player returns exactly as signed out as
they left. The app uses the native sheets instead and posts the resulting token
to `/api/auth/oauth/native`.

```sh
npm i @capgo/capacitor-social-login
npx cap sync
```

`lib/cloud/native-oauth.ts` reaches the plugin through Capacitor's
`registerPlugin("SocialLogin")` rather than importing the package, so:

- the **web** build never pulls it in;
- a checkout without it still builds;
- an app built before you added it simply does not show the buttons, instead of
  crashing.

Android also needs the SHA-1s from §3.3 registered, or the Google sheet closes
immediately with no error a user can act on.

### On the nonce

`lib/cloud/native-oauth.ts` deliberately sends **no nonce**, and
`/api/auth/oauth/native` accepts one only if a caller supplies it. Apple's
convention is that the app puts a SHA-256 of a random value in the request and
the verifier receives the raw value — and whether a given plugin version hashes
it for you or passes it through is exactly the kind of thing that is wrong in
one direction or the other and fails identically either way. Supabase skips the
check when the nonce is absent; the signature and audience checks, which are
what decide whether the token is real, are unaffected. If you verify on a device
which convention the plugin follows, wiring it back on is two lines.

---

## 6. Account linking — test this, do not assume it

The case that matters: somebody signs up with `sam@gmail.com` and a password,
then months later presses **Continue with Google** with the same address.

Supabase links identities on a **confirmed** email address, and this project
runs with *Confirm email* **OFF** (`docs/ACCOUNTS-SETUP.md` §2), which normally
means addresses are confirmed on creation and linking happens. "Normally" is not
"verified on your project", and getting it wrong means one person with two
accounts, two sets of companies, and a Pro subscription on whichever one they
are not currently signed in to.

So check it, once, on a throwaway address:

1. Sign up with email + password.
2. Sign out, then Continue with Google on the same address.
3. In the dashboard, **Authentication → Users**: one row, or two?
4. One row with two identities is right. Two rows means linking is off — decide
   deliberately what to do about it before launch, because after launch it is a
   support problem with real data behind it.

---

## 7. What to check before believing it works

| # | Check | Right answer |
|---|---|---|
| 1 | Buttons with `NEXT_PUBLIC_OAUTH_PROVIDERS` unset | None render |
| 2 | First Google sign-in, new address | Lands on `/auth/callback`, asks for a name, privacy box unticked |
| 3 | Name typed, box ticked, START PLAYING | Lands in the game; `profiles.display_name` is the typed name, `accepted_privacy_at` is set |
| 4 | Sign out, sign in again with the same Google account | No name screen. Straight in |
| 5 | Sign-in on a device with another player's save in localStorage | localStorage emptied, that account's own companies pulled |
| 6 | First-ever sign-up on a device with a half-built company | Company **kept** and pushed into the new account |
| 7 | Press Continue with Google, then cancel on Google's screen | Back on the front door, no error text, nothing changed |
| 8 | Open `/auth/callback?state=known` by hand, signed out | "That sign-in did not complete", no crash |
| 9 | Apple, second sign-in ever | Works, and the name stays what the player chose |

5 and 6 are the pair worth being slow about. They are opposite treatments of the
same localStorage, chosen from one bit the server sends back
(`lib/auth/oauth-profile.ts`), and getting them backwards is not a cosmetic bug:
one way a stranger's save is pushed over a returning player's cloud copy, the
other a player watches the company they just made disappear.

---

## 8. What is deliberately not built

- **Unlinking a provider.** Once Google is on an account it stays. Removing an
  identity from an account that may have no password set is a way to lock
  somebody out of a paid subscription.
- **Apple on Android.** Possible — Apple has a web flow — but it needs the
  Services ID and return URL from §4.2 pointed at the app, and it has not been
  tested here. `availableProviders()` offers Apple on Android only when
  `NEXT_PUBLIC_APPLE_SERVICES_ID` and `NEXT_PUBLIC_APPLE_REDIRECT_URL` are both
  set, so it stays hidden until somebody has actually run it.
- **The web redirect flow as an in-app fallback.** Not a gap: it would put the
  session in Safari's cookie jar where the webview cannot reach it, which is a
  silent failure rather than a missing feature.
- **A provider button on the signed-in front door.** Somebody already signed in
  does not need a second way in.
