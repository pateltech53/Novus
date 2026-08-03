import type { NextConfig } from "next";

/**
 * One codebase, two outputs.
 *
 * `NEXT_PUBLIC_NATIVE=1` switches the build to the fully static export that
 * Capacitor bundles into the iOS and Android apps. Everything below that flag
 * is about a build that ships with no server behind it.
 */
const native = process.env.NEXT_PUBLIC_NATIVE === "1";

const nextConfig: NextConfig = {
  // The 23MB GLB and mp4 clips are served from public/ as static assets.
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
