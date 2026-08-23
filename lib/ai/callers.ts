import type { Industry, RunState } from "@/lib/engine/types";
import type { RoomVoiceKey } from "./voices";
import { hashString, mulberry32 } from "@/lib/engine/rng";
import { apiUrl } from "@/lib/native/origin";
import { reportFallback, reportLive } from "./report";
import { scorePitchContent, type ContentFinding } from "./pitch-content";

/**
 * THE ROOM — the people you can cold call.
 *
 * A directory of operators, angels and buyers who do not know who you are. You
 * get three calls a real day and two minutes each. They listen, and then they
 * accept or they decline.
 *
 * ── Why three a day and two minutes ────────────────────────────────────────
 *
 * Both limits are the mechanic, not friction. A cold call is the only place in
 * Novus where you get to choose your listener, and the whole lesson is that
 * access is scarce and attention is short. If you could grind fifty calls you
 * would brute-force the roster and learn nothing; if you had ten minutes you
 * would ramble. Two minutes is roughly what a real cold pitch gets, and the
 * clock is visible the entire time.
 *
 * The day limit runs on the REAL clock, the same one Today's Market uses — not
 * the fiscal month. Advancing the year does not refill your calls.
 *
 * ── API readiness ──────────────────────────────────────────────────────────
 *
 * `judgePitch()` is the seam. It always sends the transcript. With
 * NEXT_PUBLIC_PITCH_ENDPOINT set, a model reads it and decides; without one, the
 * local resolver below reads it instead. Same input either way — the endpoint
 * changes how well the words are understood, not whether they matter.
 *
 * The local resolver READS WHAT YOU SAID. The voice is transcribed (see
 * transcribe.ts) and scored on substance by pitch-content.ts: did you cover what
 * a pitch has to cover, did you cite anything concrete, did you talk about the
 * thing this particular person said they were listening for — and, best of all,
 * do your claims survive a look at your own books.
 *
 * Brand Law 5 still binds absolutely:
 *
 *   NEVER score accent, pitch of voice, energy level, or speech rhythm.
 *
 * Content is not delivery. What you SAID is fair game and is now most of the
 * grade; how you sounded is not scored anywhere, and the words-per-minute and
 * filler figures live in a separate function that the scorer cannot reach.
 */

export type CallerTemperament =
  | "numbers" // wants unit economics and will interrupt for them
  | "vision" // buys the story, then checks the story later
  | "operator" // has run one, asks what breaks at scale
  | "brand" // cares who you are to customers
  | "sceptic"; // default position is no

export interface Caller {
  id: string;
  name: string;
  title: string;
  company: string;
  /** Industries this person actually writes cheques into. */
  focus: Industry[] | "all";
  temperament: CallerTemperament;
  /** 1 easy … 5 nearly unreachable. Gates the roster by stage. */
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Stage the player must reach before this person will take the call. */
  minStage: number;
  /** What they say when they pick up. Never the player's words — only theirs. */
  greeting: string;
  /** The thing they are listening for. Shown before you dial: this is fair. */
  wants: string;
  /**
   * Who this person sounds like — a key into the VOICES table in
   * lib/ai/voices.ts, always one of the eight `room_*` profiles.
   *
   * Replaces a dead `elevenVoiceId?: string` that had sat here since the
   * directory was written: declared, documented as the TTS hook, and set by
   * none of the twenty entries below, so every caller was silent. A KEY rather
   * than a raw id, because an id here would be a second place the cast is
   * written down and a second place it can go stale — and because the TTS
   * route only honours ids it can already account for, so a hand-typed one
   * would be quietly ignored rather than loudly rejected.
   *
   * Required, not optional. Optional is what let the whole roster ship mute.
   */
  voice: RoomVoiceKey;
}

export const CALLERS: Caller[] = [
  // ── Reachable early ──────────────────────────────────────────────────────
  {
    id: "delgado",
    name: "Rosa Delgado",
    title: "Angel investor",
    company: "Former operator, two exits",
    focus: "all",
    temperament: "operator",
    voice: "room_even",
    difficulty: 1,
    minStage: 1,
    greeting: "You've got me walking to my car, so make it quick.",
    wants: "What you personally do all day.",
  },
  {
    id: "okafor",
    name: "Tunde Okafor",
    title: "Buyer, regional grocery group",
    company: "Merrow & Sons",
    focus: ["FOOD", "PET", "SUSTAIN", "BEAUTY"],
    temperament: "numbers",
    voice: "room_deep",
    difficulty: 2,
    minStage: 1,
    greeting: "I have four hundred SKUs on my desk. Why yours?",
    wants: "Unit cost, and who else already stocks you.",
  },
  {
    id: "lindqvist",
    name: "Annika Lindqvist",
    title: "Marketplace category lead",
    company: "Northgate",
    focus: ["ECOM", "FASHION", "TOYS", "PET"],
    temperament: "numbers",
    voice: "room_calm",
    difficulty: 2,
    minStage: 1,
    greeting: "Go on then. What's the return rate?",
    wants: "Returns, sell-through, and whether you can ship in volume.",
  },
  {
    id: "batra",
    name: "Nikhil Batra",
    title: "Seed investor",
    company: "Halfmoon Capital",
    focus: ["TECH", "EDTECH", "GAMING", "CONTENT"],
    temperament: "vision",
    voice: "room_bright",
    difficulty: 2,
    minStage: 1,
    greeting: "I back people early. Tell me what you're building.",
    wants: "Why this becomes big, not why it works today.",
  },
  {
    id: "moreau",
    name: "Claire Moreau",
    title: "Head of brand partnerships",
    company: "Atlas Group",
    focus: "all",
    temperament: "brand",
    voice: "room_warm",
    difficulty: 2,
    minStage: 1,
    greeting: "I've got two minutes between calls. Who are you to your customers?",
    wants: "What people say about you when you are not in the room.",
  },

  // ── Stage 2+ ─────────────────────────────────────────────────────────────
  {
    id: "haruki",
    name: "Kenji Haruki",
    title: "Managing partner",
    company: "Shorewall Ventures",
    focus: "all",
    temperament: "numbers",
    voice: "room_deep",
    difficulty: 3,
    minStage: 2,
    greeting: "I'll be honest, I almost didn't pick up. Numbers first.",
    wants: "Gross margin and burn, in that order.",
  },
  {
    id: "abara",
    name: "Grace Abara",
    title: "Retail chain founder",
    company: "Kindred Stores",
    focus: ["FOOD", "FASHION", "BEAUTY", "TOYS", "SUSTAIN"],
    temperament: "operator",
    voice: "room_soft",
    difficulty: 3,
    minStage: 2,
    greeting: "I built shops for twenty years. What breaks when you triple?",
    wants: "The operational thing that fails at scale.",
  },
  {
    id: "volkov",
    name: "Mira Volkov",
    title: "Growth investor",
    company: "Pelican Partners",
    focus: ["TECH", "EDTECH", "GAMING"],
    temperament: "numbers",
    voice: "room_calm",
    difficulty: 3,
    minStage: 2,
    greeting: "Retention or nothing. Off you go.",
    wants: "Whether anyone comes back a second time.",
  },
  {
    id: "sorensen",
    name: "Bjorn Sorensen",
    title: "Distribution director",
    company: "Continental Freight",
    focus: ["ECOM", "FOOD", "TOYS", "PET", "FITNESS"],
    temperament: "operator",
    voice: "room_even",
    difficulty: 3,
    minStage: 2,
    greeting: "You want shelf space or you want trucks?",
    wants: "Volume, lead time, and whether your forecast is real.",
  },
  {
    id: "reyes",
    name: "Paloma Reyes",
    title: "Creator-economy investor",
    company: "Loop Fund",
    focus: ["CONTENT", "GAMING", "EDTECH", "FASHION"],
    temperament: "brand",
    voice: "room_warm",
    difficulty: 3,
    minStage: 2,
    greeting: "Everyone has an audience now. Why does yours stay?",
    wants: "Owned distribution — something a platform cannot switch off.",
  },
  {
    id: "chandra",
    name: "Anil Chandra",
    title: "Procurement lead, school district",
    company: "Westbrook USD",
    focus: ["EDTECH"],
    temperament: "sceptic",
    voice: "room_plain",
    difficulty: 3,
    minStage: 2,
    greeting: "I've been sold a lot of software. Show me outcomes.",
    wants: "Completion data, not enrolment data.",
  },

  // ── Stage 3+ ─────────────────────────────────────────────────────────────
  {
    id: "whitlock",
    name: "Eleanor Whitlock",
    title: "Partner",
    company: "Ravenscourt",
    focus: "all",
    temperament: "sceptic",
    voice: "room_calm",
    difficulty: 4,
    minStage: 3,
    greeting: "I decline almost everything. Nothing personal.",
    wants: "One reason this is not a worse version of something funded already.",
  },
  {
    id: "nakamura",
    name: "Sora Nakamura",
    title: "Corp dev",
    company: "Ashford Holdings",
    focus: "all",
    temperament: "numbers",
    voice: "room_crisp",
    difficulty: 4,
    minStage: 3,
    greeting: "We acquire. We don't invest. Still want the two minutes?",
    wants: "Whether you would ever sell, and at what.",
  },
  {
    id: "ferreira",
    name: "Diogo Ferreira",
    title: "Platform partnerships",
    company: "Junction",
    focus: ["TECH", "GAMING", "CONTENT", "ECOM"],
    temperament: "operator",
    voice: "room_plain",
    difficulty: 4,
    minStage: 3,
    greeting: "Integrations are forever. You understand that?",
    wants: "What you give up permanently by building on someone else.",
  },
  {
    id: "adeyemi",
    name: "Folake Adeyemi",
    title: "Impact fund lead",
    company: "第 / Meridian Impact",
    focus: ["SUSTAIN", "EDTECH", "FOOD", "PET"],
    temperament: "sceptic",
    voice: "room_bright",
    difficulty: 4,
    minStage: 3,
    greeting: "Half the decks I read are greenwash. Convince me you're the half that isn't.",
    wants: "A claim you can substantiate, and the paperwork behind it.",
  },
  {
    id: "kaur",
    name: "Simran Kaur",
    title: "Consumer brand builder",
    company: "Ninefold",
    focus: ["BEAUTY", "FASHION", "FITNESS", "FOOD"],
    temperament: "brand",
    voice: "room_warm",
    difficulty: 4,
    minStage: 3,
    greeting: "I only do things I'd put in my own bathroom. Go.",
    wants: "Whether you would use it if you had not made it.",
  },

  // ── Stage 4+ ─────────────────────────────────────────────────────────────
  {
    id: "castellan",
    name: "Marcus Castellan",
    title: "Founding partner",
    company: "Castellan Bruce",
    focus: "all",
    temperament: "sceptic",
    voice: "room_crisp",
    difficulty: 5,
    minStage: 4,
    greeting: "You cold called me. That's either confidence or desperation.",
    wants: "The number you are least proud of.",
  },
  {
    id: "ibarra",
    name: "Valentina Ibarra",
    title: "Late-stage lead",
    company: "Solano Growth",
    focus: "all",
    temperament: "numbers",
    voice: "room_soft",
    difficulty: 5,
    minStage: 4,
    greeting: "At our cheque size I need a business, not a story.",
    wants: "Net revenue retention and a path to profit.",
  },
  {
    id: "eriksson",
    name: "Hugo Eriksson",
    title: "Chair",
    company: "Norsholm Industries",
    focus: "all",
    temperament: "operator",
    voice: "room_even",
    difficulty: 5,
    minStage: 4,
    greeting: "I've closed more companies than I've opened. Talk.",
    wants: "What you would cut first if the money stopped tomorrow.",
  },
  {
    id: "zhao",
    name: "Lena Zhao",
    title: "Sovereign fund director",
    company: "Meridian Reserve",
    focus: "all",
    temperament: "vision",
    voice: "room_soft",
    difficulty: 5,
    minStage: 5,
    greeting: "We hold for twenty years. Where is this in twenty?",
    wants: "A reason this still exists in two decades.",
  },
];

/**
 * The daily ration lives in the engine now — see lib/engine/activities.ts.
 *
 * It was defined here, and the cold-call ACTIVITY in the engine could not
 * import it without the engine depending on lib/ai. So the engine kept its own
 * copy of the number, written as a bare `< 3` with no day comparison, and the
 * two drifted exactly where you would expect: after three calls the activity
 * row stayed hidden the next morning while `callsRemaining` below was already
 * handing out three fresh calls. One definition, re-exported here so every
 * existing caller of this module is unaffected.
 */
export {
  CALL_SECONDS,
  MAX_CALLS_PER_DAY,
  callsRemaining,
  consumeCall,
} from "@/lib/engine/activities";

/**
 * The longest a caller's line may be, matching MAX_CHARS in app/api/tts/route.ts.
 *
 * Not imported from there: that file is a route handler with a Node runtime and
 * an ElevenLabs client in it, and pulling it into the client bundle to read one
 * integer would be the wrong trade. The number is small, stable and named in
 * both places.
 */
const SPOKEN_MAX_CHARS = 800;

export const callerById = (id: string) => CALLERS.find((c) => c.id === id);

/** Who will take a call right now — stage-gated, focus-gated, no repeats. */
export function availableCallers(state: RunState): Caller[] {
  const closed = state.coldCallsClosed ?? [];
  return CALLERS.filter(
    (c) =>
      state.stage >= c.minStage &&
      !closed.includes(c.id) &&
      (c.focus === "all" || c.focus.includes(state.industry)),
  );
}

// ── Resolving a pitch ───────────────────────────────────────────────────────

export interface PitchAttempt {
  callerId: string;
  /** Seconds the player actually spoke. Not how they sounded — how long. */
  seconds: number;
  /** True when the mic was used rather than the keyboard. */
  spoken: boolean;
  /** Player's own words, when there are any. Sent to the model, never scored locally. */
  transcript?: string;
}

export interface CallOutcome {
  accepted: boolean;
  /** Why, in the player's own terms. Empty when the model answered. */
  findings?: ContentFinding[];
  /** What the caller says back. Their words only. */
  reply: string;
  /** Cash in S units when accepted. Zero on a decline. */
  cashS: number;
  /** Ownership handed over, percent. */
  dilutionPct: number;
  respect: number;
  invsent: number;
  /** Whether this came from the model or the local resolver. */
  source: "api" | "local";
}

/**
 * Defaults to this app's own `/api/pitch`. It used to default to undefined, so
 * setting OPENROUTER_API_KEY changed nothing at all: no file read that name and
 * this constant stayed empty, so every call went to the local resolver while
 * looking exactly like a working deploy. Set NEXT_PUBLIC_PITCH_ENDPOINT only to
 * send cold calls somewhere other than here.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_PITCH_ENDPOINT || "/api/pitch";

/** Latches when the endpoint says it has no model behind it, so a deploy
 *  without a key spends one request per session rather than one per call. */
let endpointDown = false;

/**
 * Ask the model, fall back to the local resolver.
 *
 * The local path is not a placeholder to be ripped out — it is the offline
 * behaviour, and it has to be defensible on its own because the endpoint will be
 * down sometimes and some players will never have it.
 */
export async function judgePitch(
  attempt: PitchAttempt,
  state: RunState,
): Promise<CallOutcome> {
  const caller = callerById(attempt.callerId);
  if (!caller) return declined("Wrong number.", "local");

  if (ENDPOINT && !endpointDown) {
    try {
      const res = await fetch(ENDPOINT.startsWith("/") ? apiUrl(ENDPOINT) : ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caller: {
            id: caller.id,
            name: caller.name,
            title: caller.title,
            temperament: caller.temperament,
            wants: caller.wants,
            difficulty: caller.difficulty,
          },
          // The books, so the model can argue with the actual numbers.
          company: {
            name: state.companyName,
            industry: state.industry,
            stage: state.stage,
            year: state.year,
            cash: state.stats.cash,
            burnMonthly: state.stats.burnMonthly,
            revenueAnnual: state.stats.revenueAnnual,
            grossMarginPt: state.stats.grossMarginPt,
            valuation: state.stats.valuation,
            equityPct: state.founderEquityPct,
          },
          pitch: {
            seconds: attempt.seconds,
            spoken: attempt.spoken,
            transcript: attempt.transcript ?? null,
          },
          // Sent so the model cannot invent a scoring dimension we forbid.
          constraints: {
            neverScore: ["accent", "pitch of voice", "energy level", "speech rhythm"],
            scoreOnly: ["substance", "whether the numbers hold up", "answering what the caller asked"],
          },
        }),
      });
      if (res.ok) {
        reportLive("verdict");
        const raw = (await res.json()) as Partial<CallOutcome>;
        return {
          accepted: !!raw.accepted,
          /*
           * Clamped, because this is SPOKEN now.
           *
           * The prompt asks for one to three sentences and `max_tokens` allows
           * about 1,600 characters, and a prompt is a request rather than a
           * bound. /api/tts refuses anything over MAX_CHARS (800) with a 413,
           * and speech.ts reads a non-latching failure as a provider blip and
           * puts the hosted voice on a cooldown — so one chatty model reply
           * would silence the caller's verdict AND the next few lines
           * anywhere in the app. Cut at the source rather than caught at the
           * route: the screen renders this string too, and a reply that is
           * too long to say is too long to read on a phone.
           */
          reply: String(raw.reply ?? caller.greeting).slice(0, SPOKEN_MAX_CHARS),
          cashS: Number(raw.cashS ?? 0),
          dilutionPct: Number(raw.dilutionPct ?? 0),
          respect: Number(raw.respect ?? 0),
          invsent: Number(raw.invsent ?? 0),
          source: "api",
        };
      }
      // No key (501), a bad one (401), or nothing deployed (404). Permanent for
      // this session, so stop asking and let the local resolver take the calls.
      if ([501, 401, 404].includes(res.status)) endpointDown = true;
      reportFallback("verdict", res.status);
    } catch {
      // Fall through. A cold call failing because a fetch failed would be the
      // worst possible way to lose one of three daily attempts.
      reportFallback("verdict", 0);
    }
  }
  return resolveCallLocally(attempt, caller, state);
}

const declined = (reply: string, source: "api" | "local"): CallOutcome => ({
  accepted: false,
  reply,
  cashS: 0,
  dilutionPct: 0,
  respect: 0,
  invsent: 0,
  source,
});

/**
 * The offline resolver.
 *
 * Four inputs, in rough order of weight:
 *
 *   1. WHAT YOU SAID — the transcript, scored on substance by
 *      `scorePitchContent`. This is now the largest single term, which is the
 *      point: a pitch is words, and the words are what an investor hears.
 *   2. Whether your claims survive the books. Handled inside the content scorer,
 *      and a contradiction there is expensive on purpose.
 *   3. The company you actually built, weighted by what this caller came for.
 *   4. Whether you used the time at all.
 *
 * Nothing reads how you sounded.
 *
 * ── Why this is exported ────────────────────────────────────────────────────
 *
 * It is also the LEADERBOARD's resolver. `judgePitch` above prefers the model,
 * and a model's answer is a different sentence every time — so a board that
 * accepted the cash it handed out would rank a run by whether an API key
 * happened to be deployed on the day it was played. That is Brand Law 4 broken
 * by an environment variable.
 *
 * This function is seeded on `coldcall:<seed>:<caller>:<year>:<month>` and
 * reads the transcript through `scorePitchContent`, so it returns the same
 * answer on every machine for every player. `lib/leaderboard/replay.ts` calls
 * it under its exported name; nothing else outside this file should.
 */
export function resolveCallLocally(
  attempt: PitchAttempt,
  caller: Caller,
  state: RunState,
): CallOutcome {
  const s = state.stats;
  const rng = mulberry32(
    hashString(`coldcall:${state.seed}:${caller.id}:${state.year}:${state.month}`),
  );

  // 1 · What you said. 0..10, and the caller's stated interest is passed in so
  //     answering the actual question counts for something.
  const content = scorePitchContent(attempt.transcript ?? "", state, caller.wants);

  // A pitch with nothing in it is a hang-up, whatever the books look like.
  if (content.empty) {
    return {
      ...declined(
        "That's not two minutes of anything. Call me when there's more.",
        "local",
      ),
      findings: content.findings,
    };
  }

  /*
   * 2 · The company, weighted by what this caller actually came for.
   *
   * There used to be a third term here: `seconds / 75`, credit for using the
   * time. It looked like an effort measure and it was actually a rhythm one —
   * two players saying the IDENTICAL words scored differently because one spoke
   * slower, and at 0.1 weight it was bigger than the whole luck band. That is
   * speech rhythm reaching an outcome, which Brand Law 5 exists to prevent. The
   * only thing duration legitimately proved — that you did not hang up after
   * eight seconds — is already caught by the content scorer's empty check
   * above. So the term is gone, not rebalanced.
   */
  const margin = s.grossMarginPt / 100;
  const runwayOk = s.burnMonthly <= 0 || s.cash / Math.max(1, s.burnMonthly) >= 9;
  const substance =
    caller.temperament === "numbers"
      ? 0.55 * margin + 0.3 * (runwayOk ? 1 : 0.25) + 0.15 * (s.csat / 100)
      : caller.temperament === "operator"
        ? 0.45 * (s.qual / 100) + 0.3 * (s.morale / 100) + 0.25 * (runwayOk ? 1 : 0.4)
        : caller.temperament === "brand"
          ? 0.6 * (s.brand / 100) + 0.4 * (s.csat / 100)
          : caller.temperament === "vision"
            ? 0.5 * (s.brand / 100) + 0.3 * margin + 0.2 * (s.qual / 100)
            : 0.5 * margin + 0.5 * (runwayOk ? 1 : 0.15);

  // 3 · Reputation opens doors a good quarter does not.
  const standing = 0.5 + 0.5 * (s.respect / 100) + 0.04 * (s.invsent ?? 0);

  /*
   * The pitch is the biggest term, and it is also a CEILING.
   *
   * As three weighted terms alone, a good enough company on a good enough
   * reputation clears an easy caller's bar with a transcript that said
   * nothing — the words move the total but never enough to decide it. That is
   * the same complaint players made about The Tank, on the other surface that
   * turns a pitch into money, and it has the same answer: the person on the
   * phone is deciding whether to back a founder who just talked to them, and
   * nobody hands over a cheque because the spreadsheet was persuasive on
   * someone's behalf. Pitch nothing and no caller gets past 0.25, which is
   * under every bar in the table; pitch well and the cap stops binding.
   */
  const score = Math.min(
    (content.score / 10) * 0.5 + substance * 0.3 + standing * 0.2,
    0.25 + (content.score / 10) * 0.75,
  );
  const bar = 0.42 + caller.difficulty * 0.07; // 0.49 … 0.77
  const accepted = score + (rng() - 0.5) * 0.06 > bar;

  if (!accepted) {
    return {
      ...declined(declineLine(caller, content, runwayOk), "local"),
      findings: content.findings,
    };
  }

  const cashS = [2, 4, 7, 11, 16][caller.difficulty - 1];
  const dilutionPct = [3, 5, 7, 9, 12][caller.difficulty - 1];
  return {
    accepted: true,
    reply: acceptLine(caller),
    cashS,
    dilutionPct,
    respect: caller.difficulty,
    invsent: 1,
    source: "local",
    findings: content.findings,
  };
}

/**
 * Decline lines name the reason where the resolver actually has one, because a
 * "no" you cannot learn from is just a slot machine. Never a comment on how the
 * player spoke — only on what the company is.
 */
function declineLine(
  caller: Caller,
  content: { findings: ContentFinding[] },
  runwayOk: boolean,
): string {
  // Being caught out on your own numbers outranks every other reason, because it
  // is the one the player can most usefully learn from.
  const caught = content.findings.find((f) => f.kind === "contradiction");
  if (caught) return caught.note;
  const vague = content.findings.find((f) => f.kind === "vague");
  if (vague) return "You didn't give me a single number. I can't act on adjectives.";
  const missedMoney = content.findings.find(
    (f) => f.kind === "missing" && f.note.includes("economics"),
  );
  if (missedMoney) return "You never told me how it makes money. That was the question.";
  if (!runwayOk) return "Your runway is the problem, not your pitch. Fix that and try me again.";
  switch (caller.temperament) {
    case "numbers":
      return "The margin doesn't work yet. Come back when it does.";
    case "operator":
      return "You haven't hit the thing that breaks yet. You will. Call me then.";
    case "brand":
      return "Nobody's asking for this by name. Not yet.";
    case "vision":
      return "I believe you. I don't believe it's big. That's my problem, not yours.";
    case "sceptic":
      return "It's a no. I said it would be.";
  }
}

function acceptLine(caller: Caller): string {
  switch (caller.temperament) {
    case "numbers":
      return "Right. The numbers hold. Send me the paperwork today.";
    case "operator":
      return "You know where it breaks. That's rarer than you think. I'm in.";
    case "brand":
      return "People will want this. I'd like my name near it.";
    case "vision":
      return "I can see the big version. Let's find out if you can build it.";
    case "sceptic":
      return "Well. That's the first yes I've said this month.";
  }
}
