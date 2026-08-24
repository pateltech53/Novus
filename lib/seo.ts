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
 * `logo` is what a knowledge panel renders. `sameAs` names the profiles this
 * team actually controls — it is how a search engine connects the accounts to
 * the site and treats the three as one brand. Only add a profile that exists
 * and is ours: pointing it at someone else's account tells Google to associate
 * this brand with them, which is worse than listing nothing.
 *
 * These are corroborated by real links in the landing footer. A `sameAs` the
 * site does not also link to is a claim; one it does link to is evidence.
 */
export const ORGANIZATION_ID = `${SITE_ORIGIN}/#team`;

/**
 * THE TEAM — one list, read by the page and by the structured data.
 *
 * ── Why it moved here ───────────────────────────────────────────────────────
 *
 * It was two lists: `TEAM` in components/landing/Landing.tsx carried the name,
 * the role and the photograph, and `member` below carried the name again. Two
 * copies of a person's name in one repository is the same failure mode the
 * FAQ has its own note about — the moment one is edited, the page and the graph
 * describe two different people, and the one place that shows up is a search
 * result nobody on the team is looking at.
 *
 * That is not hypothetical here. This list exists in its current form because a
 * name changed: Dhruv Patel is Dhruv Amit Patel, and a rename that reached the
 * page but not the graph would have left the crawler's copy stale.
 *
 * ── `alternateName`, which is the whole point of the rename ─────────────────
 *
 * A person who has been published under one string and is now published under
 * a longer one is ONE person, and a search engine has no way to know that
 * unless it is told. `alternateName` is how it is told: it says "Dhruv Amit
 * Patel" and "Dhruv Patel" are the same entity, so whatever authority the
 * shorter form has accumulated attaches to the fuller one rather than
 * competing with it. Without it, the rename reads as a new person with no
 * history.
 *
 * ── `roles` is an array, and stays one ──────────────────────────────────────
 *
 * schema.org's `jobTitle` accepts a list, and these people hold several titles
 * each. Flattening them into one string — "CEO, Co-Founder, Software Engineer
 * and COO" — would hand a crawler a single job title that is four job titles
 * with commas in it, and it is the four it should be able to read separately.
 * The page joins them for display; the graph does not.
 *
 * Photos ship from files named by each person — no guessed mappings.
 */
export interface TeamMember {
  name: string;
  /** Every title this person holds, most senior first. */
  roles: readonly string[];
  photo: string;
  /** Founders are also listed under the Organization's `founder`. */
  founder?: boolean;
  /** A name this person has previously been published under, if any. */
  alsoKnownAs?: string;
}

export const TEAM: readonly TeamMember[] = [
  {
    name: "Yuvan Satish",
    roles: ["Co-Founder", "CMO", "CHRO"],
    photo: "/landing/team/yuvan.webp",
    founder: true,
  },
  {
    name: "Dhruv Amit Patel",
    alsoKnownAs: "Dhruv Patel",
    roles: ["CEO", "Co-Founder", "Software Engineer", "COO"],
    photo: "/landing/team/dhruv.webp",
    founder: true,
  },
  {
    name: "Zach Han",
    roles: ["Co-Founder", "Mobile App Developer", "Full-Stack Developer", "CFO"],
    photo: "/landing/team/zach.webp",
    founder: true,
  },
  {
    name: "Ana Hashem",
    roles: ["Customer Research"],
    photo: "/landing/team/ana.webp",
  },
  {
    name: "Monica Raina",
    roles: ["Outreach"],
    photo: "/landing/team/monica.webp",
  },
];

/**
 * The role line as the page prints it: `CEO · CO-FOUNDER · SOFTWARE ENGINEER`.
 *
 * The hyphen becomes a NON-BREAKING one on the way out. These captions sit in a
 * column about 180px wide and four titles wrap to four lines, which is fine —
 * what is not fine is where they wrapped: "FULL-STACK DEVELOPER" broke after
 * the hyphen and printed "FULL-" alone at the end of a line. The interpunct
 * between titles is still a breakable space either side, so the line breaks
 * BETWEEN roles, which is the only place it should.
 *
 * Done here rather than in the data: `jobTitle` in the graph should carry an
 * ordinary hyphen, because it is a job title and not a line of type.
 */
export const roleLine = (member: TeamMember): string =>
  member.roles.join(" · ").replace(/-/g, "\u2011");

/**
 * A stable `@id` per person, so the graph names an ENTITY rather than repeating
 * a string. Derived from the name, and deliberately not from `alsoKnownAs`:
 * the id follows the person's current name and the old one is carried as an
 * alternate, which is the direction that keeps a rename from forking them.
 */
const personId = (name: string) =>
  `${SITE_ORIGIN}/#${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const personNode = (member: TeamMember) => ({
  "@type": "Person",
  "@id": personId(member.name),
  name: member.name,
  ...(member.alsoKnownAs ? { alternateName: member.alsoKnownAs } : {}),
  jobTitle: [...member.roles],
  image: absoluteUrl(member.photo),
  worksFor: { "@id": ORGANIZATION_ID },
  // The section that actually shows this person, so the claim is checkable
  // against a page a crawler can fetch rather than only asserted.
  mainEntityOfPage: `${SITE_ORIGIN}/#team`,
});

export const ORGANIZATION_NODE = {
  "@type": "Organization",
  "@id": ORGANIZATION_ID,
  name: SITE_NAME,
  url: SITE_ORIGIN,
  email: "team@novuspitch.com",
  logo: absoluteUrl("/icons/icon-512.png"),
  sameAs: [
    "https://www.instagram.com/novuspitch/",
    "https://www.tiktok.com/@novuspitch",
  ],
  description:
    "Five students who built Novus at the LaunchX Flagship program, San Diego, summer 2026.",
  /*
   * `founder` as well as `member`, because they are different claims and only
   * one of them answers "who started this".
   *
   * References rather than repeated objects: `member` below carries the full
   * Person node for all five, and JSON-LD resolves a bare `@id` against it, so
   * the founders are described once and cited twice. Inlining them in both
   * places would have doubled the graph to say the same thing, and left two
   * copies of every job title to drift apart.
   */
  founder: TEAM.filter((m) => m.founder).map((m) => ({ "@id": personId(m.name) })),
  member: TEAM.map(personNode),
};

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

/**
 * The questions, and the answers, ONCE.
 *
 * components/landing/Faq.tsx renders these and app/page.tsx quotes them into
 * the FAQPage graph. Google requires the marked-up answer to be the answer
 * visible on the page — two copies is how that silently stops being true, and
 * a mismatch is a manual action rather than a missed opportunity.
 *
 * Every answer is a fact about the product. Nothing here is written for a
 * crawler that is not also true for a fourteen-year-old reading the page.
 */
export const FAQ: { q: string; a: string }[] = [
  {
    q: "What is Novus?",
    a: "Novus is a business simulation game. You run a company month by month — hiring, pricing, product, the lot — and at the end of each fiscal year the game stops and asks you to pitch it out loud, on camera, to five investors who have read your numbers.",
  },
  {
    q: "Is Novus free?",
    a: "Yes. The whole game is free: twelve months, the full pitch, the same scoring and the same leaderboard. Novus Pro opens more of the world — extra industries, more runs a day — and never buys a score, a survival or a place on the board.",
  },
  {
    q: "Do I need a camera to play?",
    a: "You need one to close a fiscal year, because the pitch is the game. If your camera or microphone will not work, you can type your pitch instead and it is scored the same way — on what you said, not on how you sounded.",
  },
  {
    q: "What happens to my video?",
    a: "It never leaves your device. The delivery coach reads frames in memory on your own phone or laptop and keeps only averages. Audio is sent for transcription only when a transcription service is configured, and it is never stored. Nothing is uploaded, kept or shown to anyone.",
  },
  {
    q: "Is Novus scored on my accent or how confident I sound?",
    a: "No, and it cannot be. Accent, tone of voice, energy and speech rhythm are never scored anywhere in Novus. The score comes from what you said and whether your claims survive a look at your own books. Delivery figures like words per minute are reported back to you and are kept out of the code that grades.",
  },
  {
    q: "Can I play Novus on my phone?",
    a: "Yes. Novus runs in any modern browser on a phone, tablet or computer, and there are iOS and Android builds. Your company follows your account between devices.",
  },
  {
    q: "Who made Novus?",
    a: "Five students at the LaunchX Flagship program in San Diego, summer 2026. It was co-founded by Dhruv Amit Patel, who is CEO and COO and wrote much of the software; Zach Han, who built the mobile app and the full stack and is CFO; and Yuvan Satish, who is CMO and CHRO. Ana Hashem led customer research and Monica Raina led outreach. Designed, coded and pitched in one summer.",
  },
  /*
   * A question about a person, in a product FAQ, on purpose.
   *
   * "Who is <founder>" is a real query with a real answer, and the answer is
   * on this page already — a photograph, a name and a role, in the team
   * section. What it lacked was the question. A search engine matching that
   * query had a name in a grid and nothing that read as a definition, and the
   * name it had was the old one.
   *
   * Everything below is a fact stated elsewhere on the same page, which is the
   * rule for this list and the rule Google enforces on FAQPage markup: the
   * marked-up answer has to be the answer a visitor can see.
   */
  {
    q: "Who is Dhruv Amit Patel?",
    a: "Dhruv Amit Patel is the CEO, COO and a co-founder of Novus, and one of its software engineers. He built Novus with Zach Han and Yuvan Satish at the LaunchX Flagship program in San Diego, summer 2026 — a business simulation where you run a company month by month and close each fiscal year by pitching it out loud to five AI investors.",
  },
];
