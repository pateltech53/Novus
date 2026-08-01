/**
 * Where the apps live.
 *
 * The Android link is a GitHub redirect that always resolves to the newest
 * release asset with that filename, so the download page never has to be
 * edited when a build ships — the release workflow publishes `novus.apk` and
 * this URL follows it.
 *
 * The two iOS links are environment-driven and deliberately absent by default.
 * An App Store URL cannot be guessed, and a download page whose main button
 * leads to a 404 is worse than one that says the build is not out yet.
 */

const REPO = "pateltech53/Novus";

export const RELEASES_URL = `https://github.com/${REPO}/releases`;

/** Always the newest published APK. */
export const ANDROID_APK_URL = `https://github.com/${REPO}/releases/latest/download/novus.apk`;

/** The Play-ready bundle, for anyone who wants to sideload the same build. */
export const ANDROID_AAB_URL = `https://github.com/${REPO}/releases/latest/download/novus.aab`;

/** Set once the app is live. `NEXT_PUBLIC_IOS_APP_URL=https://apps.apple.com/app/id…` */
export const IOS_APP_URL = process.env.NEXT_PUBLIC_IOS_APP_URL || "";

/** The beta, while it is one. `NEXT_PUBLIC_TESTFLIGHT_URL=https://testflight.apple.com/join/…` */
export const TESTFLIGHT_URL = process.env.NEXT_PUBLIC_TESTFLIGHT_URL || "";

export const IOS_MIN = "iOS 15";
export const ANDROID_MIN = "Android 7.0";
