import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

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
  title: "Novus — run a company, pitch it out loud | novuspitch.com",
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
  alternates: { canonical: "https://novuspitch.com" },
  openGraph: {
    type: "website",
    url: "https://novuspitch.com",
    siteName: "Novus",
    title: "Novus — run a company, pitch it out loud",
    description:
      "You don't learn to ride a bike by watching videos. Run a company month by month, then defend it out loud to five investors who have read your numbers.",
    images: [
      {
        url: "/og.png",
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
    images: ["/og.png"],
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
 * Structured data. Two graphs: the game (what the page is about) and the
 * organization (who to attribute it to, with the address search engines
 * surface). Facts only — price, team, program — nothing invented.
 */
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "VideoGame",
      name: "Novus",
      alternateName: "Novus Pitch",
      url: "https://novuspitch.com",
      description:
        "A life sim for a company: run it month by month, then close each year by pitching out loud to five AI investors who have read your numbers.",
      genre: ["Simulation", "Educational"],
      gamePlatform: "Web browser",
      applicationCategory: "Game",
      operatingSystem: "Any (web)",
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
      author: { "@id": "https://novuspitch.com/#team" },
    },
    {
      "@type": "Organization",
      "@id": "https://novuspitch.com/#team",
      name: "Novus",
      url: "https://novuspitch.com",
      email: "team@novuspitch.com",
      description:
        "Five students who built Novus at the LaunchX Flagship program, San Diego, summer 2026.",
      member: [
        { "@type": "Person", name: "Yuvan" },
        { "@type": "Person", name: "Dhruv" },
        { "@type": "Person", name: "Zach" },
        { "@type": "Person", name: "Ana" },
        { "@type": "Person", name: "Monica" },
      ],
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // Serialised server-side; nothing user-controlled enters this object.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <Landing />
    </>
  );
}
