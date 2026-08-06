import type { Metadata } from "next";
import {
  ORGANIZATION_ID,
  OG_IMAGE,
  SITE_NAME,
  SITE_ORIGIN,
  WEBSITE_ID,
  absoluteUrl,
  jsonLd,
} from "@/lib/seo";
import Link from "next/link";
import {
  ANDROID_AAB_URL,
  ANDROID_APK_URL,
  ANDROID_MIN,
  IOS_APP_URL,
  IOS_MIN,
  RELEASES_URL,
  TESTFLIGHT_URL,
} from "@/lib/downloads";

export const metadata: Metadata = {
  title: {
    absolute: "Get Novus — iPhone, Android, or the browser | novuspitch.com",
  },
  description:
    "Novus on your phone. The iOS build uses the system's own Liquid Glass; the Android build ships as a direct APK. Or just play it in the browser — same game, same save.",
  alternates: { canonical: absoluteUrl("/download") },
  openGraph: {
    type: "website",
    url: absoluteUrl("/download"),
    siteName: SITE_NAME,
    title: "Get Novus",
    description: "Run a company on your phone, then pitch it out loud.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Novus" }],
  },
};

/**
 * The download page.
 *
 * Three real options and no dark patterns: the App Store when it is live, a
 * direct APK for Android, and the browser build that has always worked. The
 * iOS card states plainly that the build is not out yet rather than dressing a
 * dead link as a live one — see lib/downloads.ts.
 */
/**
 * The apps, as an entity rather than as prose.
 *
 * This page had no structured data at all, which meant the one page about the
 * iOS and Android builds said nothing machine-readable about them. It is
 * marked up as a SoftwareApplication rather than a second VideoGame so it does
 * not compete with the landing page's node for the same query — same product,
 * different facet: the thing you install.
 */
const JSON_LD = jsonLd({
  "@type": "SoftwareApplication",
  "@id": `${SITE_ORIGIN}/#app`,
  name: "Novus",
  url: absoluteUrl("/download"),
  applicationCategory: "GameApplication",
  operatingSystem: "iOS, Android, Web",
  inLanguage: "en-US",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  publisher: { "@id": ORGANIZATION_ID },
  isPartOf: { "@id": WEBSITE_ID },
});

export default function DownloadPage() {
  const iosLive = Boolean(IOS_APP_URL || TESTFLIGHT_URL);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON_LD }}
      />
      <main className="mx-auto w-full max-w-3xl px-6 pt-[max(2.5rem,var(--nv-safe-top))] pb-[max(3rem,var(--nv-safe-bottom))]">
        <p className="text-2xs font-extrabold tracking-[0.24em] text-[var(--text-tertiary)]">
          <Link
            href="/"
            className="transition-colors hover:text-[var(--text-primary)]"
          >
            NOVUS
          </Link>
        </p>

        <h1 className="mt-4 text-[2rem] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[2.75rem]">
          Put a company in your pocket.
        </h1>
        <p className="mt-4 max-w-[34rem] text-base leading-relaxed text-[var(--text-secondary)]">
          Same game on every one of these, and the same save behind it. Months
          are free. The year costs you a pitch, out loud, on camera.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {/* ── iPhone ──────────────────────────────────────────────────────── */}
          <section className="nv-card flex flex-col p-5">
            <div className="flex items-center gap-2.5">
              <AppleMark />
              <h2 className="text-lg font-extrabold tracking-[-0.01em]">
                iPhone
              </h2>
            </div>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--text-secondary)]">
              The tab bar, the advance button and the masthead controls are real
              UIKit Liquid Glass on iOS 26 — the system material, not a CSS
              impression of it. Portrait, {IOS_MIN} and up.
            </p>

            {iosLive ? (
              <div className="mt-5 flex flex-col gap-2">
                {IOS_APP_URL ? (
                  <a
                    href={IOS_APP_URL}
                    className="nv-gc flex h-12 items-center justify-center rounded-[var(--radius-pill)] nv-t-action text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)]"
                  >
                    DOWNLOAD ON THE APP STORE
                  </a>
                ) : null}
                {TESTFLIGHT_URL ? (
                  <a
                    href={TESTFLIGHT_URL}
                    className="nv-gc flex h-12 items-center justify-center rounded-[var(--radius-pill)] text-sm font-bold text-[var(--text-primary)]"
                  >
                    Join the TestFlight beta
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="mt-5 flex h-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--surface-elevated)] text-sm font-bold text-[var(--text-tertiary)]">
                In review — not out yet
              </p>
            )}
          </section>

          {/* ── Android ─────────────────────────────────────────────────────── */}
          <section className="nv-card flex flex-col p-5">
            <div className="flex items-center gap-2.5">
              <AndroidMark />
              <h2 className="text-lg font-extrabold tracking-[-0.01em]">
                Android
              </h2>
            </div>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--text-secondary)]">
              A direct install, built by GitHub Actions from the tag it is named
              after. {ANDROID_MIN} and up.
            </p>

            <a
              href={ANDROID_APK_URL}
              className="nv-gc mt-5 flex h-12 items-center justify-center rounded-[var(--radius-pill)] nv-t-action text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)]"
            >
              DOWNLOAD THE APK
            </a>
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <a
                href={ANDROID_AAB_URL}
                className="text-2xs font-bold text-[var(--text-tertiary)] underline decoration-[var(--hairline)] underline-offset-4"
              >
                .aab bundle
              </a>
              <a
                href={RELEASES_URL}
                className="text-2xs font-bold text-[var(--text-tertiary)] underline decoration-[var(--hairline)] underline-offset-4"
              >
                All releases
              </a>
            </div>
          </section>
        </div>

        {/* ── Browser ───────────────────────────────────────────────────────── */}
        <section className="nv-card mt-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold tracking-[-0.01em]">
              Any browser
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
              Nothing to install. Add it to your home screen and it runs
              full-screen like the app does.
            </p>
          </div>
          <Link
            href="/play"
            className="nv-gc flex h-12 shrink-0 items-center justify-center rounded-[var(--radius-pill)] px-6 text-sm font-extrabold tracking-[0.04em] text-[var(--text-primary)]"
          >
            PLAY NOW
          </Link>
        </section>

        {/* ── Sideloading, said plainly ─────────────────────────────────────── */}
        <section className="mt-10">
          <h2 className="text-2xs font-extrabold tracking-[0.2em] text-[var(--text-tertiary)]">
            INSTALLING THE APK
          </h2>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            <li>
              <span className="font-bold text-[var(--text-primary)]">1.</span>{" "}
              Open this page on the phone and tap Download the APK.
            </li>
            <li>
              <span className="font-bold text-[var(--text-primary)]">2.</span>{" "}
              Android will ask whether your browser may install apps. It only
              ever asks once per browser.
            </li>
            <li>
              <span className="font-bold text-[var(--text-primary)]">3.</span>{" "}
              Open the downloaded file and install.
            </li>
          </ol>
          <p className="mt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
            Play Protect will warn that the app is from an unknown developer,
            because a direct APK is not distributed through the Play Store.
            Builds are produced in public by GitHub Actions — the workflow that
            made the file you are downloading is in this repository.
          </p>
        </section>

        <p className="mt-12 border-t border-[var(--hairline)] pt-5 text-2xs leading-relaxed text-[var(--text-tertiary)]">
          The camera and the microphone are used for one thing: the year-end
          pitch. Recordings stay on the device.{" "}
          <Link
            href="/privacy"
            className="underline decoration-[var(--hairline)] underline-offset-4"
          >
            Privacy
          </Link>
          .
        </p>
      </main>
    </>
  );
}

function AppleMark() {
  return (
    <svg
      width="18"
      height="22"
      viewBox="0 0 17 21"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M14.05 11.15c-.02-2.2 1.79-3.26 1.87-3.31-1.02-1.49-2.6-1.7-3.17-1.72-1.35-.14-2.63.79-3.31.79-.68 0-1.73-.77-2.85-.75-1.47.02-2.82.85-3.58 2.16-1.53 2.65-.39 6.57 1.1 8.72.73 1.05 1.6 2.23 2.74 2.19 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.49ZM11.87 4.7c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22Z" />
    </svg>
  );
}

function AndroidMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 9.2A6 6 0 0 1 16 9.2v6.3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m5.6 3.4 1.3 2.1M14.4 3.4l-1.3 2.1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="7.6" cy="9" r=".95" fill="currentColor" />
      <circle cx="12.4" cy="9" r=".95" fill="currentColor" />
    </svg>
  );
}
