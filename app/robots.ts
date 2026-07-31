import type { MetadataRoute } from "next";

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
