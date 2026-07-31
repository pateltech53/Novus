"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { FounderAvatar } from "@/components/FounderAvatar";
import { TankRoom } from "@/components/panel/TankRoom";
import { AnswerTurn } from "@/components/panel/AnswerTurn";
import { CAST, CHAIR, type SeatState } from "@/lib/ai/panel-cast";
import { stubAi } from "@/lib/ai/stub";
import { speak, stopSpeaking } from "@/lib/ai/speech";
import { stanceQuestionFor } from "@/lib/engine/positioning";
import type { PanelScriptBeat, SharkId, SharkOffer } from "@/lib/ai/types";
import { fmtMoney } from "@/lib/engine/format";
import { S_UNIT } from "@/lib/engine/constants";
import { haptic } from "@/lib/haptics";
import { play, startLoop, stopLoop } from "@/lib/sound";
import { requestCapture, stopStream } from "@/lib/media/recorder";

/**
 * The Panel — a room with five faces, and a conversation you are actually in.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * 1. Nothing advances on a timer. The old version revealed beats on
 *    `setTimeout(delayMs)`, so the whole round played itself while the player
 *    watched. Now a shark speaks, and the room STOPS. It does not move again
 *    until the founder answers, declines, or presses on. That is the one
 *    feature no competitor has and it was running on autopilot.
 *
 * 2. The app never writes the player's dialogue. Fixture beats attributed to
 *    "founder" are dropped on the way in — the player's words come from the
 *    player's mouth (or keyboard) or they do not exist. There is no exception.
 *
 * 3. Five faces, always visible, with legible state. Who is talking, who leaned
 *    in, who folded — readable without reading.
 */
export function SharkPanel({
  score,
  onDone,
}: {
  score: number;
  onDone: (dealCashS?: number, dealEquityPct?: number) => void;
}) {
  const { run } = useGame();
  const [beats, setBeats] = useState<PanelScriptBeat[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState<SharkOffer | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [seats, setSeats] = useState<Partial<Record<SharkId, SeatState>>>({});
  const [transcript, setTranscript] = useState<
    { question: string; answer: string; spoken: boolean; declined: boolean }[]
  >([]);
  const logRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<MediaStream | null>(null);

  // The founder's own return feed, small, in the corner — you are on the show.
  /** The stance question fires at most once per panel session. */
  const askedStanceRef = useRef(false);

  // Video only: the mic belongs to the answer turn, which opens it per question.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    void requestCapture({ video: true })
      .then((s) => {
        if (cancelled) return stopStream(s);
        stream = s;
        setCam(s);
      })
      .catch(() => {
        // No camera is a completely normal way to play. The corner shows a
        // placeholder and nothing else changes.
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
    return () => stopLoop("tank-ambient");
  }, []);

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    void stubAi
      .runPanel({
        score,
        companyName: run.companyName,
        valuation: run.stats.valuation,
        // You raise to buy runway, not to match a valuation: the ask is a year
        // of burn, or a fifth of the company, whichever is larger.
        askUsd: Math.max(
          run.stats.valuation * 0.2,
          Math.max(0, run.stats.burnMonthly) * 12,
          4 * S_UNIT[run.stage],
        ),
      })
      .then((script) => {
        if (cancelled) return;
        // The app does not speak for the founder. Ever.
        setBeats(script.filter((b) => b.speaker !== "founder"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      stopSpeaking();
    };
  }, [run, score]);

  const shown = beats.slice(0, cursor);
  const current = beats[cursor - 1];
  const atEnd = !loading && cursor >= beats.length;

  /** Advance exactly one beat. Only ever called from a player action. */
  const step = useCallback(() => {
    const next = beats[cursor];
    if (!next) return;
    setCursor((c) => c + 1);

    const payload = next.payload as {
      spoken?: string;
      questions?: string[];
      decision?: string;
      offer?: SharkOffer | null;
    };
    const who = next.speaker as SharkId;

    setSeats((s) => {
      const cleared: Partial<Record<SharkId, SeatState>> = { ...s };
      // Whoever was speaking sits back down, unless they had already folded.
      for (const k of Object.keys(cleared) as SharkId[]) {
        if (cleared[k] === "speaking" || cleared[k] === "listening") cleared[k] = "idle";
      }
      if (CAST[who]) {
        cleared[who] = payload.decision === "out" ? "out" : payload.offer ? "bidding" : "speaking";
      }
      return cleared;
    });

    // Each shark speaks in their own voice — see lib/ai/voices.ts.
    if (payload.spoken) void speak(payload.spoken, next.speaker as SharkId);

    /*
     * A question stops the room. This is the whole point.
     *
     * The FIRST question of the session is stance-aware when the player has a
     * positioning worth interrogating (Addendum B §5.6): an imitator gets the
     * price-war question, a differentiator the one-product question, low clarity
     * the one-sentence test. The scripted question stands in every other case,
     * and the answer flows through the same turn machinery either way.
     */
    let q = payload.questions?.[0];
    if (q && !askedStanceRef.current && run) {
      askedStanceRef.current = true;
      const stanceQ = stanceQuestionFor(run);
      if (stanceQ) q = stanceQ;
    }
    if (q) {
      setAwaiting(q);
      setSeats((s) => (CAST[who] ? { ...s, [who]: "listening" } : s));
    }
  }, [beats, cursor, run]);

  // Open on the Chair's framing so the player is not staring at a dead screen,
  // then hand control over and never take it back.
  useEffect(() => {
    if (!loading && cursor === 0 && beats.length) step();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, beats]);

  useEffect(() => {
    logRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [cursor, awaiting]);

  const answered = useCallback(
    (answer: { text: string; spoken: boolean; seconds: number }) => {
      const who = current?.speaker as SharkId | undefined;
      setTranscript((t) => [
        ...t,
        { question: awaiting ?? "", answer: answer.text, spoken: answer.spoken, declined: false },
      ]);
      setAwaiting(null);
      setMicLevel(0);
      stopSpeaking();
      // How they took it. Until the rubric lands in Phase 3, a real answer
      // reads as engagement and a very short one reads as a dodge — but it is
      // always a reaction to something the player actually did.
      const engaged = answer.spoken ? answer.seconds >= 6 : answer.text.length >= 40;
      if (who && CAST[who]) {
        setSeats((s) => ({ ...s, [who]: engaged ? "interested" : "skeptical" }));
      }
      haptic("choice");
    },
    [awaiting, current],
  );

  const declined = useCallback(() => {
    const who = current?.speaker as SharkId | undefined;
    setTranscript((t) => [
      ...t,
      { question: awaiting ?? "", answer: "", spoken: false, declined: true },
    ]);
    setAwaiting(null);
    setMicLevel(0);
    stopSpeaking();
    // Silence is a legitimate move, and it lands as one.
    if (who && CAST[who]) setSeats((s) => ({ ...s, [who]: "skeptical" }));
  }, [awaiting, current]);

  const offers = useMemo(() => collectOffers(shown), [shown]);

  const accept = useCallback(
    (offer: SharkOffer) => {
      setAccepted(offer);
      haptic("dealSigned");
      play("money");
      const S = run ? S_UNIT[run.stage] : 1000;
      onDone(offer.amount_usd / S, offer.equity_pct);
    },
    [onDone, run],
  );

  if (!run) return null;

  return (
    /*
     * The set is a fixed header, not a sticky one.
     *
     * `position: sticky` needs the nearest scrolling ancestor to be the one you
     * think it is, and here the page scrolled rather than the section — so the
     * room slid off the top mid-question. Splitting the layout into a fixed
     * header plus its own scroll region is deterministic: the tank cannot move.
     */
    <motion.section
      className="flex h-dvh flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="mx-auto w-full max-w-lg shrink-0 px-4 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {/* The set: five sharks behind the desk, under the sign, you in the
            corner. Sticky, because a set does not scroll away mid-question —
            the transcript moves underneath it. */}
        <TankRoom
          states={seats}
          speaking={(current?.speaker as SharkId) ?? null}
          micLevel={micLevel}
          cameraStream={cam}
          year={run.year}
        />
      </div>

      {/* Everything else scrolls beneath the set, on solid ground — dialogue
          over a photograph is the reason text was unreadable. */}
      <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto bg-[var(--bg)] px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">

        {loading && (
          <p className="mt-8 text-sm text-[var(--text-secondary)]">
            The room is reading your numbers…
          </p>
        )}

        {/* What has been said so far, newest last. */}
        <ol className="mt-5 space-y-3">
          <AnimatePresence initial={false}>
            {shown.map((beat, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <Beat beat={beat} />
                {transcript[countQuestionsBefore(shown, i)] &&
                  hasQuestion(beat) && (
                    <YourAnswer entry={transcript[countQuestionsBefore(shown, i)]} run={run} />
                  )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>

        {/* The room is stopped, waiting on you. */}
        {awaiting && (
          <div className="mt-4">
            <AnswerTurn
              question={awaiting}
              onAnswer={answered}
              onDecline={declined}
              onLevel={setMicLevel}
            />
          </div>
        )}

        {/* Nothing moves unless the player moves it. */}
        {!loading && !awaiting && !atEnd && (
          <button
            type="button"
            onClick={step}
            className="nv-press mt-5 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-base font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)]"
          >
            {nextLabel(beats[cursor])}
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
                        onClick={() => accept(offer)}
                        className={`flex w-full items-center gap-3 border-b border-[var(--hairline)] py-3 text-left disabled:cursor-default ${
                          accepted === offer ? "" : accepted ? "opacity-35" : ""
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
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="border-l-2 border-[var(--alert)] pl-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                Nobody bid. The year still closes — you just close it alone.
              </p>
            )}

            <button
              type="button"
              onClick={() => onDone(accepted ? undefined : 0)}
              className="nv-press mt-6 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-base font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)]"
            >
              {accepted ? "SIGN IT ▸" : offers.length > 0 ? "TAKE NO DEAL ▸" : "CLOSE THE YEAR ▸"}
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
    </motion.section>
  );
}

const hasQuestion = (b: PanelScriptBeat) =>
  ((b.payload as { questions?: string[] }).questions?.length ?? 0) > 0;

/** Which answer index belongs to the question at position i. */
const countQuestionsBefore = (list: PanelScriptBeat[], i: number) =>
  list.slice(0, i).filter(hasQuestion).length;

function nextLabel(next?: PanelScriptBeat): string {
  if (!next) return "CONTINUE ▸";
  const p = next.payload as { decision?: string; offer?: unknown };
  if (p.offer) return "HEAR THE OFFER ▸";
  if (p.decision === "out") return "TAKE IT ▸";
  return "LET THEM SPEAK ▸";
}

/** The founder's own answer, shown in their own portrait. */
function YourAnswer({
  entry,
  run,
}: {
  entry: { answer: string; spoken: boolean; declined: boolean };
  run: { avatar: { gender: "male" | "female"; tier: 1 | 2 | 3 | 4 | 5 } };
}) {
  return (
    <div className="mt-2 flex items-start gap-2 pl-3">
      {/* FounderAvatar, not FounderPortrait: the panel seat wears whatever the
          player earned and equipped. Cosmetic only — the sharks judge the books. */}
      <FounderAvatar avatar={run.avatar} size={32} />
      <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
        {entry.declined
          ? "You said nothing."
          : entry.spoken
            ? "You answered out loud."
            : `"${entry.answer}"`}
      </p>
    </div>
  );
}

function Beat({ beat }: { beat: PanelScriptBeat }) {
  const cast = CAST[beat.speaker as SharkId];
  const who = cast ?? { name: CHAIR.name, tag: CHAIR.tag, portrait: null };
  const payload = beat.payload as {
    spoken?: string;
    questions?: string[];
    decision?: string;
    offer?: SharkOffer | null;
  };

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
          {payload.decision === "out" && (
            <span className="text-2xs font-bold tracking-[0.12em] text-[var(--alert)]">OUT</span>
          )}
        </p>
        {payload.spoken && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            {payload.spoken}
          </p>
        )}
        {payload.questions?.map((q) => (
          <p key={q} className="mt-1.5 text-base font-semibold leading-snug">
            {q}
          </p>
        ))}
        {payload.offer && (
          <p className="tnum mt-1.5 text-sm font-bold text-[var(--color-prestige)]">
            {fmtMoney(payload.offer.amount_usd)} for {payload.offer.equity_pct}% ·{" "}
            {fmtMoney(payload.offer.implied_valuation_usd)} post-money
          </p>
        )}
      </div>
    </div>
  );
}

/** Latest standing offer per shark, in the order they landed. */
function collectOffers(beats: PanelScriptBeat[]): { shark: SharkId; offer: SharkOffer }[] {
  const map = new Map<SharkId, SharkOffer | null>();
  for (const beat of beats) {
    if (beat.speaker === "chair") continue;
    const payload = beat.payload as { decision?: string; offer?: SharkOffer | null };
    if (payload.decision === "out") map.set(beat.speaker as SharkId, null);
    else if (payload.offer) map.set(beat.speaker as SharkId, payload.offer);
  }
  return [...map.entries()]
    .filter((entry): entry is [SharkId, SharkOffer] => entry[1] !== null)
    .map(([shark, offer]) => ({ shark, offer }));
}
