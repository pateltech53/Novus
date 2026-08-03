import type { Metadata, Viewport } from "next";
import { Urbanist, IBM_Plex_Mono, Instrument_Serif, Baloo_2 } from "next/font/google";
import "./globals.css";
import { Motion } from "@/components/ui/Motion";
import { Sound } from "@/components/ui/Sound";
import { CloudSync } from "@/components/CloudSync";
import { AdminSkipPrompt } from "@/components/admin/AdminSkipPrompt";
import { NativeShell } from "@/components/native/NativeShell";
import { UpgradeProvider } from "@/components/upgrade/UpgradeProvider";
import { AiStatusBanner } from "@/components/AiStatusBanner";
import { THEME_COLOR_DARK } from "@/lib/brand";
import { OG_IMAGE, SITE_NAME, SITE_ORIGIN } from "@/lib/seo";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { PLATFORM_INIT_SCRIPT } from "@/lib/native/platform";

const urbanist = Urbanist({
  subsets: ["latin"],
  variable: "--font-urbanist",
  weight: ["400", "500", "600", "700", "800"],
});

/**
 * The ledger face. OFL, so it self-hosts through next/font with no external
 * request — which matters for the installable PWA and for the no-third-party
 * stance in the privacy rules. True tabular figures, a real 700, and narrower
 * than Roboto Mono so long currency strings hold without wrapping.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600", "700"],
});

/**
 * The display face — headlines and, above all, the name field.
 *
 * Urbanist is a fine UI face and a forgettable display one: "What should the
 * shark call you?" set in it looked like a form label, so the answer felt like
 * filling in a form. A serif at a large size makes the name read as a
 * signature. Used sparingly — headlines and the name, nowhere else.
 */
const instrument = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-display-serif",
  weight: "400",
});

/**
 * The lock-screen clock, and nothing else.
 *
 * A phone lock screen is the one surface in this app that is not Novus chrome —
 * it is the player's own device, and it should feel like it. Baloo 2 at 800 is
 * round and soft in a way the UI grotesk deliberately is not, which is what
 * makes the phone read as a separate object you picked up rather than another
 * panel of the game.
 *
 * Scoped to the clock on purpose. It must never leak into a financial figure.
 */
const baloo = Baloo_2({
  subsets: ["latin"],
  variable: "--font-bubble",
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  // Resolves every relative OG/twitter image URL against the real origin —
  // without it, crawlers see a broken relative path and drop the card.
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    // Pages that set a plain string get the brand appended; the landing and
    // download pages set `absolute` because their titles already carry it and
    // "… | Novus | Novus" is how a good title becomes a truncated one.
    default: "Novus — run a company, pitch it out loud",
    template: "%s | Novus",
  },
  description:
    "A life sim for a company. Tap through months for free. The year costs you a pitch.",
  applicationName: SITE_NAME,
  authors: [{ name: "The Novus team", url: SITE_ORIGIN }],
  creator: "The Novus team",
  publisher: SITE_NAME,
  category: "education",
  /*
   * Defaults, so a page that sets no card still gets one.
   *
   * /privacy, /terms and /reset shipped with no OpenGraph or Twitter tags at
   * all — a privacy link pasted into a message rendered as a bare URL. These
   * are inherited and overridden per page, so the two that write their own are
   * unaffected.
   */
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: SITE_ORIGIN,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Novus" }],
  },
  twitter: {
    card: "summary_large_image",
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Lets Google use the full-size card image and an untruncated snippet.
      // Without these it may pick a thumbnail and a 160-character clip.
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  // Stops iOS turning "$6.99" and stray digit runs in the legal pages into
  // tappable phone-number links.
  formatDetection: { telephone: false, address: false, email: false },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Novus",
    // Lets the stage run under the status bar instead of below a white band.
    statusBarStyle: "black-translucent",
  },
  /*
   * The tab icon. There was no favicon at all before this — no `app/icon.*`,
   * no `/favicon.ico` — so every browser tab, bookmark and search result fell
   * back to a blank page glyph.
   *
   * Four files, because no single format covers everything:
   *
   *   · favicon.ico     — requested BLIND, by browsers and crawlers that never
   *                       read a <link> tag. Without it those requests 404.
   *                       Holds 16/32/48 so Windows and the bookmark bar each
   *                       get a size drawn for them rather than a downscale.
   *   · favicon.svg     — what every current browser actually uses. One file,
   *                       sharp at any density, ~340 bytes.
   *   · favicon-32/96   — the raster fallback for anything that takes neither
   *                       (older Safari, in-app webviews, link scrapers).
   *   · apple-touch-icon— the home-screen tile, which predates all of this.
   *
   * Rasters before the SVG on purpose: a browser that understands SVG takes
   * the later, better one, and a browser that does not never sees it.
   *
   * Declared here rather than by Next's `app/icon.*` file convention because
   * an explicit `icons` object OVERRIDES that convention — having both would
   * silently drop the convention files. One source of truth instead.
   */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/icons/favicon-96.png", type: "image/png", sizes: "96x96" },
      { url: "/icons/favicon.svg", type: "image/svg+xml", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  // Matches --n-1 in dark, so there is no flash of a different ground.
  // One theme, so one colour. A light entry here made a light-mode phone
  // paint light chrome around a dark app.
  themeColor: THEME_COLOR_DARK,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The keyboard resizes the layout instead of scrolling the page under it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      // Dark is the default world. A player choice writes data-theme; without
      // one, the OS preference decides (see globals.css).
      className={`${urbanist.variable} ${plexMono.variable} ${instrument.variable} ${baloo.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Blocking on purpose. Without it the page paints light and swaps to
            dark a frame later — the flash every themed app gets wrong once. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Blocking for the same reason: which shell this is has to be known
            before anything styled per shell paints. (It used to gate the CSS
            glass; that material is retired — see globals.css — but the
            attribute still answers "am I in the app?" before first paint.) */}
        <script dangerouslySetInnerHTML={{ __html: PLATFORM_INIT_SCRIPT }} />
      </head>
      {/* Themed via utilities rather than a raw `body` rule: utilities
          re-resolve the custom property on theme change, so overscroll never
          flashes the previous theme's colour. */}
      <body className="min-h-dvh bg-[var(--bg)] text-[var(--text-primary)] antialiased">
        <NativeShell />
        <Sound />
        <CloudSync />
        {/* Renders nothing for players, ever — it wakes only when an admin
            session presses a paid button (lib/cloud/admin-skip.ts). */}
        <AdminSkipPrompt />
        {/* Outside <Motion> would put the upgrade sheet's spring beyond
            MotionConfig's reach, so a reduced-motion player would get the one
            animation in the app that ignored them. Inside, and the gates on
            /found, /play and the in-game phone all reach the same provider. */}
        <Motion>
          <UpgradeProvider>{children}</UpgradeProvider>
        </Motion>
        {/* Last, so it draws above everything, and outside <Motion> because a
            diagnostic a reduced-motion setting could hide is not a diagnostic. */}
        <AiStatusBanner />
      </body>
    </html>
  );
}
