# SEO

The goal: someone types **Novus** or **Novus pitch** and this site is in the
first three results.

This document is in two halves, and the split is the important part. The first
half is everything the codebase can do, which is now done. The second half is
everything the codebase cannot do, which is what will actually decide whether
the goal is met.

---

## 1. The honest expectation, per query

Ranking is not a setting. It is a judgement Google makes about which page best
answers a query, and the two queries in the goal are not the same problem.

| Query | Realistic outcome | Why |
| --- | --- | --- |
| `novuspitch` | **#1, quickly** | Exact domain match, no competitors for the string. This is essentially a lookup. |
| `novus pitch` | **Top 3 is achievable** | Two-word branded query. The main competition is press about other companies pitching, and the exact-match domain plus on-page copy is strong here. |
| `novus pitch game` / `novus business game` | **Top 3 achievable** | Long-tail, low competition, and the page genuinely answers it. |
| `novus` alone | **Top 3 is not a promise anyone should make** | See below. |

### About the bare word "novus"

"Novus" is Latin for "new" and is one of the most heavily used brand names in
existence. The first page currently belongs to companies with decades of
history, large link profiles and their own `.com`s — animal nutrition, glass
repair, fintech, telecoms, several universities' programmes.

Nothing in a codebase moves a new domain past those. What moves it is the thing
Google uses to rank brands: **people searching for and linking to this one**.
As the volume of "novus pitch" and "novus game" searches grows, Google learns
that a chunk of "novus" traffic wants this, and the site climbs the generic
term. That is a distribution outcome with a technical prerequisite, and the
prerequisite is what section 2 delivers.

So: expect the branded queries fast, treat the bare word as a medium-term goal
that follows from the work in section 3, and do not let anyone sell you a
guarantee on it.

---

## 2. What the code does (done)

All of this is implemented and verified in the rendered HTML, not just in
source.

**One canonical origin.** `lib/seo.ts` holds the origin once. It was written
out in ten places — `metadataBase`, the sitemap, robots.txt, four canonicals,
three OpenGraph urls, two JSON-LD `@id`s — and canonicals, OG urls and `@id`s
only work when they agree exactly.

**Every page has a title, a description, a canonical and a card.** The root
layout carries defaults with a `%s | Novus` template; `/privacy`, `/terms` and
`/reset` previously had no OpenGraph or Twitter tags at all, so a policy link
pasted into a message rendered as a bare URL.

**Structured data, as one connected graph:**

| Node | Page | What it earns |
| --- | --- | --- |
| `WebSite` | `/` | The site as an entity — what sitelinks are built from |
| `Organization` | `/` | The team, with a logo — the branded knowledge panel |
| `VideoGame` | `/` | What the product *is*, with real prices |
| `FAQPage` | `/` | The expandable questions under the main result |
| `SoftwareApplication` | `/download` | The installable app, separate from the game |

Everything cross-references by `@id`, so a crawler reads one entity rather than
five loose objects.

**An FAQ that is real content.** `components/landing/Faq.tsx` answers what
Novus is, whether it is free, what happens to the video, and who made it. The
answers live in `lib/seo.ts` and are rendered *and* marked up from that one
constant — Google requires the marked-up answer to be the visible one, and two
copies is how that quietly stops being true.

**Crawl hygiene.** `robots.txt` allows the four public pages and blocks
`/play`, `/welcome`, `/found`, `/reset` (app states, not pages) and `/api`
(POST-only routes that would otherwise log permanent crawl errors). The sitemap
lists the four public URLs with `lastModified`.

**No invented facts.** In particular no `aggregateRating`: there are no ratings
yet, and fabricating them is both a penalty and a lie.

---

## 3. What only you can do — in priority order

This is the half that decides the outcome. Nothing below can be committed.

### 3.1 Verify the domain in Google Search Console — today

Until this is done, none of section 2 is being read by anything.

1. search.google.com/search-console → Add property → Domain → `novuspitch.com`
2. Add the TXT record it gives you at your DNS provider.
3. Sitemaps → submit `https://novuspitch.com/sitemap.xml`
4. URL Inspection → paste `https://novuspitch.com` → **Request indexing**.
5. Repeat step 4 for `/download`.

Do the same at bing.com/webmasters — it takes five minutes and feeds
DuckDuckGo and ChatGPT search as well.

### 3.2 Settle www vs apex — before anyone links to you

`lib/native/origin.ts` records that the apex 308-redirects to `www`. If that is
still true, every canonical currently points at a URL that redirects, and links
will split across two hostnames.

Open both in a browser. Whichever answers **200 with no hop** is canonical. Set
`SITE_ORIGIN` in `lib/seo.ts` to that one, and make the other redirect to it in
Vercel's domain settings. This is one line and one setting, and doing it after
you have backlinks is much more expensive than doing it now.

### 3.3 Get the first links — this is the whole game for the bare word

Google ranks a new domain mostly on who vouches for it. Five real links beat
any amount of markup. In descending order of value:

- **LaunchX** — the programme page, the demo-day listing, any alumni or
  showcase page. This is the highest-authority link available to you and it is
  a link you have a legitimate claim to.
- **Your school** — student-project pages, newsletters, the FBLA chapter.
- **Local or student press** — "five students built a business game" is a real
  story with a photograph. One local outlet is worth dozens of directory links.
- **Product directories** — Product Hunt, itch.io, AlternativeTo, educational
  game listings. Free, permanent, and each one is a page that can rank for
  "novus pitch" itself.
- **The team's own profiles** — LinkedIn, GitHub, Instagram bios. Add the link
  to all five. Then add the profile URLs to `sameAs` in `ORGANIZATION_NODE`, so
  Google can connect the accounts to the site.

Never buy links. For a site aimed at minors that is both a ranking risk and a
reputational one.

### 3.4 Make people search the brand

The single strongest signal for a branded query is people searching it. Every
poster, slide, video description and bio should say **novuspitch.com**, not
"search for Novus". A QR code on a demo-day poster produces direct traffic,
which is worth more than a link.

### 3.5 Then wait, and measure

Indexing takes days; branded ranking takes weeks; the generic word takes
months, if it comes at all. Check in Search Console → Performance, filtered to
queries containing "novus". The number to watch is **impressions on `novus
pitch`**, not position on `novus` — the first tells you the site is being
considered, and the second follows it.

---

## 4. What is deliberately not done

- **No keyword-stuffed copy.** The landing page reads like a product, not like
  a page trying to rank, and Google has been better at telling those apart than
  people give it credit for since about 2012.
- **No blog.** A content programme is a real strategy and a real ongoing
  commitment; five students shipping a game do not need six thin articles that
  never get updated.
- **No hidden text, no brand name jammed into the `h1`.** The hero says "Keep a
  company alive. Defend it out loud." That is the better sentence, and the
  brand appears in the title, the description, the FAQ and the structured data
  where it counts.
- **No `aggregateRating`, no fake reviews.** See above.

---

## 5. Checking the work

After any change to metadata or structured data:

```sh
npm run build && npx next start -p 3000
curl -s localhost:3000 | grep -o '<title>[^<]*'
curl -s localhost:3000 | grep -o 'rel="canonical" href="[^"]*"'
curl -s localhost:3000/robots.txt
curl -s localhost:3000/sitemap.xml
```

For the structured data, paste the deployed URL into
`search.google.com/test/rich-results`. It will list `WebSite`, `Organization`,
`VideoGame` and `FAQPage`, and it is the only opinion that counts.
