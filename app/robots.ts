import type { MetadataRoute } from "next";

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
        // App states, not pages. See sitemap.ts.
        disallow: ["/play", "/welcome", "/found"],
      },
    ],
    sitemap: "https://novuspitch.com/sitemap.xml",
  };
}
