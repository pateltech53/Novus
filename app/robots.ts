import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

/**
 * Both outputs of this repo prerender this file: the web build has no reason
 * to defer it, and the static export the app ships from cannot. Saying so is
 * what keeps `output: "export"` from failing on a route that was always
 * static in practice.
 */
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // App states, not pages. See sitemap.ts. /api is added because those
        // routes answer only POST — a crawler hitting them gets a 405 that
        // shows up in Search Console as a crawl error forever. /admin is the
        // operator console and /join carries an invite token in its URL —
        // neither belongs in an index.
        disallow: ["/play", "/welcome", "/found", "/reset", "/admin", "/join", "/api/"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
