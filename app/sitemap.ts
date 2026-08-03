import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/seo";

/**
 * Both outputs of this repo prerender this file: the web build has no reason
 * to defer it, and the static export the app ships from cannot. Saying so is
 * what keeps `output: "export"` from failing on a route that was always
 * static in practice.
 */
export const dynamic = "force-static";

/**
 * Only the public front door is listed. /welcome, /found and /play are app
 * states behind a device-local account — indexing them would land searchers on
 * half-initialised screens and dilute the one page that should rank.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Build time, not request time — this file is prerendered, so "now" is the
  // moment the deploy was cut, which is exactly the honest answer to "when did
  // this last change". A hardcoded date would go stale; a per-request date on
  // a static file is a lie a crawler learns to ignore.
  const lastModified = new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    // The second public page: where the iOS and Android builds are, and the
    // one thing someone searching "novus app download" is looking for.
    {
      url: absoluteUrl("/download"),
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    // The two documents App Store Connect asks for by URL, and that a
    // reviewer follows from the listing. Low priority, but they have to be
    // crawlable — an unindexed policy is one more thing to explain in a
    // review note.
    {
      url: absoluteUrl("/privacy"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/terms"),
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
