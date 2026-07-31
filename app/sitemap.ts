import type { MetadataRoute } from "next";

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
  ];
}
