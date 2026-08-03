import "server-only";

import type { NextRequest } from "next/server";

import { callerKey, throttle } from "@/lib/auth/throttle";

/**
 * Rate limiting for the three AI routes.
 *
 * A thin wrapper over `lib/auth/throttle.ts` rather than a second mechanism:
 * that module already solves the hard parts — an atomic claim in Postgres so
 * concurrent serverless instances cannot each grant the same slot, and a bucket
 * key that is an HMAC of the address rather than the address itself, because
 * 0001 §9.6 forbids putting an IP in this schema. Both apply here unchanged.
 *
 * Two buckets are charged per call:
 *
 *   · per address — stops one caller draining the day for everyone else.
 *   · a single global daily bucket — the wallet's limit. Its key is a literal,
 *     so every caller in the world shares it, which is exactly the point:
 *     "hard cap per day" is a budget promise and a budget has no per-user view.
 *
 * Like the auth throttle this FAILS OPEN when there is no service role key,
 * because without one there is no shared counter to consult. A local deploy
 * therefore has no cap — stated plainly in docs/AI-SETUP.md, since a limit you
 * assume you have is worse than one you know you do not.
 */

export interface AiThrottle {
  allowed: boolean;
  /** True when the DAILY ceiling is what stopped it, not the per-caller one. */
  daily: boolean;
}

export async function claimAiCall(
  req: NextRequest,
  feature: "tts" | "stt" | "pitch" | "panel" | "debrief" | "brief" | "coach",
  limits: { perIp: number; perDay: number },
): Promise<AiThrottle> {
  const verdict = await throttle([
    { bucket: `ai:${feature}:ip`, key: callerKey(req), limit: limits.perIp },
    {
      bucket: `ai:${feature}:day`,
      key: "global",
      limit: limits.perDay,
      windowMinutes: 24 * 60,
    },
  ]);

  return {
    allowed: verdict.allowed,
    daily: verdict.hit === `ai:${feature}:day`,
  };
}
