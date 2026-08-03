import { NextResponse } from "next/server";

import {
  DEEPGRAM_API_KEY,
  DEEPGRAM_MODEL,
  ELEVENLABS_API_KEY,
  ELEVENLABS_MODEL,
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL,
} from "@/lib/ai/server/providers";

/**
 * GET /api/ai — all three providers, one URL, from anything that can open one.
 *
 * The banner in components/AiStatusBanner.tsx answers "is the app reaching the
 * server". This answers the other half — "does the server have working keys" —
 * and it exists as a separate surface because those two failures need different
 * fixes and look identical from the sofa. A phone with no console can open this
 * in its browser; a laptop can curl it; neither needs a redeploy to learn
 * anything.
 *
 * ── What it deliberately does not say ──────────────────────────────────────
 *
 * No key material, not even a prefix or a length. Only whether each variable is
 * set, whether the provider accepted it, and the provider's own error slug when
 * it did not. That is everything needed to act and nothing worth stealing.
 *
 * ── Why it is safe to leave public ─────────────────────────────────────────
 *
 * It costs one cheap authenticated GET per provider, cached for a minute across
 * all callers, so hammering it cannot run up a bill or a rate limit. The
 * information it exposes — that this deploy has an ElevenLabs key — is already
 * observable by anyone who listens to whether the sharks have good voices.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProviderStatus {
  /** The variable that turns this on. */
  key: string;
  configured: boolean;
  /** Whether the provider accepted the key just now. Null when not configured. */
  ok: boolean | null;
  http?: number;
  /** Working, but not fully: the feature runs on a lesser path than intended. */
  degraded?: boolean;
  /** The provider's own machine-readable reason, when it sent one. */
  reason?: string;
  message?: string;
  detail?: string;
  model?: string;
}

let cached: { at: number; body: Record<string, unknown> } | null = null;
/** A minute. Long enough that this cannot be used to generate load, short
 *  enough that fixing a key in a dashboard shows up here on the next refresh. */
const TTL_MS = 60_000;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.body, {
      headers: { "cache-control": "no-store", "x-novus-cached": "1" },
    });
  }

  const [voice, transcription, verdict] = await Promise.all([
    checkElevenLabs(),
    checkDeepgram(),
    checkOpenRouter(),
  ]);

  const providers = { voice, transcription, verdict };
  const configured = Object.values(providers).filter((p) => p.configured).length;
  const working = Object.values(providers).filter((p) => p.ok === true).length;
  const degraded = Object.values(providers).filter((p) => p.degraded).length;

  const body = {
    // The one-line answer, so the common case needs no interpretation.
    summary:
      configured === 0
        ? "No AI keys are set on this deploy. All three features are using their local fallbacks, which is a supported state."
        : working === configured
          ? degraded > 0
            ? `All ${working} configured provider(s) are answering, but ${degraded} is running degraded — see below.`
            : `All ${working} configured provider(s) are answering.`
          : `${configured - working} of ${configured} configured provider(s) are FAILING — see below.`,
    providers,
    // Named so an operator reading this knows where the other half of the
    // picture lives, without having to already know.
    clientSide:
      "This is the server. To see whether the APP can reach it, look at the on-screen banner, or run window.__novusAi() in a browser console.",
  };

  cached = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}

async function checkElevenLabs(): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    key: "ELEVENLABS_API_KEY",
    configured: Boolean(ELEVENLABS_API_KEY),
    ok: null,
    model: ELEVENLABS_MODEL,
  };
  if (!base.configured) return { ...base, detail: "Not set — the panel uses the browser voice." };

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const raw = (await res.json()) as { voices?: unknown[] };
      const count = raw.voices?.length ?? 0;
      return {
        ...base,
        ok: count > 0,
        http: 200,
        detail:
          count > 0
            ? `${count} voice(s) on the account.`
            : "The key works but the account has no voices on it.",
      };
    }
    const { reason, message } = await elevenDetail(res);

    // Listing and speaking are separate permissions, so a failed list does NOT
    // settle whether the game has a voice — and saying "FAILING" while the
    // sharks are audibly speaking is precisely the false alarm this endpoint
    // exists to prevent. A diagnostic that cries wolf gets ignored, and then
    // the next real failure is invisible again. So ask the question that
    // actually decides it: two characters of speech against a premade voice.
    const speaks = await canSynthesise();

    return {
      ...base,
      ok: speaks,
      degraded: speaks,
      http: res.status,
      reason,
      message,
      // HTTP 401 alone covers four unrelated problems with four different
      // fixes, which is exactly why this field is not just the status code.
      detail: speaks
        ? "The panel HAS a voice — synthesis works and /api/tts is using a premade voice. What is missing is casting: without voices_read it cannot read your account, so every shark shares one voice instead of getting their own. Enable voices_read on the key to fix that."
        : reason === "missing_permissions"
          ? "The key is valid but cannot list voices OR synthesise speech. Enable both voices_read and text_to_speech on it."
          : reason === "detected_unusual_activity"
            ? "ElevenLabs has flagged this account — free tiers get this from VPN and cloud IPs. It needs a paid plan or an appeal to them."
            : reason === "quota_exceeded"
              ? "The character quota for this billing period is spent."
              : "The key was rejected. Re-copy it, and check the variable NAME for a typo too.",
    };
  } catch (err) {
    return { ...base, ok: false, detail: reachError(err) };
  }
}

/**
 * Can this key make sound at all?
 *
 * Two characters against a premade voice — the same fallback /api/tts uses when
 * it cannot read the account — so the answer costs effectively nothing and is
 * the one that matters. Everything else about ElevenLabs is casting.
 */
async function canSynthesise(): Promise<boolean> {
  try {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({ text: "ok", model_id: ELEVENLABS_MODEL }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function checkDeepgram(): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    key: "DEEPGRAM_API_KEY",
    configured: Boolean(DEEPGRAM_API_KEY),
    ok: null,
    model: DEEPGRAM_MODEL,
  };
  if (!base.configured) {
    return { ...base, detail: "Not set — the browser transcribes, or the player types." };
  }

  try {
    // The cheapest authenticated read Deepgram has. Deliberately not a
    // transcription: this must not cost audio minutes to answer.
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    return {
      ...base,
      ok: res.ok,
      http: res.status,
      detail: res.ok
        ? "Key accepted."
        : res.status === 401 || res.status === 403
          ? "The key was rejected. Re-copy it from console.deepgram.com → API keys."
          : `Deepgram answered ${res.status}.`,
    };
  } catch (err) {
    return { ...base, ok: false, detail: reachError(err) };
  }
}

async function checkOpenRouter(): Promise<ProviderStatus> {
  const base: ProviderStatus = {
    key: "OPENROUTER_API_KEY",
    configured: Boolean(OPENROUTER_API_KEY),
    ok: null,
    model: OPENROUTER_MODEL,
  };
  if (!base.configured) {
    return { ...base, detail: "Not set — the offline resolver judges every call." };
  }

  try {
    // Credit and identity in one call, and it costs no tokens.
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return {
        ...base,
        ok: false,
        http: res.status,
        detail:
          res.status === 401
            ? "The key was rejected. Re-copy it from openrouter.ai → Keys."
            : `OpenRouter answered ${res.status}.`,
      };
    }
    const raw = (await res.json()) as {
      data?: { limit_remaining?: number | null; usage?: number };
    };
    const remaining = raw.data?.limit_remaining;
    // A valid key with no credit fails at the first cold call and nowhere
    // earlier, which is a miserable way to find out.
    const broke = typeof remaining === "number" && remaining <= 0;
    return {
      ...base,
      ok: !broke,
      http: 200,
      detail: broke
        ? "The key is valid but the account has no credit left. Cold calls will fall back to the offline resolver."
        : "Key accepted.",
    };
  } catch (err) {
    return { ...base, ok: false, detail: reachError(err) };
  }
}

async function elevenDetail(res: Response): Promise<{ reason?: string; message?: string }> {
  try {
    const body = (await res.json()) as { detail?: { status?: string; message?: string } | string };
    if (typeof body?.detail === "string") return { message: body.detail.slice(0, 200) };
    return {
      reason: body?.detail?.status,
      message: body?.detail?.message?.slice(0, 200),
    };
  } catch {
    return {};
  }
}

function reachError(err: unknown): string {
  const message = String((err as Error)?.message ?? err).slice(0, 160);
  return `Could not reach the provider at all: ${message}. That is this server's network, not your key.`;
}
