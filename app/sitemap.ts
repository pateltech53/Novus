import type { MetadataRoute } from "next";

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
  return [
    {
      url: "https://novuspitch.com",
      changeFrequency: "weekly",
      priority: 1,
    },
    // The second public page: where the iOS and Android builds are, and the
    // one thing someone searching "novus app download" is looking for.
    {
      url: "https://novuspitch.com/download",
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];
}
