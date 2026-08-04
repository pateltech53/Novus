"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { FounderAvatar } from "@/components/FounderAvatar";
import { TankRoom } from "@/components/panel/TankRoom";
import { AnswerTurn } from "@/components/panel/AnswerTurn";
import { PitchNotes } from "@/components/PitchNotes";
import { TermCoach } from "@/components/TermCoach";
import { CAST, CHAIR, PANEL, type SeatState } from "@/lib/ai/panel-cast";
import { speak, stopSpeaking } from "@/lib/ai/speech";
import { SkipVoice } from "@/components/ui/SkipVoice";
import { stanceQuestionFor } from "@/lib/engine/positioning";
import type { SharkId, SharkOffer } from "@/lib/ai/types";
import { fmtMoney } from "@/lib/engine/format";
import { S_UNIT } from "@/lib/engine/constants";
import { haptic } from "@/lib/haptics";
import { play, startLoop, stopLoop } from "@/lib/sound";
import { requestCapture, stopStream } from "@/lib/media/recorder";
import { getPlayerAsk } from "@/lib/ai/ask";
import { scoreAnswer } from "@/lib/ai/pitch-content";
import { buildPanelContext } from "@/lib/ai/panel-context";
import {
  sharkNegotiateTurn,
  sharkOfferTurn,
  sharkQuestionTurn,
  type PanelSessionState,
} from "@/lib/ai/panel";
import { firstUnseenTerm } from "@/lib/ai/terms";
import { hashString, mulberry32 } from "@/lib/engine/rng";

/**
 * THE PANEL — a room with five faces, and a conversation you are actually in.
 *
 * ── What this used to be ───────────────────────────────────────────────────
 *
 * `stubAi.runPanel()`. Three canned scripts in
 * `lib/ai/fixtures/panel-scripts.json`, picked by score band and replayed word
 * for word, on every deploy, with or without an API key. That single fact is
 * behind almost everything players report about this room:
 *
 *   · the same questions every session — there were only ever three scripts
 *   · questions with nothing to do with your company — written before it existed
 *   · the sharks never reacting to an answer — the answer carried no words at
 *     all (see the header of components/panel/AnswerTurn.tsx)
 *   · feedback quoting a founder who does not exist — the debrief read fixtures
 *
 * Now every turn is a request that carries the whole session: the company brief
 * the founder wrote at founding, the books, the derived deck, the attack points
 * computed from those numbers, the pitch transcript, every question already
 * asked and every answer already given. With no key behind the route, the
 * offline shark in `lib/ai/panel-local.ts` reads the same attack points — so a
 * keyless deploy still gets questions about ITS OWN company, and still never
 * repeats one.
 *
 * ── What did not change, because it was right ──────────────────────────────
 *
 * 1. Nothing advances on a timer. A shark speaks and the room STOPS until the
 *    founder answers, declines, or presses on.
 * 2. The app never writes the player's dialogue. Not one line, not as a
 *    placeholder.
 * 3. Five faces, always visible, with legible state.
 */

/** How many questions the room asks before it talks money. */
/*
 * How many sharks get to ask something, and why this came down from four.
 *
 * Every question is a full round trip: the shark speaks, the player opens a
 * mic and answers, the answer goes back for the next turn. Four of those, then
 * five offers, then a counter, then every bidder coming back at you, is a room
 * that outlasts the attention of the person it is for — the reported feeling
 * was "they keep going back and forth".
 *
 * Three keeps every attack point that actually earned a question (the owners
 * are taken in order, so the cut falls on the filler, not on the substance) and
 * takes a whole answer-and-wait cycle out of the middle of the room.
 */
const QUESTION_COUNT = 3;

/**
 * How many bidders come back after the counter.
 *
 * Countering used to reopen EVERY offer on the table, so a good pitch — five
 * bids — was punished with five more turns before the verdict. The best three
 * offers are the only ones a founder would realistically be choosing between
 * anyway; the rest stand as they are.
 */
const MAX_NEGOTIATIONS = 3;

/**
 * How many times a founder can ask for help on a question in one room.
 *
 * Three questions, three uses would mean help on all of them, which is being
 * carried rather than coached. Two forces a choice about WHICH question is the
 * one you cannot see your way into — and making that choice is most of the
 * skill the room is trying to teach. See `components/panel/AnswerHelp.tsx` for
 * what the help is allowed to contain, which is the more important limit.
 */
const COACH_USES = 2;

type Step =
  | { kind: "chair"; text: string }
  | { kind: "question"; shark: SharkId }
  | { kind: "offer"; shark: SharkId }
  | { kind: "counter" }
  | { kind: "negotiate"; shark: SharkId }
  | { kind: "verdict" };

/** One thing said in the room, in the order it was said. */
interface Beat {
  speaker: SharkId | "chair";
  spoken: string;
  question?: string;
  offer?: SharkOffer | null;
  decision?: string;
  /** The founder's reply to this beat's question, once it exists. */
  answer?: { text: string; spoken: boolean; declined: boolean };
  /** True when this beat came from the offline shark rather than the model. */
  offline?: boolean;
}

export interface TankOutcome {
  beats: Beat[];
  answers: { question: string; answer: string; declined: boolean; askedBy: string }[];
  offers: { shark: SharkId; offer: SharkOffer }[];
  accepted: SharkOffer | null;
  acceptedFrom: SharkId | null;
  /** Investor-only reads, surfaced only in the debrief. */
  privateNotes: { shark: SharkId; note: string }[];
  /** True when no turn in the session reached a model. */
  offline: boolean;
}

export function SharkPanel({
  score,
  pitchTranscript,
  onDone,
}: {
  score: number;
  /** The founder's own pitch, verbatim. The room reads it before it speaks. */
  pitchTranscript: string;
  onDone: (
    dealCashS: number | undefined,
    dealEquityPct: number | undefined,
    outcome: TankOutcome,
  ) => void;
}) {
  const { run } = useGame();

  const [beats, setBeats] = useState<Beat[]>([]);
  const [cursor, setCursor] = useState(0);
  const [thinking, setThinking] = useState(true);
  const [accepted, setAccepted] = useState<{ shark: SharkId; offer: SharkOffer } | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [awaiting, setAwaiting] = useState<{ question: string; shark: SharkId } | null>(null);
  const [countering, setCountering] = useState(false);
  const [seats, setSeats] = useState<Partial<Record<SharkId, SeatState>>>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [term, setTerm] = useState<string | null>(null);
  const [cam, setCam] = useState<MediaStream | null>(null);
  const [helpLeft, setHelpLeft] = useState(COACH_USES);

  const logRef = useRef<HTMLDivElement>(null);
  /** The stance question fires at most once per panel session. */
  const askedStanceRef = useRef(false);
  /** Terms already explained this session, so no card appears twice. */
  const seenTermsRef = useRef<string[]>([]);
  /** The counter the founder made, fed to the negotiate turns. */
  const counterRef = useRef("");
  /** Guards double-taps on ADVANCE while a request is in flight. */
  const busyRef = useRef(false);
  /** Investor-only reads, collected for the debrief and shown nowhere else. */
  const privateNotesRef = useRef<{ shark: SharkId; note: string }[]>([]);
  /** Who asked each answered question, parallel to `session.answers`. */
  const answeredByRef = useRef<string[]>([]);
  /** How many turns actually reached a model. Reported, never player-facing. */
  const liveTurnsRef = useRef(0);
  /**
   * The running order, readable from inside `step` without re-creating it.
   *
   * `step` must walk the SAME list the end-of-round check counts against, and
   * that list grows when the founder counters — negotiate turns are spliced in
   * ahead of the verdict. Reading it through a ref rather than a dependency
   * keeps one source of truth and stops the callback churning on every splice.
   */
  const stepsRef = useRef<Step[]>([]);

  /*
   * Everything the room knows, built once from the run and the pitch. It is a
   * ref rather than state because every turn mutates it (a new answer, a new
   * offer) and the mutation must be visible to the NEXT request immediately —
   * a re-render is not the thing being waited on.
   */
  const sessionRef = useRef<PanelSessionState | null>(null);
  if (run && !sessionRef.current) {
    sessionRef.current = {
      ctx: buildPanelContext({
        run,
        pitchTranscript,
        // You raise to buy runway, not to match a valuation. The floor keeps a
        // pre-revenue garage from asking for nothing at all.
        askFloorUsd: 4 * S_UNIT[run.stage],
        // The founder's own terms, set on the notes card before walking in.
        // The room reads THESE — the sliders are what it reacts to.
        ask: getPlayerAsk(run),
      }),
      pitchTranscript,
      score,
      log: [],
      askedQuestions: [],
      usedAttackIds: [],
      answers: [],
      offersOnTable: [],
    };
  }
  const session = sessionRef.current;

  /**
   * The founder's own books, flattened, for the STUCK? hint.
   *
   * This is the whole reason the hint can be useful without writing anything:
   * it is handed the same figures the player can see on their notes card, so
   * the most it can do is say WHICH of them the question is about. It cannot
   * invent one, because the prompt forbids it and because a number that is not
   * in here is a number the model was never given.
   *
   * Deliberately not included: the attack points, the fair valuation range, and
   * anything else in `ctx` that the sharks know and the founder does not.
   * Handing those over would turn a hint into an answer key.
   */
  const helpFacts = useMemo<Record<string, string | number> | undefined>(() => {
    if (!session) return undefined;
    const c = session.ctx.company;
    const m = session.ctx.metrics;
    return {
      company: c.name,
      industry: c.industry,
      stage: c.stage,
      cash_in_bank: fmtMoney(c.cash),
      monthly_burn: fmtMoney(c.burnMonthly),
      runway_months: c.runwayMonths,
      annual_revenue: fmtMoney(c.revenueAnnual),
      monthly_revenue: fmtMoney(m.mrr),
      gross_margin_pct: c.grossMarginPt,
      net_margin_pct: c.netMarginPt,
      paying_customers: m.payingCustomers,
      revenue_per_customer: fmtMoney(m.arpu),
      monthly_churn_pct: m.monthlyChurnPct,
      retention_90_day_pct: m.retention90Pct,
      growth_yoy_pct: m.growthYoyPct,
      customer_lifetime_value: fmtMoney(m.ltv),
      cost_to_acquire_customer: fmtMoney(m.cac),
      ltv_to_cac_ratio: m.ltvCacRatio,
      market_size: fmtMoney(m.tam),
      market_share_pct: m.marketSharePct,
      employees: c.employees,
      your_equity_pct: c.founderEquityPct,
      valuation: fmtMoney(c.valuation),
      you_are_asking_for: `${fmtMoney(session.ctx.ask.amountUsd)} for ${session.ctx.ask.equityPct}% — which prices the company at ${fmtMoney(session.ctx.ask.impliedValuationUsd)}`,
    };
  }, [session]);

  /**
   * The running order.
   *
   * Who asks is decided by who CARES: the attack points carry an owner, so the
   * shark with the strongest claim on the worst weakness in this company gets
   * the first question. Any seat still unfilled is taken in seat order, seeded
   * on the run so the same company gets the same room twice and two different
   * companies do not.
   */
  const steps = useMemo<Step[]>(() => {
    if (!run || !session) return [];
    const rng = mulberry32(hashString(`tank:${run.seed}:${run.year}`));
    const owners = session.ctx.attackPoints.map((a) => a.owner);
    const questioners: SharkId[] = [];
    for (const id of owners) {
      if (questioners.length >= QUESTION_COUNT) break;
      if (!questioners.includes(id)) questioners.push(id);
    }
    const rest = PANEL.map((p) => p.id).filter((id) => !questioners.includes(id));
    // Shuffle only the leftovers — the ones who earned a question keep their order.
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    while (questioners.length < QUESTION_COUNT && rest.length) questioners.push(rest.shift()!);

    return [
      { kind: "chair", text: chairOpen(run.companyName, session.ctx.company.stage, session.ctx.ask) },
      ...questioners.map((shark) => ({ kind: "question" as const, shark })),
      { kind: "chair", text: "That's the questions. Sharks — money, or no money." },
      // Everyone decides, including the ones who never asked anything.
      ...PANEL.map((p) => ({ kind: "offer" as const, shark: p.id })),
      { kind: "counter" },
      { kind: "verdict" },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.seed, run?.year, session]);

  // The founder's own return feed, small, in the corner — you are on the show.
  /*
   * Video only — and `audio: false` is the fix for the voice pumping up and
   * down, not a nicety. `requestCapture` used to open a mic here regardless,
   * and a mic held open with echo cancellation makes the platform duck and
   * modulate all playback for as long as it lives — the whole panel session.
   * The sharks' voice audibly rose and fell against it. The mic belongs to the
   * answer turn, which opens it per question and closes it after.
   */
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void requestCapture({ video: true, audio: false })
      .then((s) => {
        if (cancelled) return stopStream(s);
        stream = s;
        setCam(s);
      })
      .catch(() => {
        // No camera is a completely normal way to play.
      });
    return () => {
      cancelled = true;
      stopStream(stream);
    };
  }, []);

  // The room has a bed under it and a sting when the sign lands.
  useEffect(() => {
    play("tank-sting");
    startLoop("tank-ambient");
    return () => {
      stopLoop("tank-ambient");
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [beats.length, awaiting, countering]);

  /** Push a beat, speak it, and surface any jargon in it exactly once. */
  const emit = useCallback((beat: Beat) => {
    setBeats((b) => [...b, beat]);
    if (beat.spoken) void speak(beat.spoken, beat.speaker);
    const jargon = firstUnseenTerm(
      `${beat.spoken} ${beat.question ?? ""}`,
      seenTermsRef.current,
    );
    if (jargon) {
      seenTermsRef.current = [...seenTermsRef.current, jargon];
      setTerm(jargon);
    }
  }, []);

  const setSeat = useCallback((shark: SharkId, state: SeatState) => {
    setSeats((s) => {
      const next: Partial<Record<SharkId, SeatState>> = { ...s };
      // Whoever had the floor sits back down, unless they had already folded.
      for (const k of Object.keys(next) as SharkId[]) {
        if (next[k] === "speaking" || next[k] === "listening") next[k] = "idle";
      }
      next[shark] = state;
      return next;
    });
  }, []);

  /**
   * Run one step. Only ever called from a player action — see the header.
   *
   * Each branch talks to `lib/ai/panel.ts`, which prefers the live room and
   * falls to the offline shark. Neither path can hang the round: every failure
   * inside it resolves to a local turn rather than throwing.
   */
  const step = useCallback(async () => {
    if (busyRef.current || !run || !session) return;
    const next = stepsRef.current[cursor];
    if (!next) return;
    busyRef.current = true;
    setThinking(true);
    setCursor((c) => c + 1);

    try {
      switch (next.kind) {
        case "chair": {
          emit({ speaker: "chair", spoken: next.text });
          break;
        }

        case "question": {
          setSeat(next.shark, "speaking");
          const last = session.answers.at(-1);
          const turn = await sharkQuestionTurn({
            shark: next.shark,
            session,
            round: session.askedQuestions.length + 1,
            lastAnswer: last ? { text: last.answer, declined: last.declined } : null,
          });

          /*
           * The FIRST question of the session is stance-aware when the player
           * has a positioning worth interrogating (Addendum B §5.6): an
           * imitator gets the price-war question, a differentiator the
           * one-product question, low clarity the one-sentence test. It
           * replaces the shark's question rather than being added to it,
           * because two questions at once gets one answer.
           */
          let question = turn.questions[0] ?? "";
          if (!askedStanceRef.current) {
            askedStanceRef.current = true;
            const stanceQ = stanceQuestionFor(run);
            if (stanceQ) question = stanceQ;
          }

          if (turn.source === "api") liveTurnsRef.current += 1;
          if (turn.attackId) session.usedAttackIds = [...session.usedAttackIds, turn.attackId];
          if (turn.private_notes) {
            privateNotesRef.current.push({ shark: next.shark, note: turn.private_notes });
          }
          session.log = [
            ...session.log,
            { speaker: next.shark, spoken: turn.spoken, questions: [question] },
          ];
          session.askedQuestions = [...session.askedQuestions, question];

          emit({
            speaker: next.shark,
            spoken: turn.spoken,
            question,
            offline: turn.source === "local",
          });
          setAwaiting({ question, shark: next.shark });
          setSeat(next.shark, "listening");
          break;
        }

        case "offer": {
          setSeat(next.shark, "speaking");
          const turn = await sharkOfferTurn({ shark: next.shark, session });
          if (turn.source === "api") liveTurnsRef.current += 1;
          if (turn.private_notes) {
            privateNotesRef.current.push({ shark: next.shark, note: turn.private_notes });
          }
          if (turn.decision === "out" || !turn.offer) {
            setSeat(next.shark, "out");
            session.offersOnTable = session.offersOnTable.filter((o) => o.shark !== next.shark);
          } else {
            setSeat(next.shark, "bidding");
            session.offersOnTable = [
              ...session.offersOnTable.filter((o) => o.shark !== next.shark),
              { shark: next.shark, offer: turn.offer },
            ];
          }
          session.log = [...session.log, { speaker: next.shark, spoken: turn.spoken }];
          emit({
            speaker: next.shark,
            spoken: turn.spoken,
            offer: turn.offer,
            decision: turn.decision,
            offline: turn.source === "local",
          });
          break;
        }

        case "counter": {
          // Nothing to negotiate against. Skip straight to the verdict rather
          // than asking a founder to counter an empty table.
          if (session.offersOnTable.length === 0) {
            emit({
              speaker: "chair",
              spoken:
                "Nobody bid. That happens, and it is information rather than a verdict — the reasons are in your debrief.",
            });
            break;
          }
          emit({
            speaker: "chair",
            spoken:
              "You have offers. You can take one as it stands, or push back once — name the terms you actually want and see who moves.",
          });
          setCountering(true);
          break;
        }

        case "negotiate": {
          const standing = session.offersOnTable.find((o) => o.shark === next.shark);
          if (!standing) break;
          setSeat(next.shark, "speaking");
          const turn = await sharkNegotiateTurn({
            shark: next.shark,
            session,
            current: standing.offer,
            counter: counterRef.current,
          });
          if (turn.source === "api") liveTurnsRef.current += 1;
          if (turn.private_notes) {
            privateNotesRef.current.push({ shark: next.shark, note: turn.private_notes });
          }
          if (turn.decision === "out") {
            setSeat(next.shark, "out");
            session.offersOnTable = session.offersOnTable.filter((o) => o.shark !== next.shark);
          } else if (turn.offer) {
            setSeat(next.shark, "bidding");
            session.offersOnTable = session.offersOnTable.map((o) =>
              o.shark === next.shark ? { shark: next.shark, offer: turn.offer! } : o,
            );
          }
          session.log = [...session.log, { speaker: next.shark, spoken: turn.spoken }];
          emit({
            speaker: next.shark,
            spoken: turn.spoken,
            offer: turn.offer,
            decision: turn.decision,
            offline: turn.source === "local",
          });
          break;
        }

        case "verdict": {
          emit({ speaker: "chair", spoken: chairClose(session.offersOnTable.length) });
          break;
        }
      }
    } finally {
      setThinking(false);
      busyRef.current = false;
    }
  }, [cursor, run, session, emit, setSeat]);

  // Open on the Chair's framing so the player is not staring at a dead screen,
  // then hand control over and never take it back.
  useEffect(() => {
    if (steps.length && cursor === 0) void step();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps.length]);

  const answered = useCallback(
    (answer: { text: string; spoken: boolean; seconds: number }) => {
      if (!session || !awaiting) return;
      const declined = !answer.text.trim();
      session.answers = [
        ...session.answers,
        { question: awaiting.question, answer: answer.text, declined },
      ];
      answeredByRef.current.push(CAST[awaiting.shark]?.name ?? "The Chair");
      setBeats((b) =>
        b.map((beat, i) =>
          i === b.length - 1
            ? { ...beat, answer: { text: answer.text, spoken: answer.spoken, declined } }
            : beat,
        ),
      );
      setAwaiting(null);
      setMicLevel(0);
      stopSpeaking();
      /*
       * How they took it. The seat reacts to whether an answer arrived and
       * whether it contained anything — never to how long it took or how it
       * sounded. The old version read `seconds >= 6` as engagement, which is
       * speech rhythm reaching an outcome and is exactly what Brand Law 5
       * forbids. Keyboard mash counts as nothing arriving: a seat that leans
       * in for "asdf asdf" tells the player the room isn't reading.
       */
      const substance = scoreAnswer(awaiting.question, answer.text).quality > 0;
      setSeat(awaiting.shark, substance ? "interested" : "skeptical");
      haptic("choice");
    },
    [awaiting, session, setSeat],
  );

  const declined = useCallback(() => {
    if (!session || !awaiting) return;
    session.answers = [
      ...session.answers,
      { question: awaiting.question, answer: "", declined: true },
    ];
    answeredByRef.current.push(CAST[awaiting.shark]?.name ?? "The Chair");
    setBeats((b) =>
      b.map((beat, i) =>
        i === b.length - 1
          ? { ...beat, answer: { text: "", spoken: false, declined: true } }
          : beat,
      ),
    );
    setAwaiting(null);
    setMicLevel(0);
    stopSpeaking();
    // Silence is a legitimate move, and it lands as one.
    setSeat(awaiting.shark, "skeptical");
  }, [awaiting, session, setSeat]);

  /**
   * The founder pushed back.
   *
   * The counter is inserted into the running order rather than resolved here,
   * so it advances on a press like everything else — one negotiate turn per
   * shark still holding an offer.
   */
  const countered = useCallback(
    (answer: { text: string }) => {
      if (!session) return;
      counterRef.current = answer.text;
      setCountering(false);
      // The best offers first, then capped — see MAX_NEGOTIATIONS.
      const bidders = [...session.offersOnTable]
        .sort((a, b) => (b.offer?.amount_usd ?? 0) - (a.offer?.amount_usd ?? 0))
        .slice(0, MAX_NEGOTIATIONS)
        .map((o) => o.shark);
      setNegotiations(bidders);
    },
    [session],
  );

  /** Extra steps spliced in after the counter. */
  const [negotiations, setNegotiations] = useState<SharkId[]>([]);
  const fullSteps = useMemo<Step[]>(() => {
    if (!negotiations.length) return steps;
    const at = steps.findIndex((s) => s.kind === "verdict");
    if (at < 0) return steps;
    return [
      ...steps.slice(0, at),
      ...negotiations.map((shark) => ({ kind: "negotiate" as const, shark })),
      ...steps.slice(at),
    ];
  }, [steps, negotiations]);

  const offers = session?.offersOnTable ?? [];
  stepsRef.current = fullSteps;

  const atEnd = cursor >= fullSteps.length && !awaiting && !countering;

  const accept = useCallback(
    (shark: SharkId, offer: SharkOffer) => {
      if (!run || !session) return;
      setAccepted({ shark, offer });
      haptic("dealSigned");
      play("money");
    },
    [run, session],
  );

  const finish = useCallback(() => {
    if (!run || !session) return;
    const S = S_UNIT[run.stage];
    const outcome: TankOutcome = {
      beats,
      answers: session.answers.map((a, i) => ({
        ...a,
        askedBy: answeredByRef.current[i] ?? "The panel",
      })),
      offers: session.offersOnTable,
      accepted: accepted?.offer ?? null,
      acceptedFrom: accepted?.shark ?? null,
      privateNotes: privateNotesRef.current,
      // True only when NOT ONE turn reached a model. The debrief says so out
      // loud rather than presenting an offline session as a live one.
      offline: liveTurnsRef.current === 0,
    };
    onDone(
      accepted ? accepted.offer.amount_usd / S : 0,
      accepted ? accepted.offer.equity_pct : undefined,
      outcome,
    );
  }, [accepted, beats, onDone, run, session]);

  if (!run || !session) return null;

  // The step that is about to run, for the button's label.
  const upcoming = fullSteps[cursor];

  return (
    /*
     * The set is a fixed header, not a sticky one. `position: sticky` needs the
     * nearest scrolling ancestor to be the one you think it is, and here the
     * page scrolled rather than the section — so the room slid off the top
     * mid-question. A fixed header plus its own scroll region is deterministic.
     */
    <motion.section
      className="flex h-dvh flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mx-auto w-full max-w-lg shrink-0 px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <TankRoom
          states={seats}
          speaking={(lastSpeaker(beats) as SharkId) ?? null}
          micLevel={micLevel}
          cameraStream={cam}
          year={run.year}
        />

        {/* Only on screen while something is actually being said. A player who
            has heard enough can end the line here; opening the microphone ends
            it too, which is the case that was breaking answers. */}
        <div className="mt-2 flex justify-end">
          <SkipVoice />
        </div>

        {/*
          Your notes, in the room.

          The dossier was a button on another screen, so a founder being asked
          for their churn rate had to leave the conversation to look it up.
          Everything here is derived from the same books the sharks are reading,
          which is what makes glancing at it the opposite of cheating: it is
          how a founder stops contradicting their own P&L under pressure.
        */}
        <button
          type="button"
          onClick={() => setNotesOpen((v) => !v)}
          className="nv-gc mt-2 flex w-full items-center justify-between rounded-[var(--radius-card)] px-4 py-2 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]"
        >
          <span>YOUR NOTES · BRIEF, NUMBERS, THE ORDER</span>
          <span>{notesOpen ? "HIDE" : "OPEN"}</span>
        </button>
        {notesOpen && (
          <PitchNotes
            run={run}
            variant="panel"
            defaultTab="numbers"
            className="mt-2"
            /* Locked: the session was built from the ask as the doors opened,
               and the room is already questioning THAT ask. A slider that still
               moved here would change nothing but the player's belief. */
            askControl="locked"
            onTerm={(t) => {
              seenTermsRef.current = [...new Set([...seenTermsRef.current, t])];
              setTerm(t);
            }}
          />
        )}
      </div>

      {/* Everything else scrolls beneath the set, on solid ground — dialogue
          over a photograph is the reason text was unreadable. */}
      <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto bg-[var(--bg)] px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <ol className="mt-5 space-y-3">
          <AnimatePresence initial={false}>
            {beats.map((beat, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <BeatRow beat={beat} />
                {beat.answer && <YourAnswer entry={beat.answer} run={run} />}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>

        {thinking && !awaiting && (
          <p className="mt-4 text-sm text-[var(--text-secondary)]">
            {beats.length === 0
              ? "The room is reading your numbers…"
              : "They're thinking about it…"}
          </p>
        )}

        {/* The room is stopped, waiting on you. */}
        {awaiting && (
          <div className="mt-4">
            <AnswerTurn
              key={awaiting.question}
              question={awaiting.question}
              onAnswer={answered}
              onDecline={declined}
              onLevel={setMicLevel}
              /* Help exists on the QUESTIONS and not on the counter below:
                 a question has a right answer sitting in your own numbers, and
                 a counter is a decision about what you are willing to give up.
                 Nobody can hint you into that one. */
              shark={CAST[awaiting.shark]?.name ?? "an investor"}
              helpFacts={helpFacts}
              helpRemaining={helpLeft}
              onHelpUsed={() => setHelpLeft((n) => n - 1)}
            />
          </div>
        )}

        {countering && (
          <div className="mt-4">
            <AnswerTurn
              key="counter"
              label="YOUR MOVE"
              question="Push back, or take what's on the table. Say the terms you want — a number and a percentage — and they'll tell you if it exists."
              speakLabel="COUNTER OUT LOUD"
              declineLabel="DON'T COUNTER"
              onAnswer={countered}
              onDecline={() => setCountering(false)}
              onLevel={setMicLevel}
            />
          </div>
        )}

        {/* Nothing moves unless the player moves it. */}
        {!awaiting && !countering && !atEnd && !thinking && (
          <button
            type="button"
            onClick={() => void step()}
            className="nv-gc mt-5 h-14 w-full rounded-[var(--radius-card)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
          >
            {nextLabel(upcoming)}
          </button>
        )}

        {atEnd && (
          <motion.div
            className="mt-7"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {offers.length > 0 ? (
              <>
                <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                  ON THE TABLE
                </h2>
                <ul className="mt-2">
                  {offers.map(({ shark, offer }) => (
                    <li key={shark}>
                      <button
                        type="button"
                        disabled={!!accepted}
                        onClick={() => accept(shark, offer)}
                        className={`flex w-full items-center gap-3 border-b border-[var(--hairline)] py-3 text-left disabled:cursor-default ${
                          accepted?.shark === shark ? "" : accepted ? "opacity-35" : ""
                        }`}
                      >
                        <img
                          src={CAST[shark].portrait}
                          alt=""
                          width={44}
                          height={44}
                          className="h-11 w-11 shrink-0 object-contain"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold">{CAST[shark].name}</span>
                          <span className="block text-2xs text-[var(--text-tertiary)]">
                            {offer.deal_type}
                          </span>
                        </span>
                        <span className="tnum shrink-0 text-right">
                          <span className="block text-sm font-bold">
                            {fmtMoney(offer.amount_usd)}
                          </span>
                          {/* Dilution, said out loud: what you give and what you keep. */}
                          <span className="block text-2xs text-[var(--text-tertiary)]">
                            {offer.equity_pct}% · you keep {(100 - offer.equity_pct).toFixed(1)}%
                          </span>
                          {/* And the price that ratio puts on the company —
                              the same division the beat row spells out. */}
                          <span className="block text-2xs text-[var(--text-tertiary)]">
                            says you&rsquo;re worth {fmtMoney(offer.implied_valuation_usd)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="border-l-2 border-[var(--alert)] pl-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                Nobody bid. The year still closes — you just close it alone. The
                debrief has every reason they gave.
              </p>
            )}

            <button
              type="button"
              onClick={finish}
              className="nv-gc mt-6 h-14 w-full rounded-[var(--radius-card)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
            >
              {accepted ? "SIGN IT ▸" : offers.length > 0 ? "TAKE NO DEAL ▸" : "READ THE DEBRIEF ▸"}
            </button>
            {offers.length > 0 && !accepted && (
              <p className="mt-2 text-center text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
                WALKING AWAY IS A REAL ANSWER
              </p>
            )}
          </motion.div>
        )}

        <div ref={logRef} />
      </div>

      {/* The jargon card. Docked above everything, dismissable, once per term. */}
      <TermCoach term={term} onDismiss={() => setTerm(null)} />
    </motion.section>
  );
}

// ── The Chair ───────────────────────────────────────────────────────────────

/*
 * The Chair's lines are written here rather than fetched.
 *
 * They frame the round and take no side, so there is nothing for a model to
 * decide — and spending a request and a second of latency on "welcome to the
 * Tank" would be paying for the least interesting sentence in the session. The
 * company's own name and stage go in, so it is still addressed to this founder.
 *
 * The ask is read into the record with its arithmetic done out loud. The
 * founder chose those two numbers on their notes card; the Chair stating the
 * valuation they imply is how the whole room — including the founder — starts
 * from the same price.
 */
function chairOpen(
  companyName: string,
  stage: string,
  ask: { amountUsd: number; equityPct: number; impliedValuationUsd: number },
): string {
  return `${companyName}, a ${stage.toLowerCase()}-stage company. The ask on the table: ${fmtMoney(ask.amountUsd)} for ${ask.equityPct}% — by your own math, a ${fmtMoney(ask.impliedValuationUsd)} company. The panel has questions, and they've read your numbers. Answer them one at a time. When they're done asking, they'll decide.`;
}

function chairClose(offerCount: number): string {
  if (offerCount === 0) {
    return "No offers. Take the reasons with you — every one of them told you what would have changed their mind.";
  }
  return `${offerCount === 1 ? "One offer" : `${offerCount} offers`} on the table. Choose one, or walk. Walking is a real answer and it costs you nothing but the money.`;
}

// ── Small pieces ────────────────────────────────────────────────────────────

const lastSpeaker = (beats: Beat[]) => beats.at(-1)?.speaker ?? null;

function nextLabel(next?: Step): string {
  if (!next) return "CONTINUE ▸";
  switch (next.kind) {
    case "question":
      return "LET THEM ASK ▸";
    case "offer":
      return "HEAR THEM OUT ▸";
    case "negotiate":
      return "SEE IF THEY MOVE ▸";
    case "counter":
      return "TALK TERMS ▸";
    case "verdict":
      return "CLOSE THE ROUND ▸";
    default:
      return "CONTINUE ▸";
  }
}

/** The founder's own answer, shown in their own portrait. */
function YourAnswer({
  entry,
  run,
}: {
  entry: { text: string; spoken: boolean; declined: boolean };
  run: { avatar: { gender: "male" | "female"; tier: 1 | 2 | 3 | 4 | 5 } };
}) {
  return (
    <div className="mt-2 flex items-start gap-2 pl-3">
      {/* FounderAvatar, not FounderPortrait: the panel seat wears whatever the
          player earned and equipped. Cosmetic only — the sharks judge the books. */}
      <FounderAvatar avatar={run.avatar} size={32} />
      <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
        {/*
          The words, whether they were spoken or typed. This used to say only
          "You answered out loud", because a spoken answer genuinely carried no
          text — the recording was thrown away. It carries text now, so it is
          shown: a founder must be able to see what the room actually heard.
        */}
        {entry.declined || !entry.text
          ? "You said nothing."
          : `"${entry.text}"`}
      </p>
    </div>
  );
}

function BeatRow({ beat }: { beat: Beat }) {
  const cast = beat.speaker === "chair" ? null : CAST[beat.speaker];
  const who = cast ?? { name: CHAIR.name, tag: CHAIR.tag };

  return (
    <div className="flex gap-2.5">
      {cast ? (
        <img
          src={cast.portrait}
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 object-contain"
        />
      ) : (
        <span className="h-10 w-10 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="text-2xs font-bold tracking-[0.04em]">{who.name}</span>
          {who.tag && (
            <span className="text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
              {who.tag.toUpperCase()}
            </span>
          )}
          {beat.decision === "out" && (
            <span className="text-2xs font-bold tracking-[0.12em] text-[var(--alert)]">OUT</span>
          )}
        </p>
        {beat.spoken && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">{beat.spoken}</p>
        )}
        {beat.question && (
          <p className="mt-1.5 text-base font-semibold leading-snug">{beat.question}</p>
        )}
        {beat.offer && (
          <div className="mt-1.5">
            <p className="tnum text-sm font-bold text-[var(--color-prestige)]">
              {fmtMoney(beat.offer.amount_usd)} for {beat.offer.equity_pct}%
            </p>
            {/*
              The offer's arithmetic, done in front of the player. "Post-money"
              as a bare label taught nothing; cheque ÷ slice = what this shark
              just said the whole company is worth, written as the division, is
              the sentence the game exists to make second nature.
            */}
            <p className="tnum mt-0.5 text-2xs leading-snug text-[var(--text-tertiary)]">
              Their math: {fmtMoney(beat.offer.amount_usd)} ÷ {beat.offer.equity_pct}% = they
              believe the company is worth {fmtMoney(beat.offer.implied_valuation_usd)}.
            </p>
          </div>
        )}
        {beat.offer?.conditions && beat.offer.conditions.length > 0 && (
          <ul className="mt-1 space-y-0.5">
            {beat.offer.conditions.map((c) => (
              <li key={c} className="text-2xs leading-snug text-[var(--text-tertiary)]">
                · {c}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
