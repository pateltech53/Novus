import { apiUrl } from "@/lib/native/origin";
import { reportFallback, reportLive } from "./report";
import type { PanelContext } from "./panel-context";
import { localNegotiateTurn, localOfferTurn, localQuestionTurn } from "./panel-local";
import type {
  PanelLogLine,
  SharkId,
  SharkNegotiateTurn,
  SharkOffer,
  SharkOfferTurn,
  SharkQuestions,
  TableOffer,
} from "./types";

/**
 * ONE TURN IN THE TANK — live if there is a model, real either way.
 *
 * `SharkPanel` asks this for the next thing a shark says. It prefers
 * `/api/panel`, and falls through to `lib/ai/panel-local.ts` on anything at
 * all: no key, a bad key, a rate limit, a dead network, a model that answered
 * in prose. The local room reads the same attack points, so a fallback session
 * is a worse conversation and never an empty one.
 *
 * ── The failure this replaces ──────────────────────────────────────────────
 *
 * The panel previously called `stubAi.runPanel()` and got a canned script. It
 * never once contacted a model, on any deploy, with any key set — which is why
 * setting OPENROUTER_API_KEY changed the cold calls and changed nothing about
 * The Tank. `reportLive`/`reportFallback` are wired here for the same reason
 * they exist everywhere else in this directory: so "the sharks are live" and
 * "the sharks are canned" stop being two states with one appearance.
 */

const ENDPOINT = process.env.NEXT_PUBLIC_PANEL_ENDPOINT || "/api/panel";

/** Latches on a settled refusal so a keyless deploy spends one request a session. */
let panelDown = false;

/** Everything the room has said and been told, carried turn to turn. */
export interface PanelSessionState {
  ctx: PanelContext;
  pitchTranscript: string;
  /** 0..10 for this year's pitch, used by the offline offer maths. */
  score: number;
  /**
   * Public log — what each shark said, in order, and what they DID.
   *
   * The decision and the terms are carried as well as the words because both
   * rooms now read this to talk to each other: a shark cannot say "Viktor's
   * out and I'm not far behind" from a list of sentences alone.
   */
  log: PanelLogLine[];
  /** Every question asked by anybody, so nobody asks it twice. */
  askedQuestions: string[];
  /** Attack-point ids already used, for the offline shark's pool. */
  usedAttackIds: string[];
  answers: { question: string; answer: string; declined: boolean }[];
  offersOnTable: TableOffer[];
}

export type TurnSource = "api" | "local";

export interface QuestionTurn extends SharkQuestions {
  source: TurnSource;
  /** Set by the offline shark so the caller can retire the attack point. */
  attackId?: string;
  /** A glossary key worth explaining alongside this question. */
  term?: string;
}

export async function sharkQuestionTurn(opts: {
  shark: SharkId;
  session: PanelSessionState;
  round: number;
  lastAnswer?: { text: string; declined: boolean; question?: string } | null;
}): Promise<QuestionTurn> {
  const local = (): QuestionTurn => ({
    ...localQuestionTurn({
      shark: opts.shark,
      ctx: opts.session.ctx,
      usedIds: opts.session.usedAttackIds,
      askedQuestions: opts.session.askedQuestions,
      lastAnswer: opts.lastAnswer,
      log: opts.session.log,
      round: opts.round,
    }),
    source: "local",
  });

  const live = await ask<SharkQuestions>({
    phase: "questions",
    shark: opts.shark,
    round: opts.round,
    session: opts.session,
    maxQuestions: 1,
  });
  if (!live || !live.questions?.length) return local();

  /*
   * A live shark that repeated a question anyway.
   *
   * The prompt forbids it and carries the full asked list, but a model is not a
   * guarantee — and one repeated question is the single thing players notice
   * most about this room. So it is checked here rather than hoped for, and a
   * repeat falls to the offline shark, which cannot repeat by construction.
   */
  if (opts.session.askedQuestions.some((q) => similar(q, live.questions[0]))) {
    return local();
  }
  if (echoesTheRoom(opts.session.log, opts.shark, live.spoken)) return local();
  return { ...live, source: "api" };
}

/**
 * A shark saying, in its own mouth, what the shark before it just said.
 *
 * The house rules now require the panel to talk to each other, and the failure
 * mode of asking for that is the one the room already had: five investors
 * reaching one verdict and stating it in one set of words. NOBODY ELSE'S WORDS
 * asks the model not to; this checks. The same reasoning as the repeated
 * question directly above — the prompt carries the whole log and a prompt is
 * still not a guarantee, and a fall to the offline shark cannot echo by
 * construction because its lines are per seat.
 *
 * Compared against the two most recent speakers rather than the whole session:
 * a callback to something said five turns ago is a room with a memory, and only
 * the sentence immediately above yours reads as parroting.
 */
function echoesTheRoom(log: PanelLogLine[], me: SharkId, spoken: string): boolean {
  if (!spoken || spoken.trim().length < 12) return false;
  const recent = log
    .filter((line) => line.speaker !== me && line.spoken)
    .slice(-2);
  return recent.some((line) => similar(line.spoken, spoken));
}

export async function sharkOfferTurn(opts: {
  shark: SharkId;
  session: PanelSessionState;
}): Promise<SharkOfferTurn & { source: TurnSource }> {
  const live = await ask<SharkOfferTurn>({
    phase: "offer",
    shark: opts.shark,
    round: 1,
    session: opts.session,
  });
  // The offer phase runs five seats back to back with no founder in between,
  // so it is where an echo is both most likely and most obvious.
  if (live && live.spoken && !echoesTheRoom(opts.session.log, opts.shark, live.spoken)) {
    return { ...live, source: "api" };
  }
  return {
    ...localOfferTurn({
      shark: opts.shark,
      ctx: opts.session.ctx,
      answers: opts.session.answers,
      offersOnTable: opts.session.offersOnTable,
      log: opts.session.log,
      score: opts.session.score,
    }),
    source: "local",
  };
}

export async function sharkNegotiateTurn(opts: {
  shark: SharkId;
  session: PanelSessionState;
  current: SharkOffer;
  counter: string;
}): Promise<SharkNegotiateTurn & { source: TurnSource }> {
  const live = await ask<SharkNegotiateTurn>({
    phase: "negotiate",
    shark: opts.shark,
    round: 2,
    session: opts.session,
  });
  if (live && live.spoken && !echoesTheRoom(opts.session.log, opts.shark, live.spoken)) {
    return { ...live, source: "api" };
  }
  return {
    ...localNegotiateTurn({
      shark: opts.shark,
      ctx: opts.session.ctx,
      current: opts.current,
      counter: opts.counter,
      offersOnTable: opts.session.offersOnTable,
      log: opts.session.log,
    }),
    source: "local",
  };
}

// ── The transport ───────────────────────────────────────────────────────────

/**
 * How long the room will hold for a shark before the offline one speaks.
 *
 * This request had no client timeout at all, so it inherited the server's
 * `PROVIDER_TIMEOUT_MS` of 60_000 — plus the network on either side. A player
 * at the year gate answers five of these, and any one of them could leave
 * "They're thinking about it…" on screen, under a lit seat, for over a minute.
 * Every one of those seconds looked like a crash, because there is nothing on
 * that screen that moves while it waits.
 *
 * 12 s rather than the 3–4 s a short answer actually takes: this is the point
 * where the app stops believing the provider, not a latency target, and the
 * cost of being wrong is asymmetric. Too short and a working-but-slow model
 * gets replaced by the local shark, which is a quieter and worse product for no
 * reason. Too long and the room hangs. Twelve is roughly 3× the real p99 and
 * still well inside the time a person will sit with a shark thinking.
 *
 * `panelDown` is deliberately NOT set on a timeout. A timeout says this
 * request was slow; the statuses below say the provider will not answer for
 * the rest of the session. Latching the whole session off one slow turn would
 * turn a bad connection into a silent downgrade nobody could recover from.
 */
const PANEL_TIMEOUT_MS = 12_000;

async function ask<T>(opts: {
  phase: "questions" | "offer" | "negotiate";
  shark: SharkId;
  round: number;
  session: PanelSessionState;
  maxQuestions?: number;
}): Promise<T | null> {
  if (!ENDPOINT || panelDown) return null;
  try {
    const res = await fetch(ENDPOINT.startsWith("/") ? apiUrl(ENDPOINT) : ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(PANEL_TIMEOUT_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phase: opts.phase,
        shark: opts.shark,
        round: opts.round,
        maxQuestions: opts.maxQuestions ?? 1,
        pitchTranscript: opts.session.pitchTranscript,
        context: opts.session.ctx,
        log: opts.session.log,
        askedQuestions: opts.session.askedQuestions,
        answers: opts.session.answers,
        offersOnTable: opts.session.offersOnTable.map((o) => ({
          shark: o.shark,
          // The second name, so a shark can see that two of them already teamed
          // up — and so the server can refuse a third joining the same deal.
          with: o.with,
          amount_usd: o.offer.amount_usd,
          equity_pct: o.offer.equity_pct,
          implied_valuation_usd: o.offer.implied_valuation_usd,
          deal_type: o.offer.deal_type,
        })),
      }),
    });
    if (!res.ok) {
      // No key (501), a bad one (401), nothing deployed (404), or the budget
      // spent (429). None of those change before the session ends, so stop
      // asking — one request per session rather than one per spoken line.
      if ([501, 401, 404, 429].includes(res.status)) panelDown = true;
      reportFallback("panel", res.status);
      return null;
    }
    reportLive("panel");
    return (await res.json()) as T;
  } catch {
    reportFallback("panel", 0);
    return null;
  }
}

/**
 * Near-enough-the-same question detection.
 *
 * Deliberately crude: it compares the significant words, so "What's your
 * monthly churn?" and "Tell me your churn rate per month" collide, while two
 * genuinely different questions about churn do not. A false positive costs one
 * offline question; a false negative costs the thing players complain about.
 */
function similar(a: string, b: string): boolean {
  const key = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const A = key(a);
  const B = key(b);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / Math.min(A.size, B.size) >= 0.6;
}
