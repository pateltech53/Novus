import type { Metadata } from "next";
import { Gate } from "@/components/product/Gate";
import { OG_IMAGE, absoluteUrl } from "@/lib/seo";

/**
 * /product — the fork. One screen, two doors: the player's story and the
 * institution's story, each a scroll-told page of its own. The landing at "/"
 * is unchanged; this is the product told at length, for whoever is asking.
 */
export const metadata: Metadata = {
  title: "One game, two ways in",
  description:
    "Novus is a life sim for a company — run it month by month, then defend it out loud to five AI investors who have read your numbers. Play it yourself, or run it with a classroom, club or competition.",
  alternates: { canonical: absoluteUrl("/product") },
  openGraph: {
    type: "website",
    url: absoluteUrl("/product"),
    title: "Novus — one game, two ways in",
    description:
      "Play it yourself, or run it with a classroom, club or competition. Either way, the year ends with a pitch, out loud.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Novus" }],
  },
};

export default function ProductPage() {
  return <Gate />;
}
