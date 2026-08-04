import type { Metadata } from "next";
import { AuthHashRelay } from "@/components/AuthHashRelay";
import { Landing } from "@/components/landing/Landing";
import {
  FAQ,
  ORGANIZATION_ID,
  ORGANIZATION_NODE,
  OG_IMAGE,
  SITE_NAME,
  SITE_ORIGIN,
  WEBSITE_ID,
  WEBSITE_NODE,
  absoluteUrl,
  jsonLd,
} from "@/lib/seo";

/**
 * "/" is the public front door, not a redirect. The Gate in /play still
 * decides between onboarding and a live run — the landing's account gate
 * routes into it (/welcome, or /found once onboarded).
 *
 * ── Search ──────────────────────────────────────────────────────────────────
 *
 * Everything a page can do for "novus pitch" lives here: the exact-match title
 * and description, canonical on novuspitch.com, OpenGraph/Twitter cards, and
 * the JSON-LD below (VideoGame + Organization, which is what earns the branded
 * knowledge panel and sitelinks once the domain has been crawled). What code
 * cannot do is rank by itself — that takes the domain being live, indexed
 * (Google Search Console), and linked from LaunchX/press/socials. On-page is
 * finished; the rest is distribution.
 */
export const metadata: Metadata = {
  // Absolute: this title already names the brand, and the layout template
  // would otherwise make it "… | novuspitch.com | Novus".
  title: {
    absolute: "Novus — run a company, pitch it out loud | novuspitch.com",
  },
  description:
    "Novus is a life sim for a company. Run it month by month — hiring, pricing, product — then close each year by pitching out loud, on camera, to five AI investors who have read your numbers. Free to play. Built by five students at LaunchX San Diego 2026.",
  keywords: [
    "Novus",
    "Novus pitch",
    "novuspitch",
    "business simulation game",
    "pitch practice app",
    "learn entrepreneurship by doing",
    "company life sim",
    "startup game for students",
    "LaunchX",
  ],
  alternates: { canonical: absoluteUrl("/") },
  openGraph: {
    type: "website",
    url: absoluteUrl("/"),
    siteName: SITE_NAME,
    title: "Novus — run a company, pitch it out loud",
    description:
      "You don't learn to ride a bike by watching videos. Run a company month by month, then defend it out loud to five investors who have read your numbers.",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "The Novus shark champion holding a trophy — keep a company alive, defend it out loud.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Novus — run a company, pitch it out loud",
    description:
      "A life sim for a company: run it month by month, then pitch it on camera to five investors who read your numbers.",
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

/**
 * Structured data. Three nodes now, not two: the site itself, the organization
 * that publishes it, and the game this page is about — cross-referenced by
 * `@id` so a crawler reads one entity graph rather than three loose objects.
 * The WebSite node is what sitelinks and a branded knowledge panel are built
 * from, and it was the piece missing before.
 *
 * Facts only — price, team, program — nothing invented. In particular there is
 * no aggregateRating: we have no ratings, and inventing them is both a
 * penalty and a lie.
 */
const JSON_LD = jsonLd(
  WEBSITE_NODE,
  ORGANIZATION_NODE,
  {
    "@type": "VideoGame",
    "@id": `${SITE_ORIGIN}/#game`,
    name: "Novus",
    alternateName: "Novus Pitch",
    url: SITE_ORIGIN,
    description:
      "A life sim for a company: run it month by month, then close each year by pitching out loud to five AI investors who have read your numbers.",
    image: absoluteUrl(OG_IMAGE),
    genre: ["Simulation", "Educational"],
    gamePlatform: ["Web browser", "iOS", "Android"],
    applicationCategory: "Game",
    operatingSystem: "Any (web), iOS, Android",
    inLanguage: "en-US",
    offers: [
      { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Free" },
      {
        "@type": "Offer",
        price: "6.99",
        priceCurrency: "USD",
        name: "Pro monthly",
      },
      {
        "@type": "Offer",
        price: "39.99",
        priceCurrency: "USD",
        name: "Pro yearly",
      },
    ],
    author: { "@id": ORGANIZATION_ID },
    publisher: { "@id": ORGANIZATION_ID },
    isPartOf: { "@id": WEBSITE_ID },
  },
  /*
   * The FAQ, quoted from the same constant the page renders.
   *
   * Google's rule for this markup is that the answer here must be the answer a
   * visitor can see — marking up text that is not on the page is what turns a
   * rich result into a manual action. One source is the only way that stays
   * true through an edit.
   */
  {
    "@type": "FAQPage",
    "@id": `${SITE_ORIGIN}/#faq`,
    isPartOf: { "@id": WEBSITE_ID },
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  },
);

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // Serialised server-side; nothing user-controlled enters this object.
        dangerouslySetInnerHTML={{ __html: JSON_LD }}
      />
      {/* A Supabase link whose redirect was not on the allow-list is sent to
          the Site URL — here — with its session still in the fragment. This
          hands it on to the page that can finish the job. */}
      <AuthHashRelay />
      <Landing />
    </>
  );
}
