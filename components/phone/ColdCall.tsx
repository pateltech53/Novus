"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import {
  CALL_SECONDS,
  MAX_CALLS_PER_DAY,
  availableCallers,
  callsRemaining,
  judgePitch,
  type Caller,
  type CallOutcome,
} from "@/lib/ai/callers";
import { fmtMoney } from "@/lib/engine/format";
import { S_UNIT } from "@/lib/engine/constants";
import { LiveTranscriber } from "@/lib/ai/transcribe";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";

/**
 * THE ROOM — cold calling, Pro only.
 *
 * Three calls a real day, two minutes each. You pick who to call, they pick up,
 * you pitch, they accept or decline.
 *
 * ── What is deliberately visible, and what is not ──────────────────────────
 *
 * Before you dial you can see who they are, what they invest in, and what they
 * are listening for. That is not an answer key — it is a business card, and
 * knowing your audience is the skill being taught rather than a shortcut around
 * it.
 *
 * What you never see is the bar you have to clear, the cheque size, or your odds.
 * Those resolve after you have spoken, same rule as every decision in the game.
 *
 * ── Brand Law 5, in the one place it is easiest to break ───────────────────
 *
 * This screen transcribes the player's voice and the transcript is most of the
 * grade — WHAT you said, scored on substance and checked against your own books.
 * What is never scored is HOW you said it: not accent, not pitch, not energy, not
 * rhythm. That line is structural, not a promise: `scorePitchContent` cannot
 * reach the delivery figures, which live in a separate function.
 *
 * The transcript is shown on screen while you talk, because grading someone on
 * words they cannot see would be indefensible. The prohibition is also restated
 * in the request body sent to the model (lib/ai/callers.ts) so a future endpoint
 * cannot quietly invent the dimension either.
 *
 * ── Brand Law 4 ────────────────────────────────────────────────────────────
 *
 * Pro unlocks ACCESS to the roster. It never buys a better outcome, a bigger
 * cheque, a fourth call, or a second chance. A Pro player and a free player who
 * both reach Marcus Castellan face exactly the same bar.
 */

type Stage =
  | { kind: "directory" }
  | { kind: "connecting"; caller: Caller }
  | { kind: "live"; caller: Caller }
  | { kind: "judging"; caller: Caller }
  | { kind: "result"; caller: Caller; outcome: CallOutcome };

export function ColdCall() {
  const { run, applyColdCall } = useGame();
  const [stage, setStage] = useState<Stage>({ kind: "directory" });

  if (!run) return null;

  const remaining = callsRemaining(run);
  const roster = availableCallers(run);

  if (!run.pro) return <ProGate />;

  return (
    <div className="px-4 pt-3 pb-6">
      <AnimatePresence mode="wait">
        {stage.kind === "directory" && (
          <Directory
            key="dir"
            roster={roster}
            remaining={remaining}
            onDial={(caller) => setStage({ kind: "connecting", caller })}
          />
        )}
        {stage.kind === "connecting" && (
          <Connecting
            key="conn"
            caller={stage.caller}
            onConnected={() => setStage({ kind: "live", caller: stage.caller })}
          />
        )}
        {stage.kind === "live" && (
          <LiveCall
            key="live"
            caller={stage.caller}
            onDone={async (attempt) => {
              setStage({ kind: "judging", caller: stage.caller });
              const outcome = await judgePitch(attempt, run);
              applyColdCall(stage.caller.id, outcome);
              setStage({ kind: "result", caller: stage.caller, outcome });
            }}
          />
        )}
        {stage.kind === "judging" && <Judging key="judge" caller={stage.caller} />}
        {stage.kind === "result" && (
          <Result
            key="res"
            caller={stage.caller}
            outcome={stage.outcome}
            stage5={run.stage}
            onBack={() => setStage({ kind: "directory" })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Pro gate ────────────────────────────────────────────────────────────────

/**
 * The whole app opened on this screen — a room described in full, behind a
 * sentence saying it was Pro, with nothing on it to press. The description was
 * right and it stays; what it was missing was a door.
 */
function ProGate() {
  const upgrade = useUpgrade();

  return (
    <div className="px-5 py-10 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.1rem] bg-[var(--n-4)]">
        <HandsetGlyph />
      </div>
      <h2 className="mt-4 text-lg font-extrabold tracking-[-0.01em]">The Room</h2>
      <p className="mx-auto mt-2 max-w-[19rem] text-sm leading-snug text-[var(--text-secondary)]">
        A directory of investors, buyers and operators who have never heard of
        you. Three calls a day, two minutes each.
      </p>
      <p className="mx-auto mt-4 max-w-[19rem] text-xs leading-relaxed text-[var(--text-tertiary)]">
        Cold calling requires Pro. Pro opens the door — it does not make anyone
        say yes, and it never buys a bigger cheque.
      </p>

      {/* Prestige, not the action orange: this is drawn inside the in-game
          phone, which is the player's own device and carries its own chrome —
          an orange slab in there would read as part of the fiction. */}
      <button
        type="button"
        onClick={() => upgrade.open("the_room")}
        className="nv-press mx-auto mt-5 h-12 w-full max-w-[19rem] rounded-[var(--radius-pill)] bg-[var(--color-prestige)] text-2xs font-extrabold tracking-[0.14em] text-[var(--on-prestige)]"
      >
        SEE WHAT PRO ADDS
      </button>
    </div>
  );
}

// ── Directory ───────────────────────────────────────────────────────────────

function Directory({
  roster,
  remaining,
  onDial,
}: {
  roster: Caller[];
  remaining: number;
  onDial: (c: Caller) => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-extrabold tracking-[-0.01em]">The Room</h2>
        <span className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
          {remaining} OF {MAX_CALLS_PER_DAY} CALLS LEFT TODAY
        </span>
      </div>
      <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
        Two minutes each. They have not heard of you.
      </p>

      {remaining === 0 && (
        <p className="mt-4 rounded-[var(--radius-row)] bg-[var(--n-3)] px-3 py-2.5 text-xs leading-snug text-[var(--text-secondary)]">
          You are out of calls for today. Three a day is the limit — come back
          tomorrow.
        </p>
      )}

      {roster.length === 0 ? (
        <p className="mt-4 text-xs leading-snug text-[var(--text-secondary)]">
          Nobody in this book takes calls at your stage yet. Build something
          first.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {roster.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={remaining === 0}
                onClick={() => onDial(c)}
                className="nv-press flex w-full items-start gap-3 rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-3 text-left disabled:opacity-45"
              >
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--n-4)] text-xs font-extrabold text-[var(--n-9)]"
                >
                  {c.name
                    .split(" ")
                    .map((p) => p[0])
                    .join("")
                    .slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{c.name}</span>
                  <span className="block truncate text-2xs text-[var(--text-tertiary)]">
                    {c.title} · {c.company}
                  </span>
                  {/* Their business card, not a hint sheet: what they came for. */}
                  <span className="mt-1 block text-2xs leading-snug text-[var(--text-secondary)]">
                    Listening for: {c.wants}
                  </span>
                </span>
                <HandsetGlyph small />
              </button>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

// ── Connecting ──────────────────────────────────────────────────────────────

function Connecting({ caller, onConnected }: { caller: Caller; onConnected: () => void }) {
  useEffect(() => {
    // Long enough to feel like a real line opening, short enough not to waste
    // the player's attention. The call clock does not start until they pick up.
    const t = setTimeout(onConnected, 1500);
    return () => clearTimeout(t);
  }, [onConnected]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="py-12 text-center"
    >
      <motion.div
        className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--n-4)]"
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 1.1, repeat: Infinity }}
      >
        <HandsetGlyph />
      </motion.div>
      <p className="mt-4 text-sm font-bold">{caller.name}</p>
      <p className="mt-0.5 text-2xs text-[var(--text-tertiary)]">Calling…</p>
    </motion.div>
  );
}

// ── The live call ───────────────────────────────────────────────────────────

function LiveCall({
  caller,
  onDone,
}: {
  caller: Caller;
  onDone: (a: { callerId: string; seconds: number; spoken: boolean; transcript?: string }) => void;
}) {
  const [left, setLeft] = useState(CALL_SECONDS);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<"choose" | "speaking" | "typing">("choose");
  const [heard, setHeard] = useState("");
  const [interim, setInterim] = useState("");
  const [sttOk, setSttOk] = useState(true);
  const started = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const scribe = useRef<LiveTranscriber | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const finish = useCallback(
    (spoken: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      const elapsed = started.current ? (Date.now() - started.current) / 1000 : 0;
      // Whatever the transcriber captured, plus anything still mid-sentence.
      const said = scribe.current?.stop().text ?? "";
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      onDone({
        callerId: caller.id,
        seconds: Math.min(CALL_SECONDS, Math.round(elapsed)),
        spoken,
        // The transcript is the pitch. Spoken or typed, the same words go to the
        // same judge — a player who types must not be scored differently from one
        // who talks.
        // Whichever actually has words. A player who spoke AND typed because the
        // mic looked dead must not be punished for the belt and braces.
        transcript: (said.trim() || typed.trim()) || undefined,
      });
    },
    [caller.id, onDone, typed],
  );

  /*
   * Camera and microphone, together, at the moment of use.
   *
   * The camera is a self-view only: it is never recorded, never uploaded, and the
   * tracks are stopped the instant the call ends. It exists because pitching to a
   * face — even your own — is a different act from talking at a phone, and
   * because the Tank already works this way.
   */
  useEffect(() => {
    if (mode !== "speaking") return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" }, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      })
      // A refused camera is not a failed call. The pitch is the words.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Live transcription for the length of the pitch.
  useEffect(() => {
    if (mode !== "speaking") return;
    const s = new LiveTranscriber((text, mid) => {
      setHeard(text);
      setInterim(mid);
    });
    const ok = s.start();
    setSttOk(ok);
    scribe.current = ok ? s : null;
    return () => {
      s.stop();
    };
  }, [mode]);

  useEffect(() => {
    if (mode === "choose") return;
    started.current = Date.now();
    const t = setInterval(() => {
      setLeft((n) => {
        if (n <= 1) {
          clearInterval(t);
          finish(mode === "speaking");
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [mode, finish]);

  const mm = String(Math.floor(left / 60));
  const ss = String(left % 60).padStart(2, "0");
  const urgent = left <= 20;

  /*
   * The escape hatch, and it is not optional.
   *
   * `SpeechRecognition` existing is not the same as it working. Headless Chrome
   * reports it and returns nothing; so do some embedded webviews, and so does
   * Chrome itself when its cloud recognition cannot be reached. Trusting the
   * feature check alone means a player on a school network gets a silent zero and
   * loses one of three daily calls to a transport failure.
   *
   * So the typed box appears whenever the mic has produced nothing after a
   * quarter of the call — either because the browser cannot transcribe, or
   * because it said it could and did not.
   */
  const sttSilent = mode === "speaking" && left <= CALL_SECONDS - 25 && !heard && !interim;
  const showTyping = !sttOk || sttSilent;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{caller.name}</p>
          <p className="truncate text-2xs text-[var(--text-tertiary)]">{caller.title}</p>
        </div>
        <span
          className={`tnum shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${
            urgent ? "bg-[var(--alert)] text-white" : "bg-[var(--n-4)] text-[var(--n-10)]"
          }`}
        >
          {mm}:{ss}
        </span>
      </div>

      <p className="mt-3 rounded-[var(--radius-row)] bg-[var(--n-3)] px-3 py-2.5 text-sm leading-snug">
        &ldquo;{caller.greeting}&rdquo;
      </p>
      <p className="mt-2 text-2xs leading-snug text-[var(--text-tertiary)]">
        Listening for: {caller.wants}
      </p>

      {mode === "choose" && (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={() => setMode("speaking")}
            className="nv-press w-full rounded-[var(--radius-row)] bg-[var(--action)] px-4 py-3.5 text-sm font-extrabold tracking-[0.04em] text-[var(--on-action)]"
          >
            PITCH OUT LOUD
          </button>
          <button
            type="button"
            onClick={() => setMode("typing")}
            className="nv-press w-full rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold"
          >
            I&rsquo;m somewhere quiet — type instead
          </button>
        </div>
      )}

      {mode === "speaking" && (
        <div className="mt-4">
          <div className="flex items-start gap-3">
            {/* Self-view. Not recorded, not uploaded, stopped when the call ends. */}
            <div className="relative h-[4.5rem] w-[3.4rem] shrink-0 overflow-hidden rounded-[0.7rem] bg-[var(--n-4)]">
              <video
                ref={videoRef}
                muted
                playsInline
                aria-hidden="true"
                className="h-full w-full scale-x-[-1] object-cover"
              />
              <span
                aria-hidden="true"
                className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-[var(--alert)]"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-[var(--text-secondary)]">
                They&rsquo;re listening.
              </p>
              <p className="mt-0.5 text-2xs leading-snug text-[var(--text-tertiary)]">
                {showTyping
                  ? "Your mic is not coming through. Type the pitch instead — it is scored on the words either way."
                  : "Nothing here judges how you sound. Say what the business is, what it earns, and what you want."}
              </p>
            </div>
          </div>

          {/* What the judge is actually going to read. Showing it is the honest
              move: a player should never be graded on words they cannot see. */}
          <div className="mt-3 min-h-[4.5rem] rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2.5">
            <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              WHAT THEY HEARD
            </p>
            <p className="mt-1 text-sm leading-snug">
              {heard || interim ? (
                <>
                  {heard}
                  {interim && <span className="text-[var(--text-tertiary)]"> {interim}</span>}
                </>
              ) : (
                <span className="text-[var(--text-tertiary)]">Nothing yet.</span>
              )}
            </p>
          </div>

          {showTyping && (
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              rows={3}
              placeholder="The short version, in writing"
              className="mt-2 w-full resize-none rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2.5 text-sm leading-snug outline-none ring-1 ring-[var(--hairline)] focus:ring-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            />
          )}

          <button
            type="button"
            // `spoken` reports how it was captured, not how it is judged. A typed
            // rescue is still the same pitch through the same scorer.
            onClick={() => finish(!showTyping)}
            className="nv-press mt-3 w-full rounded-[var(--radius-row)] bg-[var(--n-4)] px-4 py-3 text-sm font-extrabold"
          >
            THAT&rsquo;S MY PITCH
          </button>
        </div>
      )}

      {mode === "typing" && (
        <div className="mt-4">
          <textarea
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            rows={5}
            placeholder="Your pitch"
            className="w-full resize-none rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2.5 text-sm leading-snug outline-none ring-1 ring-[var(--hairline)] focus:ring-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
          />
          <button
            type="button"
            onClick={() => finish(false)}
            className="nv-press mt-3 w-full rounded-[var(--radius-row)] bg-[var(--action)] px-4 py-3.5 text-sm font-extrabold tracking-[0.04em] text-[var(--on-action)]"
          >
            SEND IT
          </button>
        </div>
      )}
    </motion.div>
  );
}

function Judging({ caller }: { caller: Caller }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="py-14 text-center"
    >
      <p className="text-sm font-bold">{caller.name}</p>
      <p className="mt-1 text-2xs text-[var(--text-tertiary)]">Thinking about it…</p>
    </motion.div>
  );
}

// ── Result ──────────────────────────────────────────────────────────────────

function Result({
  caller,
  outcome,
  stage5,
  onBack,
}: {
  caller: Caller;
  outcome: CallOutcome;
  stage5: number;
  onBack: () => void;
}) {
  const dollars = outcome.cashS * S_UNIT[stage5 as 1 | 2 | 3 | 4 | 5];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
        {outcome.accepted ? "THEY'RE IN" : "THEY PASSED"}
      </p>
      <h2 className="mt-1 text-lg font-extrabold tracking-[-0.01em]">{caller.name}</h2>
      <p className="mt-3 rounded-[var(--radius-row)] bg-[var(--n-3)] px-3 py-2.5 text-sm leading-snug">
        &ldquo;{outcome.reply}&rdquo;
      </p>

      {outcome.accepted && (
        <dl className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2.5">
            <dt className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              CHEQUE
            </dt>
            <dd className="tnum mt-0.5 text-sm font-extrabold">{fmtMoney(dollars)}</dd>
          </div>
          <div className="rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2.5">
            <dt className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              OWNERSHIP
            </dt>
            <dd className="tnum mt-0.5 text-sm font-extrabold">
              −{outcome.dilutionPct}%
            </dd>
          </div>
        </dl>
      )}

      {/*
        What they made of the pitch itself. Every line here is generated from a
        real check against what was said and what the books show — never padding,
        and never a comment on delivery.
      */}
      {outcome.findings && outcome.findings.length > 0 && (
        <div className="mt-4">
          <p className="text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
            ON THE PITCH ITSELF
          </p>
          <ul className="mt-2 space-y-1.5">
            {outcome.findings
              // Contradictions first: being caught on your own numbers is the
              // most useful thing on this screen.
              .slice()
              .sort((a, b) => a.weight - b.weight)
              .slice(0, 5)
              .map((f, i) => (
                <li key={i} className="flex gap-2 text-2xs leading-snug">
                  <span
                    aria-hidden="true"
                    className={
                      f.kind === "contradiction"
                        ? "text-[var(--alert)]"
                        : f.weight > 0
                          ? "text-[var(--text-secondary)]"
                          : "text-[var(--text-tertiary)]"
                    }
                  >
                    {f.kind === "contradiction" ? "!" : f.weight > 0 ? "+" : "–"}
                  </span>
                  <span
                    className={
                      f.weight > 0 || f.kind === "contradiction"
                        ? "text-[var(--text-secondary)]"
                        : "text-[var(--text-tertiary)]"
                    }
                  >
                    {f.note}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        className="nv-press mt-5 w-full rounded-[var(--radius-row)] bg-[var(--n-4)] px-4 py-3 text-sm font-extrabold"
      >
        BACK TO THE ROOM
      </button>
    </motion.div>
  );
}

function HandsetGlyph({ small }: { small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={small ? "h-4 w-4 shrink-0 text-[var(--text-tertiary)]" : "h-6 w-6"}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6.6 3.5c.9 0 1.7.6 1.9 1.5l.6 2.3c.2.8-.1 1.6-.8 2l-1 .7a10.6 10.6 0 0 0 4.7 4.7l.7-1c.4-.7 1.2-1 2-.8l2.3.6c.9.2 1.5 1 1.5 1.9v2.1c0 1.2-1 2.1-2.2 2C10.1 19 5 13.9 4.5 5.7c-.1-1.2.8-2.2 2-2.2h.1Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
