import type { NextConfig } from "next";

/**
 * One codebase, two outputs.
 *
 * `NEXT_PUBLIC_NATIVE=1` switches the build to the fully static export that
 * Capacitor bundles into the iOS and Android apps. Everything below that flag
 * is about a build that ships with no server behind it.
 */
const native = process.env.NEXT_PUBLIC_NATIVE === "1";

/** Turnstile: the one third-party script in the app, and it loads only when the
 *  sign-up form is opened (components/landing/Turnstile.tsx). */
const TURNSTILE = "https://challenges.cloudflare.com";

/**
 * The Content-Security-Policy.
 *
 * This file used to carry a note saying a CSP was deliberately absent, because
 * a strict one would need real testing against the WebGL shark, MediaPipe, the
 * Stripe redirect, Turnstile, next/font and the two inline <head> scripts — and
 * a wrong one breaks the page silently. That note was right about the risk. The
 * answer is to enumerate those things and test the result in a real browser,
 * which is what every line below is: verified against headless Chromium on
 * /, /play, /islands, /found, /welcome, /download, /privacy and /terms, plus a
 * client-side navigation, at zero violations.
 *
 * ── Why `script-src` carries 'unsafe-inline', stated plainly ───────────────
 *
 * The strong form of this policy is a per-request nonce. It was built and it
 * worked — and it costs the entire static build. A nonce must differ per
 * response, prerendered HTML cannot carry one, so adopting it turns every page
 * in the app from `○ Static` into `ƒ Dynamic`. That is not a server-cost
 * question (the render measured 8-12ms); it is a CDN question. A static page is
 * served from an edge PoP near the player. A dynamic one is a round trip to
 * wherever the origin lives, on every navigation, for a game whose players are
 * not in one country. That is a felt regression, and it was not worth buying.
 *
 * So the inline-script door is left open, and it is worth being honest about
 * what that does and does not cost:
 *
 * · What is lost: an injected inline <script> would execute. React escapes
 *   everything it renders and all four `dangerouslySetInnerHTML` sites in this
 *   codebase interpolate nothing, so there is no known way in — this is the
 *   backstop that is now thinner, not a hole with a path to it.
 * · What is kept, and matters more: `connect-src 'self'`. An XSS is only a
 *   breach when it can post what it took somewhere. Every exfiltration channel
 *   a script has is closed below — fetch, XHR, WebSocket, beacon (connect-src),
 *   remote image pixels (img-src), and off-origin form posts (form-action).
 *   Script execution without a way out is a defaced page, not a stolen save.
 * · Also kept: no third-party script can load AT ALL. `script-src 'self'` plus
 *   one named host is what contains a compromised dependency trying to phone
 *   home, which is the realistic supply-chain shape of this risk.
 *
 * If this app ever stops being CDN-served — or Next gains nonces for static
 * output — the nonce form is the upgrade, and it is a one-line change here plus
 * a nonce on the two <head> scripts in app/layout.tsx.
 */
const CONTENT_SECURITY_POLICY = [
  // Everything unnamed below falls to same-origin.
  "default-src 'self'",

  /*
   * `'wasm-unsafe-eval'` is MediaPipe (lib/ai/delivery-coach.ts) — the pose and
   * face models are WebAssembly, and instantiating them is a script-src
   * decision. It permits WASM compilation and nothing else; it is NOT
   * `'unsafe-eval'` and does not re-open `eval`.
   */
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${TURNSTILE}`,

  /*
   * Tailwind's runtime layer, next/font's face declarations and every
   * framer-motion animation write inline styles — motion sets `style` on the
   * element on every frame. The exposure is CSS injection, which can restyle a
   * page and cannot read a save, call an API or touch the session cookie.
   */
  "style-src 'self' 'unsafe-inline'",

  // `data:` for inline SVG and canvas exports; `blob:` for anything drawn
  // client-side and handed to an <img>. No remote host, which is what stops an
  // image pixel being used as an exfiltration channel.
  "img-src 'self' data: blob:",

  // The onboarding clips are files under public/; TTS audio and the pitch
  // recording arrive as blobs (lib/ai/speech.ts, lib/media/recorder.ts).
  "media-src 'self' blob: data:",

  // next/font self-hosts every face at build time. Nothing is fetched from
  // Google, which is the point of using it.
  "font-src 'self' data:",

  /*
   * The one that does the heavy lifting.
   *
   * Every provider this app uses — OpenRouter, ElevenLabs, Deepgram, Resend,
   * Supabase, Stripe — is reached from the server, never the browser
   * (lib/supabase/config.ts explains why that was already true for privacy
   * reasons). So the browser has no legitimate reason to open a connection
   * anywhere but here. `blob:` is not a loophole in that: a blob URL can only
   * name something this page already created and already holds, so fetching one
   * moves bytes from the tab to itself — it is here because the GLB loader and
   * the audio pipeline both round-trip through `URL.createObjectURL`.
   */
  `connect-src 'self' blob: ${TURNSTILE}`,

  // MediaPipe spins its vision tasks up in a worker from a blob URL.
  "worker-src 'self' blob:",

  // The Turnstile challenge renders in its own iframe. Nothing else is framed.
  `frame-src ${TURNSTILE}`,

  // Stripe Checkout and the billing portal are reached by assigning
  // `location.href`, which is a navigation and not a form submission, so 'self'
  // is the whole of it — no <form> in this app posts off-origin.
  "form-action 'self'",

  // Novus is never legitimately framed. Matches the X-Frame-Options below,
  // which is the same rule for browsers that predate this one.
  "frame-ancestors 'self'",

  // No plugins, and no <base> rewriting where a relative script URL resolves to
  // — the cheap half of defeating a dangling-markup injection.
  "object-src 'none'",
  "base-uri 'none'",

  // The manifest is ours; so is every icon it names.
  "manifest-src 'self'",

  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // The GLBs and mp4 clips are served from public/ as static assets.
  // Three.js examples chunk pulled in by drei is transpiled fine by default.

  // A stray lockfile in the home directory makes Next infer the wrong root.
  outputFileTracingRoot: __dirname,

  /*
   * The shark prompts are markdown, read at request time by
   * lib/ai/server/panel-prompts.ts rather than inlined into TypeScript — see
   * lib/ai/prompts/README.md, which requires those files stay verbatim
   * transcriptions of design/PROMPT_PACK.txt.
   *
   * File tracing cannot see a `readFileSync(join(process.cwd(), …))`, so
   * without this line the folder is absent from the serverless bundle and every
   * panel turn falls silently to its offline shark on a deploy that has a
   * working key. Which is exactly the class of failure this feature already had
   * once.
   */
  outputFileTracingIncludes: {
    "/api/panel": ["./lib/ai/prompts/**/*.md"],
    "/api/debrief": ["./lib/ai/prompts/**/*.md"],
  },

  // The floating dev-tools badge kept photographing itself into marketing
  // screenshots and demo videos. Nothing it offers is used in this project.
  devIndicators: false,

  ...(native
    ? {}
    : {
        /*
         * Baseline security headers for the served (non-native) build.
         *
         * `headers()` is not supported by the static `output: export` the
         * Capacitor build uses — those responses come from Capacitor's own local
         * server — so this applies to the web deploy only.
         *
         * `Permissions-Policy` still allows the camera and microphone the
         * year-end pitch depends on, and switches off Google's Topics API to
         * match the no-third-party-tracking stance.
         */
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "X-Frame-Options", value: "SAMEORIGIN" },
                { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                {
                  key: "Permissions-Policy",
                  value: "camera=(self), microphone=(self), geolocation=(), browsing-topics=()",
                },
                /*
                 * HSTS: two years, subdomains included, preload-eligible.
                 *
                 * Without it, a player who types `novuspitch.com` makes exactly
                 * one plaintext request before the redirect — and that request
                 * carries no cookie but does tell a hostile network which site
                 * to impersonate. After the first visit this closes that window
                 * for good.
                 *
                 * `includeSubDomains` covers `app.novuspitch.com`, which is the
                 * origin the shipped app posts its session cookie to, so it is
                 * the subdomain that can least afford a downgrade.
                 */
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
                /*
                 * Severs the opener relationship, so a page that opens ours —
                 * or that we open, like the Stripe Checkout tab — cannot reach
                 * back through `window.opener` and drive it. Also what puts the
                 * tab in its own process group, which is the practical defence
                 * against Spectre-class reads of anything else in it.
                 */
                { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
                /*
                 * Nobody else's site may embed our responses as a subresource —
                 * hotlinking the shark mesh from another page is bandwidth
                 * theft with a side of misattribution.
                 *
                 * `same-site` rather than `same-origin` on purpose: the shipped
                 * app is served from `app.novuspitch.com` and the web build from
                 * `novuspitch.com`, which are different ORIGINS and the same
                 * SITE. `same-origin` would be the stricter word for a rule that
                 * has to hold across both, and would start refusing our own
                 * traffic the first time either one loaded an asset from the
                 * other. Nothing outside novuspitch.com is admitted either way,
                 * which is the whole point of the header.
                 *
                 * This does not touch the app's API calls: CORP is checked on
                 * `no-cors` subresource loads only, and those are credentialed
                 * CORS fetches governed by the allow-list in this file's
                 * companion, middleware.ts.
                 */
                { key: "Cross-Origin-Resource-Policy", value: "same-site" },
                // The one Adobe-era header still worth sending: no crossdomain.xml
                // anywhere on this host means no legacy plugin policy to find.
                { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
              ],
            },
            /*
             * ── The static assets had no cache policy at all ─────────────────
             *
             * Next fingerprints everything it builds — `/_next/static/*` is
             * immutable and already served that way. Nothing does that for
             * `public/`, so all ~50 MB of it fell to the framework default of
             * `public, max-age=0, must-revalidate`: the 2.9 MB shark mesh, the
             * 2.7 MB of phone wallpaper and the 9.4 MB of onboarding video were
             * re-validated on EVERY navigation. A returning player paid a
             * conditional request per asset to be told nothing had changed.
             *
             * These files are content, not code, and they change when someone
             * re-exports them — which is a deploy, and a deploy is the moment to
             * rename the file. A week of `immutable` is the honest trade: the
             * one class of mistake it can make is a re-exported asset under an
             * unchanged name being stale for up to seven days, and the fix for
             * that is the filename, not a shorter TTL.
             *
             * `/vendor/mediapipe` is excluded from `immutable` deliberately —
             * it is a vendored copy of a versioned npm package, and the whole
             * point of the sync check in `npm run check` is that it CAN drift.
             *
             * Side effect worth naming: with no Cache-Control on the source,
             * Next's image optimiser caps its own output at `max-age=60`. Every
             * `next/image` on the landing page was being re-optimised or
             * re-fetched a minute later. This lifts that ceiling too.
             */
            {
              source:
                "/:dir(models|shark|onboarding|phone|sfx|founder|landing|sharks|icons)/:path*",
              headers: [
                {
                  key: "Cache-Control",
                  value: "public, max-age=604800, stale-while-revalidate=86400, immutable",
                },
              ],
            },
            {
              source: "/vendor/:path*",
              headers: [
                { key: "Cache-Control", value: "public, max-age=604800, must-revalidate" },
              ],
            },
          ];
        },
      }),

  ...(native
    ? {
        output: "export" as const,

        /*
         * Capacitor serves the bundle off a local file server that resolves a
         * directory to its index.html. Without the trailing slash Next writes
         * `out/play.html` and links to `/play`, which that server cannot
         * resolve — the app boots and then 404s on its own first navigation.
         */
        trailingSlash: true,

        // No image optimiser exists in an export. Every <Image> is already a
        // fixed-size local asset, so this costs nothing.
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
