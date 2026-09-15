import { NextResponse } from "next/server";

/**
 * GET /api/version — which build is actually answering requests right now.
 *
 * The remote shell means a web deploy IS an app release (docs/APP.md): the
 * binary loads whatever novuspitch.com happens to be serving, live. That cuts
 * both ways — a session that has been open since before the last deploy is
 * still running the JS it loaded at launch, and nothing tells it the ground
 * moved. `lib/native/update.ts` polls this route to notice.
 *
 * `VERCEL_GIT_COMMIT_SHA` is set automatically on every Vercel deployment and
 * changes on every one; reading it here — a dynamic route, so this always
 * reflects the build currently serving traffic, never a cached answer from
 * whichever build a CDN edge last saw — is the whole mechanism. Falls back to
 * the package version for a non-Vercel deploy or a local dev server, where
 * "did the build change" is not a question worth answering precisely.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.npm_package_version ?? "dev";
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store" } },
  );
}
