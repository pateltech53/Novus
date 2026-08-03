/**
 * One canonical origin, and the shared identity every page hangs off.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `https://novuspitch.com` was typed out in ten places: metadataBase, the
 * sitemap, robots.txt, four `alternates.canonical` entries, three `openGraph.url`
 * entries, and two JSON-LD `@id`s. Ten copies of a hostname is not a style
 * problem — it is a correctness one, because canonicals, OG urls and structured
 * data `@id`s only work when they agree EXACTLY, and ten literals drift.
 *
 * ── The www question, which has to be answered before launch ────────────────
 *
 * `lib/native/origin.ts` says the apex 308s to `www.novuspitch.com`, and that
 * a redirect there was not a slower path but a broken one. If that is still
 * true in production then every canonical in this app currently points at a
 * URL that redirects — search engines will follow it and pick www themselves,
 * but you are asking them to guess at the one thing a canonical exists to
 * state.
 *
 * Check which host answers 200 without a hop, and set SITE_ORIGIN to that one.
 * It is now a single edit rather than ten.
 */
export const SITE_ORIGIN = "https://novuspitch.com";

export const SITE_NAME = "Novus";

/** The one social card image, 1200×630, in public/. */
export const OG_IMAGE = "/og.png";

/** Absolute URL for a path. Canonicals and `@id`s must never be relative. */
export const absoluteUrl = (path = "/"): string =>
  path === "/"
    ? SITE_ORIGIN
    : `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * The Organization node, referenced by `@id` from every other graph.
 *
 * Kept here rather than inline on the landing page because two pages now cite
 * it (`/` and `/download`), and a second copy that disagreed by one character
 * would read as two different organizations to a crawler rather than one.
 *
 * `logo` is what a knowledge panel renders. `sameAs` is deliberately empty:
 * it is for profiles this team actually controls, and listing one that does
 * not exist is worse than listing none.
 */
export const ORGANIZATION_ID = `${SITE_ORIGIN}/#team`;

export const ORGANIZATION_NODE = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: SITE_NAME,
  url: SITE_ORIGIN,
  email: "team@novuspitch.com",
  logo: absoluteUrl("/icons/icon-512.png"),
  description:
    "Five students who built Novus at the LaunchX Flagship program, San Diego, summer 2026.",
  member: [
    { "@type": "Person", name: "Yuvan" },
    { "@type": "Person", name: "Dhruv" },
    { "@type": "Person", name: "Zach" },
    { "@type": "Person", name: "Ana" },
    { "@type": "Person", name: "Monica" },
  ],
} as const;

/**
 * The WebSite node.
 *
 * This is the piece that was missing: with a VideoGame and an Organization but
 * no WebSite, nothing in the graph said "these pages are one site published by
 * that organization". It is the node sitelinks and the branded knowledge panel
 * are built from.
 *
 * No `SearchAction` — there is no site search, and claiming one that 404s is
 * how a sitelinks searchbox gets ignored.
 */
export const WEBSITE_ID = `${SITE_ORIGIN}/#website`;

export const WEBSITE_NODE = {
  "@type": "WebSite",
  "@id": WEBSITE_ID,
  url: SITE_ORIGIN,
  name: SITE_NAME,
  inLanguage: "en-US",
  publisher: { "@id": ORGANIZATION_ID },
} as const;

/** Serialise a graph for a single `<script type="application/ld+json">`. */
export const jsonLd = (...nodes: object[]) =>
  JSON.stringify({ "@context": "https://schema.org", "@graph": nodes });
