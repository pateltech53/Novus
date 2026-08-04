import "server-only";

import {
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
  timeoutSignal,
} from "./providers";

/**
 * One place that talks to OpenRouter.
 *
 * `app/api/pitch/route.ts` grew its own copy of this fetch, and by the time the
 * panel, the debrief and the brief writer each needed one there would have been
 * four subtly different versions of the same forty lines — four places to fix a
 * header, four places to forget the JSON-fence workaround. So: one caller, and
 * the routes above it decide only what to ask and what shape to demand back.
 *
 * ── What every caller gets for free ────────────────────────────────────────
 *
 * · A hard timeout, so a hung provider cannot hold a serverless invocation
 *   open until it is billed for the wall clock.
 * · Strict JSON-schema response formatting, plus the fence-stripping fallback
 *   for models that wrap their answer in ```json anyway.
 * · The provider's own status passed through rather than flattened to 502,
 *   because `lib/ai/report.ts` reads 401/404/429/501 as four different
 *   problems with four different fixes.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * It never retries. Every feature behind it has a complete local fallback, and
 * a second attempt costs a child several seconds of staring at a spinner to buy
 * a marginally better sentence. Falling through is faster and never worse.
 */

export interface AskResult<T> {
  ok: boolean;
  /** Present when ok. */
  data?: T;
  /** The status to hand back to the client, so its own latching works. */
  status: number;
}

export interface AskOptions {
  system: string;
  /** Sent as one user message. Objects are stringified — models read JSON well. */
  user: unknown;
  /** The JSON Schema the answer must satisfy. */
  schema: Record<string, unknown>;
  /** A name for the schema, which some providers surface in errors. */
  schemaName: string;
  /**
   * Low for anything judged against a rubric, higher where the point is that
   * two runs should not sound the same. Callers pick deliberately.
   */
  temperature: number;
  maxTokens: number;
  /** Override the deploy-wide model for one call. */
  model?: string;
  timeoutMs?: number;
}

/**
 * The ceiling on the user message this caller will send.
 *
 * The per-request rate limit counts REQUESTS, not tokens, so a single counted
 * call carrying a field bloated to hundreds of KB would cost the operator's
 * OpenRouter account 100–1000× the designed per-call spend while staying inside
 * the "hard daily ceiling" the limiter promises. `max_tokens` bounds only the
 * OUTPUT; nothing bounded the input. Every legitimate payload here — a books
 * summary, a metrics object, a capped transcript, a dozen sliced log lines — is
 * a few KB, so this cap is far above any real call and only ever trips on a
 * request built to amplify cost. Tripping it returns a non-2xx, which every
 * caller already reads as "fall back to the local resolver".
 */
const MAX_USER_CHARS = 24_000;

export async function askOpenRouter<T>(opts: AskOptions): Promise<AskResult<T>> {
  if (!OPENROUTER_API_KEY) return { ok: false, status: 501 };

  const userContent = typeof opts.user === "string" ? opts.user : JSON.stringify(opts.user);
  if (userContent.length > MAX_USER_CHARS) {
    // 413, not sent. The caller falls through to its local resolver, which is
    // exactly the right answer for a payload no real client produces.
    return { ok: false, status: 413 };
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        // Attribution, not credentials. Server-to-server only.
        "http-referer": process.env.NEXT_PUBLIC_SITE_URL || "https://www.novuspitch.com",
        "x-title": "Novus",
      },
      body: JSON.stringify({
        model: opts.model || OPENROUTER_MODEL,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: opts.schemaName,
            strict: true,
            schema: opts.schema,
          },
        },
      }),
      signal: timeoutSignal(opts.timeoutMs),
    });

    if (!res.ok) {
      return {
        ok: false,
        status: res.status === 401 || res.status === 429 ? res.status : 502,
      };
    }

    const raw = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = parseJson<T>(raw.choices?.[0]?.message?.content ?? "");
    // A model that answered in prose is a model that ignored the schema. The
    // caller's fallback is guaranteed to be in character; whatever this said is
    // not, so it is discarded rather than shown.
    return parsed ? { ok: true, data: parsed, status: 200 } : { ok: false, status: 502 };
  } catch {
    return { ok: false, status: 502 };
  }
}

/** Models occasionally fence JSON even under a strict schema. */
export function parseJson<T>(content: string): T | null {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Trim a free-text field to something a layout and a budget can both hold. */
export function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
