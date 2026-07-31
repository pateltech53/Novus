import type {
  AiAdapter,
  BusinessBrief,
  CoachReport,
  DebriefReport,
  PanelScriptBeat,
  PitchTranscript,
  SharkId,
} from "./types";
import briefsData from "./fixtures/briefs.json";
import panelData from "./fixtures/panel-scripts.json";

/**
 * Stub AI adapter. Returns realistic hardcoded content in the EXACT output
 * shapes of the live prompts (design/PROMPT_PACK.txt), so swapping to a live
 * provider is a one-line change behind the same interface — no UI rework.
 *
 * The camera and microphone are real; only the intelligence is stubbed.
 * Every call runs through a 600–1200ms delay so loading states and the shark's
 * thinking animation get built and tested now.
 */

const LATENCY_MIN = 600;
const LATENCY_MAX = 1200;

function latency(): Promise<void> {
  const ms = LATENCY_MIN + Math.random() * (LATENCY_MAX - LATENCY_MIN);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Tier = "good" | "mid" | "rough";
type Band = "high" | "mid" | "low";

/** Score → which canned tier/band to serve. */
export const tierForScore = (score: number): Tier =>
  score >= 8 ? "good" : score >= 5 ? "mid" : "rough";
export const bandForScore = (score: number): Band =>
  score >= 8 ? "high" : score >= 5 ? "mid" : "low";

let briefCursor = 0;

/** Lazily loaded so a missing fixture surfaces as a clear error, not a blank UI. */
async function loadFixture<T>(name: string): Promise<T> {
  switch (name) {
    case "transcripts":
      return (await import("./fixtures/transcripts.json")).default as T;
    case "coach-reports":
      return (await import("./fixtures/coach-reports.json")).default as T;
    case "debriefs":
      return (await import("./fixtures/debriefs.json")).default as T;
    case "shark-lines":
      return (await import("./fixtures/shark-lines.json")).default as T;
    default:
      throw new Error(`unknown fixture ${name}`);
  }
}

export const stubAi: AiAdapter = {
  async generateBusinessBrief(): Promise<BusinessBrief> {
    await latency();
    const briefs = (briefsData as { briefs: BusinessBrief[] }).briefs;
    const brief = briefs[briefCursor % briefs.length];
    briefCursor += 1;
    return brief;
  },

  /**
   * Canned verbatim transcript WITH fillers and word timestamps. The real STT
   * runs in verbatim mode for the same reason: a clean transcript makes the
   * filler-word UI impossible to build or test.
   */
  async transcribePitch(_audio, durationSeconds): Promise<PitchTranscript> {
    await latency();
    const data = await loadFixture<{ tiers: Record<Tier, PitchTranscript> }>("transcripts");
    // Longer, steadier recordings read as more fluent takes.
    const tier: Tier = durationSeconds >= 75 ? "good" : durationSeconds >= 45 ? "mid" : "rough";
    const base = data.tiers[tier];
    return { ...base, durationSeconds: durationSeconds || base.durationSeconds };
  },

  async scoreLanguage(transcript): Promise<CoachReport> {
    await latency();
    const data = await loadFixture<{ tiers: Record<Tier, CoachReport> }>("coach-reports");
    const fillers = transcript.words.filter((w) => w.filler).length;
    const perMin = transcript.durationSeconds
      ? (fillers / transcript.durationSeconds) * 60
      : 0;
    const tier: Tier = perMin <= 3 ? "good" : perMin <= 7 ? "mid" : "rough";
    return data.tiers[tier];
  },

  async sharkRespond({ shark, score = 6 }): Promise<{ spoken: string }> {
    await latency();
    const lines = await loadFixture<{
      chair: Record<string, string[]>;
      sharks: Record<SharkId, Record<string, string[]>>;
    }>("shark-lines");
    const band = bandForScore(score);
    const key = band === "high" ? "react_high" : band === "mid" ? "react_mid" : "react_low";
    const bank = lines.sharks[shark]?.[key] ?? lines.chair.deliberating;
    return { spoken: bank[Math.floor(Math.random() * bank.length)] };
  },

  /**
   * Scripted panel exchange with offers, counters, and at least one shark
   * going out. Deal amounts are rescaled to the player's actual valuation so
   * the terms mean something inside the run.
   */
  async runPanel({ score, valuation, askUsd }): Promise<PanelScriptBeat[]> {
    await latency();
    const bands = (panelData as { bands: Record<Band, PanelScriptBeat[]> }).bands;
    const script = bands[bandForScore(score)] ?? bands.mid;
    const scale = scaleFactor(script, askUsd || valuation * 0.15);
    return script.map((beat) => rescaleBeat(beat, scale));
  },

  async debrief(): Promise<DebriefReport> {
    await latency();
    const data = await loadFixture<{ bands: Record<Band, DebriefReport> }>("debriefs");
    return data.bands.mid;
  },
};

/** Debrief keyed to the run's actual score band. */
export async function debriefForScore(score: number): Promise<DebriefReport> {
  const data = await loadFixture<{ bands: Record<Band, DebriefReport> }>("debriefs");
  return data.bands[bandForScore(score)];
}

export async function chairLine(
  key:
    | "welcome"
    | "listening"
    | "deliberating"
    | "score_high"
    | "score_mid"
    | "score_low"
    | "year_survived"
    | "respect_up",
): Promise<string> {
  const lines = await loadFixture<{ chair: Record<string, string[]> }>("shark-lines");
  const bank = lines.chair[key] ?? [];
  return bank[Math.floor(Math.random() * bank.length)] ?? "";
}

// ── Deal rescaling ──────────────────────────────────────────────────────────

function scaleFactor(script: PanelScriptBeat[], targetAsk: number): number {
  const amounts = script
    .map((b) => (b.payload as { offer?: { amount_usd?: number } }).offer?.amount_usd)
    .filter((n): n is number => typeof n === "number" && n > 0);
  if (amounts.length === 0 || !targetAsk) return 1;
  const median = amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)];
  const factor = targetAsk / median;
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

function roundMoney(n: number): number {
  if (n >= 1_000_000) return Math.round(n / 50_000) * 50_000;
  if (n >= 100_000) return Math.round(n / 10_000) * 10_000;
  if (n >= 10_000) return Math.round(n / 1_000) * 1_000;
  return Math.max(500, Math.round(n / 100) * 100);
}

function rescaleBeat(beat: PanelScriptBeat, scale: number): PanelScriptBeat {
  if (scale === 1) return beat;
  const payload = beat.payload as { offer?: { amount_usd: number; equity_pct: number; implied_valuation_usd: number } };
  if (!payload.offer || typeof payload.offer.amount_usd !== "number") return beat;
  const amount = roundMoney(payload.offer.amount_usd * scale);
  const equity = payload.offer.equity_pct;
  return {
    ...beat,
    payload: {
      ...payload,
      offer: {
        ...payload.offer,
        amount_usd: amount,
        // Recompute so the arithmetic always ties out (Panel Rulebook rule 3).
        implied_valuation_usd: equity > 0 ? Math.round(amount / (equity / 100)) : 0,
      },
    } as PanelScriptBeat["payload"],
  };
}
