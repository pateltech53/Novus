import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

/**
 * Novus as a shipped app.
 *
 * The web build and the app build are the same code. What changes is the
 * chrome: on iOS the tab bar, the advance button and the masthead controls are
 * withdrawn from the DOM and re-drawn by UIKit, so they are real Liquid Glass
 * rather than a CSS impression of it. See ios/App/App/Native/ and
 * lib/native/chrome.ts for the two halves of that handoff.
 *
 * `webDir: "out"` is the static export produced by `npm run build:native`.
 * Nothing is loaded over the network at boot — the whole app is on device,
 * which is what makes a cold start feel like a native launch instead of a page
 * load. The handful of server routes (session, sync, billing) are called at
 * their absolute origin; see lib/native/origin.ts.
 */
const config: CapacitorConfig = {
  appId: "com.novuspitch.app",
  appName: "Novus",
  webDir: "out",

  server: {
    // https on Android so localStorage, cookies and the camera all live under a
    // secure origin. capacitor:// on iOS for the same reason.
    androidScheme: "https",
    iosScheme: "capacitor",
    // The one hostname the bundled app is allowed to treat as itself.
    hostname: "app.novuspitch.com",
    // Not index.html: the landing page is a marketing surface with a WebGL
    // scene on it, and making a cold start pay for that before it can decide
    // which screen the player belongs on is the difference between a launch
    // and a page load. See native/boot.html.
    appStartPath: "/boot.html",
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
