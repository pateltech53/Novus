/**
 * The handful of facts every store listing, legal page and support surface has
 * to agree on.
 *
 * These were typed by hand in four places — the privacy policy, the landing
 * footer, the chapter-licence mailto and (until this file) nowhere at all for
 * the version string. An address that appears on a legal page and in a Settings
 * row has to be the same address, and App Store Connect asks for the same
 * values again in its own form. One module, so a change is one edit.
 *
 * Kept free of React and of anything platform-specific so a server component
 * (app/privacy) and a client sheet (components/LegalSheet) can both read it.
 */

/**
 * Where a human answers. This is the address on the App Store listing's
 * Support URL page and in the privacy policy, and it is a real inbox: App
 * Review will write to it if anything about the submission is unclear.
 */
export const SUPPORT_EMAIL = "team@novuspitch.com";

export const supportMailto = (subject?: string): string =>
  subject
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
    : `mailto:${SUPPORT_EMAIL}`;

/** The marketing site. Also the App Store listing's marketing URL. */
export const SITE = "https://novuspitch.com";

/**
 * Shown in Settings so a bug report can say which build it came from.
 *
 * Must match `MARKETING_VERSION` in ios/App/App.xcodeproj/project.pbxproj and
 * `versionName` in android/app/build.gradle. It is written down rather than
 * read from package.json because the static export has no runtime access to
 * it, and a version that silently reads 0.1.0 in the app while the store says
 * 1.0 makes every crash report ambiguous.
 */
export const APP_VERSION = "1.0";
