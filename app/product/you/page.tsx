import type { Metadata } from "next";
import { YouStory } from "@/components/product/YouStory";
import { OG_IMAGE, absoluteUrl } from "@/lib/seo";

/**
 * The player's side of /product: the game, told scene by scene by the
 * scrollbar. The other door is /product/institutions.
 */
export const metadata: Metadata = {
  title: "Keep a company alive. Defend it out loud.",
  description:
    "Run a company month by month — cash, burn, runway, valuation, and 289 authored events pushing back. Then close the year the only honest way: a pitch, out loud, on camera, to five AI investors who have read your books. Free to play.",
  alternates: { canonical: absoluteUrl("/product/you") },
  openGraph: {
    type: "website",
    url: absoluteUrl("/product/you"),
    title: "Novus — keep a company alive, defend it out loud",
    description:
      "A life sim for a company. The year won't close without a pitch — out loud, on camera, judged on what you say.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Novus" }],
  },
};

export default function ProductYouPage() {
  return <YouStory />;
}
