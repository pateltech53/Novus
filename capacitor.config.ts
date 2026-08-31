import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * Novus as a shipped app.
 *
 * The web build and the app build are the same code. What changes is the
 * chrome: on iOS the tab bar, the advance button and the masthead controls are
 * withdrawn from the DOM and re-drawn by UIKit, so they are real Liquid Glass
 * rather than a CSS impression of it. See ios/App/App/Native/ and
 * lib/native/chrome.ts for the two halves of that handoff. None of it depends
 * on where the page came from — the whole handoff is plugin traffic over the
 * injected bridge, which Capacitor injects into every document served from
 * `server.url` exactly as it did into the bundled ones.
 *
 * ── The shell is remote now, and that is the point ──────────────────────────
 *
 * This file used to say the opposite: `webDir: "out"` bundled the whole
 * static export so nothing loaded over the network at boot. What that bought
 * (offline play, a cold start with no network on its critical path) it paid
 * for in release mechanics: every web change — a copy fix, a balance patch, a
 * rejected screen — waited on an App Store resubmission. After the 1.0(3)
 * rejection that trade was reversed, deliberately: the app now loads
 * https://www.novuspitch.com live, so a deploy IS the release. Serving the
 * same first-party origin the API lives on keeps every request same-origin —
 * the CSP's `connect-src 'self'`, the CSRF guard's Sec-Fetch-Site check and
 * the session cookie all pass without a carve-out.
 *
 * What was given up is written down, not wished away (docs/APP.md has the
 * long form): the game no longer plays offline — `server.errorPath` shows
 * native/shell/index.html when the network cannot produce a page — and a cold
 * start is network-bound, softened by the splash holding until first paint.
 * Old TestFlight builds served `capacitor://app.novuspitch.com` from disk;
 * that origin's localStorage is unreachable from the new one, accepted while
 * the app is pre-release with nothing shipped.
 *
 * Capacitor's reference frames `server.url` as a live-reload tool; it is also
 * the supported way to point the shell at a production origin, and Apple's
 * 2.5.2 permits WebKit-executed web content. The App Review posture for a
 * remote shell (what keeps this out of 4.2 thin-wrapper territory is the
 * UIKit chrome, widgets and Live Activities) is in docs/APP-STORE.md.
 */
const config: CapacitorConfig = {
  appId: "com.novuspitch.app",
  appName: "Novus",
  // The offline/error notice plus nothing else — see native/shell/. The
  // export in out/ still exists for the Playwright audits, but it does not
  // ship: the app's pages come from server.url below.
  webDir: "native/shell",

  server: {
    /*
     * The trailing slash is load-bearing. iOS decides "stay in the webview or
     * open the system browser" by prefix-matching the navigation URL against
     * this string (WebViewDelegationHandler.swift), and without the slash
     * `https://www.novuspitch.com.evil.example` passes the prefix test. With
     * it, only this origin's own documents stay inside the shell — everything
     * else (Stripe, mailto targets, external links) goes to the real browser.
     *
     * www, not the apex (which 308s — see lib/native/origin.ts) and not a
     * dedicated app subdomain: the same host that answers the API keeps the
     * shell same-origin with everything it calls.
     */
    url: "https://www.novuspitch.com/",
    // https on Android so localStorage, cookies and the camera all live under a
    // secure origin. capacitor:// on iOS for the same reason. Both now only
    // name the LOCAL origin — the one that serves errorPath below and nothing
    // else — but they are what old bundled builds ran at, so the values stay.
    androidScheme: "https",
    iosScheme: "capacitor",
    hostname: "app.novuspitch.com",
    // Appended to server.url on both platforms, so a cold start lands on the
    // boot router rather than the WebGL marketing page: public/boot.html reads
    // two localStorage keys and hands the webview to the right screen in one
    // parse, no framework. (Its bundled ancestor, native/boot.html, needed
    // index.html-suffixed targets for the local file server; the remote one
    // navigates real routes.)
    //
    // No leading slash: Android joins this to the url above by plain string
    // concatenation (Bridge.java), and the url's trailing slash already
    // provides the separator — "/boot.html" would produce a double-slash path
    // the server answers with a redirect. iOS appends it as a path component
    // and is indifferent either way.
    //
    // ⚠ iOS refuses to LAUNCH unless this path also exists as a file in the
    // local webDir — CAPBridgeViewController.loadWebView() existence-checks
    // appStartFileURL (local) before loading appStartServerURL (remote) and
    // exits the process on a miss. native/shell/boot.html exists purely to
    // satisfy that guard; build-native.mjs verifies it was copied.
    appStartPath: "boot.html",
    // What the player sees when the network cannot produce a page: the one
    // document still on the device. Served from the local origin, so it works
    // precisely when the remote origin does not.
    errorPath: "index.html",
  },

  ios: {
    // The webview must not inset its own content: the safe area is handled in
    // CSS, and the native chrome reports its exact height back as a CSS
    // variable. Two things insetting the same content is how a tab bar ends
    // up sitting on top of a button.
    contentInset: "never",
    /*
     * The webview's own scroll view stays on.
     *
     * Turning it off is the usual advice for an app-like shell, and it is
     * wrong here: on a phone the play screen is one scrolling document —
     * masthead, books, then the life log — and disabling the scroll view
     * makes everything below the fold unreachable. Rubber-banding is handled
     * where it belongs, by `overscroll-behavior-y: none` on the body.
     */
    backgroundColor: "#1c1d21",
    limitsNavigationsToAppBoundDomains: false,
    // Never let a long word or a large accessibility setting zoom the layout.
    preferredContentMode: "mobile",
    handleApplicationNotifications: false,
  },

  android: {
    backgroundColor: "#1c1d21",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    SplashScreen: {
      /*
       * Held until the first real frame of the game is on screen — see
       * components/native/NativeShell.tsx, which is still what normally ends
       * it, within about two and a half seconds at the very worst.
       *
       * ── Why there is a backstop under that ────────────────────────────
       *
       * This was `launchAutoHide: false` with nothing else, on the reasoning
       * that auto-hiding on a timer gives a flash of empty background between
       * the splash and the app. True, and it left the launch screen with
       * exactly one way to ever go away: JavaScript running. Anything that
       * stops the bundle from booting — a sync that copied a stale `out/`, a
       * chunk that fails to parse, a plugin that throws before the layout
       * mounts — is then indistinguishable from a hang, because it IS one.
       * The app opens on the launch screen and stays there, with nothing on
       * screen to report what went wrong and no way to reach the console.
       *
       * Six seconds is more than twice the JS path's own ceiling, so in every
       * healthy launch the splash is long gone before this can fire and there
       * is no flash to trade away. It only ever fires on a launch that has
       * already failed — and a visibly broken app you can attach a debugger
       * to beats an infinite launch screen every time.
       */
      launchAutoHide: true,
      launchShowDuration: 6000,
      backgroundColor: "#1c1d21",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: false,
    },
    Keyboard: {
      // Resize the webview, do not scroll the page under the keyboard. Matches
      // `interactiveWidget: "resizes-content"` on the web side.
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "DARK",
      backgroundColor: "#00000000",
    },
    // The session cookie for /api/sync is set by a different origin than the
    // one the app runs on, so it needs the native cookie jar.
    CapacitorCookies: { enabled: true },
    CapacitorHttp: { enabled: false },
  },
};

export default config;
