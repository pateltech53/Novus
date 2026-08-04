import { apiUrl } from "@/lib/native/origin";
import type { RunState } from "@/lib/engine/types";
import { PITCH_FRAMEWORK, beatsCovered } from "@/lib/engine/company-brief";
import { deliveryMetrics, scoreAnswer, scorePitchContent } from "./pitch-content";
import { reportFallback, reportLive } from "./report";
import { termsUsed } from "./terms";
import { CAST } from "./panel-cast";
import type { PanelContext } from "./panel-context";
import type { DeliveryCoaching } from "./delivery-coach";
import type {
  BeatCheck,
  DebriefBody,
  DeliveryReview,
  PitchCritique,
  TankDebriefData,
} from "./debrief-types";
import type { SharkId, SharkOffer } from "./types";

/**
 * BUILDING THE DEBRIEF — live where possible, real always.
 *
 * The business half comes from `/api/debrief`; when there is no model, the same
 * half is assembled here out of things that are true: which of the seven beats
 * the transcript actually reached, which claims the books contradict, which
 * questions were dodged, which attack points went untouched, and what each
 * shark said on their way out.
 *
 * The delivery half NEVER comes from a model. It is measured on the device by
 * `lib/ai/delivery-coach.ts` and counted out of the transcript by
 * `deliveryMetrics`, and it is assembled here so that no request anywhere can
 * carry it to something that might weigh it.
 *
 * ── The bug this replaces ──────────────────────────────────────────────────
 *
 * The old feedback card rendered `line_edits` and `top_3_priorities` straight
 * out of `lib/ai/fixtures/coach-reports.json` — a fixture whose quotes include
 * "Hi. I'm sixteen, and I've been running this company for eleven months."
 * Players read feedback about being sixteen because the report was quoting a
 * fixture, not them. Nothing below can produce a quote the founder did not say:
 * every quotation here is sliced out of the actual transcript or the actual
 * answers.
 */

const ENDPOINT = process.env.NEXT_PUBLIC_DEBRIEF_ENDPOINT || "/api/debrief";

let debriefDown = false;

export interface DebriefInput {
  run: RunState;
  ctx: PanelContext;
  pitchTranscript: string;
  pitchDurationSeconds: number;
  delivery: DeliveryCoaching | null;
  answers: { question: string; answer: string; declined: boolean; askedBy: string }[];
  log: { speaker: string; spoken: string; questions?: string[] }[];
  privateNotes: { shark: SharkId; note: string }[];
  offers: { shark: SharkId; offer: SharkOffer }[];
  accepted: SharkOffer | null;
  acceptedFrom: SharkId | null;
  /** True when not one panel turn reached a model. */
  panelWasOffline: boolean;
}

export async function buildDebrief(input: DebriefInput): Promise<TankDebriefData> {
  // Measured here, always, and never sent anywhere.
  const delivery = deliveryReview(input);
  const beats = beatChecks(input.pitchTranscript);
  const terms = termsUsed(input.pitchTranscript);

  const live = await askDebrief(input);
  if (live) {
    return {
      report: live.report,
      critique: live.critique,
      beats,
      delivery,
      termsUsed: terms,
      offline: false,
    };
  }

  return {
    report: localReport(input),
    critique: localCritique(input, beats),
    beats,
    delivery,
    termsUsed: terms,
    offline: true,
  };
}

// ── The live path ───────────────────────────────────────────────────────────

async function askDebrief(
  input: DebriefInput,
): Promise<{ report: DebriefBody; critique: PitchCritique } | null> {
  if (!ENDPOINT || debriefDown) return null;
  try {
    const res = await fetch(ENDPOINT.startsWith("/") ? apiUrl(ENDPOINT) : ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pitchTranscript: input.pitchTranscript,
        context: input.ctx,
        log: input.log,
        answers: input.answers,
        privateNotes: input.privateNotes.map((n) => ({
          shark: CAST[n.shark]?.name ?? n.shark,
          note: n.note,
        })),
        offers: input.offers.map((o) => ({
          shark: CAST[o.shark]?.name ?? o.shark,
          amount_usd: o.offer.amount_usd,
          equity_pct: o.offer.equity_pct,
          implied_valuation_usd: o.offer.implied_valuation_usd,
          deal_type: o.offer.deal_type,
          conditions: o.offer.conditions,
        })),
        outcome: {
          result: input.accepted ? "deal" : input.offers.length > 0 ? "walked_away" : "no_deal",
          accepted_from: input.acceptedFrom ? CAST[input.acceptedFrom]?.name : null,
          accepted_offer: input.accepted,
        },
        // Nothing about delivery. See the header of app/api/debrief/route.ts.
      }),
    });
    if (!res.ok) {
      if ([501, 401, 404, 429].includes(res.status)) debriefDown = true;
      reportFallback("debrief", res.status);
      return null;
    }
    reportLive("debrief");
    const raw = (await res.json()) as { report?: DebriefBody; critique?: PitchCritique };
    if (!raw.report?.headline) return null;
    return {
      report: raw.report,
      critique: {
        missing: raw.critique?.missing ?? [],
        unclear: raw.critique?.unclear ?? [],
        contradictions: [],
        strengths: raw.critique?.strengths ?? [],
        add: raw.critique?.add ?? [],
      },
    };
  } catch {
    reportFallback("debrief", 0);
    return null;
  }
}

// ── The delivery half ───────────────────────────────────────────────────────

/**
 * Eye contact, gestures, posture, pace, fillers, volume — measured, reported,
 * scored nowhere.
 *
 * Players asked for all of it in one place, so it is one section of one report.
 * It is also the section with the loudest label in the whole app, because a
 * teenager reading a number about their eyes directly under a grade must be
 * able to tell at a glance that the number did not produce the grade.
 */
function deliveryReview(input: DebriefInput): DeliveryReview {
  const metrics = deliveryMetrics(input.pitchTranscript, input.pitchDurationSeconds);
  const cam = input.delivery?.camera;
  const vol = input.delivery?.volume;
  const notes: DeliveryReview["notes"] = [];

  // Whatever the on-device coach already concluded, in its own words.
  for (const n of input.delivery?.notes ?? []) {
    notes.push({ topic: labelFor(n.topic), text: n.text, tone: n.tone });
  }

  if (cam && cam.frames > 0) {
    const share = Math.round(cam.eyeContactShare * 100);
    if (!notes.some((n) => n.topic === "EYE CONTACT")) {
      notes.push({
        topic: "EYE CONTACT",
        text:
          share >= 70
            ? `You were on the lens ${share}% of the take. That reads as talking TO someone rather than at them.`
            : `You were on the lens ${share}% of the take, and your longest look away was ${cam.longestAwaySeconds}s. Notes are fine — finish the sentence at the camera.`,
        tone: share >= 60 ? "ok" : "watch",
      });
    }
    if (cam.lookedDownShare > 0.6 && share < 70) {
      notes.push({
        topic: "WHERE YOU LOOKED",
        text: `When you looked away you mostly looked down, which reads as reading rather than thinking. Look up and to the side if you need a second.`,
        tone: "watch",
      });
    }
  }

  const sway = cam?.torsoSway ?? cam?.headSway ?? null;
  if (sway !== null && !notes.some((n) => n.topic === "POSTURE")) {
    notes.push({
      topic: "POSTURE",
      text:
        sway > 1.2
          ? `You drifted about ${sway} ${cam?.torsoSway !== null && cam?.torsoSway !== undefined ? "shoulder-widths" : "head-widths"} across the take. Plant your feet — movement should be a choice, not a sway.`
          : `You held still. That is harder than it looks on camera and it works.`,
      tone: sway > 1.2 ? "watch" : "ok",
    });
  }

  if (cam?.gesturesPerMinute !== null && cam?.gesturesPerMinute !== undefined) {
    notes.push({
      topic: "GESTURES",
      text:
        cam.gesturesPerMinute < 4
          ? `Your hands moved ${Math.round(cam.gesturesPerMinute)} times a minute. Gestures are how a listener knows which parts you mean — let them out.`
          : cam.gesturesPerMinute > 40
            ? `Your hands moved ${Math.round(cam.gesturesPerMinute)} times a minute, which is enough to compete with what you were saying. Save them for the numbers.`
            : `Your hands moved ${Math.round(cam.gesturesPerMinute)} times a minute, which is about right — visible, not distracting.`,
      tone: cam.gesturesPerMinute < 4 || cam.gesturesPerMinute > 40 ? "watch" : "ok",
    });
  }

  if (vol) {
    notes.push({
      topic: "VOLUME",
      text:
        vol.quietShare > 0.25
          ? `You were under the audible floor for ${Math.round(vol.quietShare * 100)}% of the take, with ${vol.dropouts} drop-out${vol.dropouts === 1 ? "" : "s"}. The room cannot judge what it cannot hear.`
          : `You stayed audible the whole way through.`,
      tone: vol.quietShare > 0.25 ? "watch" : "ok",
    });
  }

  /*
   * Pace and fillers. REPORTED, never graded — and the honest caveat travels
   * with the number, because the browser's own recogniser deletes "um" and
   * "uh" before this app ever sees the text. A zero filler count on that path
   * means "unmeasurable", not "clean", and saying so beats showing a figure
   * that reads better than the truth.
   */
  notes.push({
    topic: "PACE",
    text:
      metrics.wpm === 0
        ? "There was not enough transcript to measure your pace."
        : metrics.wpm > 190
          ? `You spoke at about ${metrics.wpm} words a minute. That is fast — the numbers are the part that needs air.`
          : metrics.wpm < 105
            ? `You spoke at about ${metrics.wpm} words a minute. There is room to pick it up without rushing.`
            : `You spoke at about ${metrics.wpm} words a minute, which is a comfortable listening pace.`,
    tone: metrics.wpm > 190 || (metrics.wpm > 0 && metrics.wpm < 105) ? "watch" : "ok",
  });

  notes.push({
    topic: "FILLER WORDS",
    text: metrics.verbatim_capable
      ? `${metrics.filler_count} filler${metrics.filler_count === 1 ? "" : "s"} — ${metrics.fillers_per_minute} a minute${
          metrics.top_fillers.length ? `, mostly "${metrics.top_fillers.join('", "')}"` : ""
        }. Under three a minute stops being noticeable.`
      : metrics.filler_count > 0
        ? `${metrics.filler_count} filler${metrics.filler_count === 1 ? "" : "s"} counted${
            metrics.top_fillers.length ? `, mostly "${metrics.top_fillers.join('", "')}"` : ""
          }. Your browser deletes "um" and "uh" before we see the text, so the real count is higher than this.`
        : `No fillers in the transcript — but your browser strips "um" and "uh" before we see it, so treat this as unmeasured rather than clean.`,
    tone: metrics.fillers_per_minute > 6 ? "watch" : "ok",
  });

  return { coaching: input.delivery ?? null, metrics, notes };
}

const labelFor = (topic: string): string =>
  topic === "eyes"
    ? "EYE CONTACT"
    : topic === "hands"
      ? "GESTURES"
      : topic === "sway"
        ? "POSTURE"
        : "VOLUME";

// ── The seven beats ─────────────────────────────────────────────────────────

function beatChecks(transcript: string): BeatCheck[] {
  const covered = beatsCovered(transcript);
  return PITCH_FRAMEWORK.map((b) => ({
    n: b.n,
    title: b.title,
    covered: covered[b.n],
    fix: b.prompt,
  }));
}

// ── The offline business half ───────────────────────────────────────────────

/**
 * A debrief with no model behind it.
 *
 * It cannot do the pack's best trick — tying a founder's sentence to a shark's
 * private note and to the number on their next offer. What it CAN do is
 * everything that is arithmetic: which beats were missed, which claims the
 * books contradict, which questions were dodged, which weaknesses nobody
 * happened to raise, and whether the accepted deal was inside the fair range.
 * All of that is real feedback, and none of it can be wrong.
 */
function localReport(input: DebriefInput): DebriefBody {
  const { ctx } = input;
  const result: DebriefBody["deal_analysis"]["final_result"] = input.accepted
    ? "deal"
    : input.offers.length > 0
      ? "walked_away"
      : "no_deal";

  const dodged = input.answers.filter((a) => a.declined || !a.answer.trim());
  const answered = input.answers.length - dodged.length;

  const fair = ctx.fairValuation;
  const implied = input.accepted?.implied_valuation_usd ?? 0;
  const vsFair = !input.accepted
    ? input.offers.length > 0
      ? `You walked away from ${input.offers.length} offer${input.offers.length === 1 ? "" : "s"}. The fair range for this company was ${money(fair.low)}–${money(fair.high)}.`
      : `Nothing was offered, so there is nothing to compare. The fair range for this company was ${money(fair.low)}–${money(fair.high)}.`
    : implied > fair.high
      ? `You signed at ${money(implied)}, above the ${money(fair.low)}–${money(fair.high)} fair range. That is a good price.`
      : implied < fair.low
        ? `You signed at ${money(implied)}, below the ${money(fair.low)}–${money(fair.high)} fair range. You sold cheap.`
        : `You signed at ${money(implied)}, inside the ${money(fair.low)}–${money(fair.high)} fair range. A fair deal.`;

  const dealGrade = !input.accepted
    ? input.offers.length > 0
      ? 5
      : 3
    : implied > fair.high
      ? 9
      : implied < fair.low
        ? 4
        : 7;
  const pitchGrade = Math.max(
    1,
    Math.min(10, Math.round(input.ctx.coveredBeats.filter((b) => b.covered).length * 1.1 + answered * 0.6)),
  );

  return {
    headline: headlineFor(result, input),
    outcome_summary: `You pitched ${ctx.company.name}, answered ${answered} of ${input.answers.length} question${input.answers.length === 1 ? "" : "s"}, and finished with ${input.offers.length} offer${input.offers.length === 1 ? "" : "s"} on the table.${
      input.accepted && input.acceptedFrom
        ? ` You signed with ${CAST[input.acceptedFrom]?.name} at ${money(input.accepted.amount_usd)} for ${input.accepted.equity_pct}%.`
        : ""
    }`,
    deal_analysis: {
      final_result: result,
      accepted_offer_summary:
        input.accepted && input.acceptedFrom
          ? `${CAST[input.acceptedFrom]?.name}: ${money(input.accepted.amount_usd)} for ${input.accepted.equity_pct}% (${money(implied)} implied), ${input.accepted.deal_type}`
          : "No deal signed.",
      vs_fair_range: vsFair,
      decision_verdict: decisionVerdict(result, implied, fair, input.offers.length),
    },
    /*
     * Turning points, from evidence only. Each one quotes something the founder
     * actually said — a dodged question with its text, or an answer that
     * contained a figure — because a turning point nobody can trace back to a
     * moment is the fixture problem all over again.
     */
    turning_points: localTurningPoints(input),
    shark_reads: input.privateNotes.slice(0, 5).map((n) => ({
      shark: CAST[n.shark]?.name ?? n.shark,
      public_stance: input.offers.some((o) => o.shark === n.shark)
        ? `Made an offer: ${money(input.offers.find((o) => o.shark === n.shark)!.offer.amount_usd)} for ${input.offers.find((o) => o.shark === n.shark)!.offer.equity_pct}%.`
        : "Went out.",
      private_read: n.note,
      what_would_have_won_them: CAST[n.shark]?.cares ?? "",
    })),
    attack_points_scorecard: ctx.attackPoints.slice(0, 8).map((a) => {
      const raised = input.answers.some((ans) => ans.question === a.question);
      const answeredIt = input.answers.some(
        (ans) =>
          ans.question === a.question &&
          !ans.declined &&
          scoreAnswer(a.question, ans.answer).quality > 0,
      );
      return {
        attack_point: a.claim,
        status: !raised ? ("untouched" as const) : answeredIt ? ("defended" as const) : ("exposed" as const),
        detail: !raised
          ? "Nobody asked. It is still true, and the next room might."
          : answeredIt
            ? "You were asked and you answered."
            : "You were asked and you did not answer. That is the one that costs valuation.",
      };
    }),
    qa_review: input.answers.map((a) => {
      // The same rule the sharks price on: keyboard mash and non-words grade
      // as dodged, so the debrief cannot call an answer fine that the room
      // just refused to pay for.
      const graded = a.declined ? "dodged" : scoreAnswer(a.question, a.answer).tier;
      const quality = (graded === "shaky" ? "adequate" : graded) as
        | "strong"
        | "adequate"
        | "dodged";
      return {
        question: a.question,
        asked_by: a.askedBy,
        answer_quality: quality,
        note:
          quality === "dodged"
            ? a.declined || !a.answer.trim()
              ? "No answer. In a real room, silence is priced."
              : "That wasn't an answer to the question. The room prices it exactly like silence."
            : quality === "strong"
              ? "You answered with a figure. That is the answer this kind of question wants."
              : "You answered, but without anything checkable in it. A number would have closed it.",
      };
    }),
    next_run_playbook: localPlaybook(input),
    grades: {
      deal_outcome: dealGrade,
      pitch_performance: pitchGrade,
      overall_grade: letter((dealGrade + pitchGrade) / 2),
    },
  };
}

function headlineFor(result: string, input: DebriefInput): string {
  const missed = input.ctx.coveredBeats.filter((b) => !b.covered);
  /*
   * A pitch with no words in it is a microphone failure, not a founder who
   * chose to skip all seven sections — and telling a teenager they "never
   * mentioned" anything when the app failed to hear them would be both wrong
   * and demoralising. So it is called out first, in its own sentence, before
   * any of the structure arithmetic runs.
   */
  const silent = input.pitchTranscript.trim().split(/\s+/).filter(Boolean).length < 8;
  if (silent) {
    return input.accepted
      ? `Nothing came through from your pitch, so the room judged you entirely on your answers — and you still closed a deal.`
      : `Nothing came through from your pitch. That's a microphone problem, not a pitch problem — the questions below are what the room went on.`;
  }

  const shortfall =
    missed.length === 0
      ? "."
      : missed.length === 1
        ? ` — though you never got to ${missed[0].beat.toLowerCase()}.`
        : ` — though ${missed.length} of the seven sections never came up.`;

  if (result === "deal" && input.accepted) {
    return `You sold ${input.accepted.equity_pct}% for ${money(input.accepted.amount_usd)}, valuing the company at ${money(input.accepted.implied_valuation_usd)}${shortfall}`;
  }
  if (result === "walked_away") {
    return `You walked away from money. Sometimes that is the right call — below is whether it was.`;
  }
  return missed.length >= 3
    ? `Nobody bid, and ${missed.length} of the seven sections never came up. Those two facts are related.`
    : `Nobody bid. The reasons are specific, and every one of them is fixable.`;
}

function decisionVerdict(
  result: string,
  implied: number,
  fair: { low: number; high: number },
  offerCount: number,
): string {
  if (result === "deal") {
    return implied < fair.low
      ? "Taking it was the expensive choice. There was room to push, and pushing costs nothing when you already have an offer in hand."
      : "Taking it was defensible. You had a number in the fair range and a company that needs the cash.";
  }
  if (result === "walked_away") {
    return offerCount > 1
      ? "Walking away from several offers is a strong position to give up. Be sure it was the terms you objected to and not the nerves."
      : "One offer and you left it. If the terms were below what the company is worth, that was right; if you left because you had not decided your walk-away number, decide it before the next room.";
  }
  return "There was no decision to make, and that is itself the finding: the round ended in the questioning rather than at the table.";
}

function localTurningPoints(input: DebriefInput): DebriefBody["turning_points"] {
  const out: DebriefBody["turning_points"] = [];

  // The most expensive moment: a question that went unanswered.
  const dodged = input.answers.find((a) => a.declined || !a.answer.trim());
  if (dodged) {
    out.push({
      moment: "The question you didn't answer",
      founder_quote: "",
      consequence: `${dodged.askedBy} asked "${dodged.question}" and got nothing back.`,
      evidence: "No answer was recorded for that question.",
    });
  }

  // The best moment: an answer with a real figure in it.
  const strong = input.answers.find((a) => !a.declined && /\d/.test(a.answer));
  if (strong) {
    out.push({
      moment: "You answered with a number",
      founder_quote: clip(strong.answer, 180),
      consequence: `${strong.askedBy} asked for something checkable and you gave them one.`,
      evidence: "From your own answer, verbatim.",
    });
  }

  // Claims the books contradict — the single most transferable lesson here.
  const content = scorePitchContent(input.pitchTranscript, input.run);
  for (const f of content.findings.filter((x) => x.kind === "contradiction").slice(0, 2)) {
    out.push({
      moment: "A claim your own books contradict",
      founder_quote: "",
      consequence: f.note,
      evidence: "Checked against this company's actual figures.",
    });
  }

  if (out.length === 0) {
    out.push({
      moment: "A quiet round",
      founder_quote: clip(input.pitchTranscript, 180),
      consequence: "Nothing in this session moved the room sharply in either direction.",
      evidence: "From your pitch, verbatim.",
    });
  }
  return out.slice(0, 5);
}

function localPlaybook(input: DebriefInput): string[] {
  const out: string[] = [];
  const missed = input.ctx.coveredBeats.filter((b) => !b.covered);
  for (const b of missed.slice(0, 2)) {
    out.push(`Cover ${b.beat.toLowerCase()} next time — it never came up in the pitch at all.`);
  }
  const worst = input.ctx.attackPoints[0];
  if (worst) out.push(`Raise it yourself before they do: ${worst.claim} Bring the fix with it.`);
  if (input.answers.some((a) => a.declined || !a.answer.trim())) {
    out.push(`Answer everything, even if the answer is "I don't know yet, here's how I'd find out."`);
  }
  if (!input.accepted && input.offers.length === 0) {
    out.push("Decide your ask and your walk-away number before you walk in, and say the ask out loud.");
  }
  return out.slice(0, 5);
}

function localCritique(input: DebriefInput, beats: BeatCheck[]): PitchCritique {
  const content = scorePitchContent(input.pitchTranscript, input.run);
  const silent = content.empty;

  /*
   * When the transcript is empty every beat reads as missed, which is true but
   * useless — the founder cannot fix "you covered nothing" and it was probably
   * not their doing. Lead with the actual problem and how to route around it
   * next time, then list the beats as a rehearsal checklist rather than as a
   * list of failures.
   */
  const missing = silent
    ? [
        "Your words never reached us, so there was nothing to read. If the on-screen transcript stays empty for twelve seconds during a pitch, a typing box appears — use it, and typed pitches are judged exactly the same.",
        ...beats.map((b) => `${b.title}: ${b.fix}`),
      ]
    : beats.filter((b) => !b.covered).map((b) => `${b.title}: ${b.fix}`);

  const unclear: string[] = [];
  if (content.findings.some((f) => f.kind === "vague")) {
    unclear.push(
      "There was not one figure in the whole pitch. Every claim you made was an adjective, and an adjective cannot be checked.",
    );
  }
  for (const f of content.findings.filter((f) => f.kind === "missing").slice(0, 2)) {
    unclear.push(f.note);
  }

  const contradictions = content.findings
    .filter((f) => f.kind === "contradiction")
    .map((f) => f.note);

  const strengths = content.findings
    .filter((f) => f.kind === "covered" || f.kind === "specific" || f.kind === "honest")
    .slice(0, 4)
    .map((f) => f.note);
  const held = input.answers.filter((a) => !a.declined && a.answer.trim());
  if (held.length > 0) {
    strengths.push(
      `You answered ${held.length} of ${input.answers.length} questions rather than sitting on them. Under pressure that is the whole skill.`,
    );
  }
  if (strengths.length === 0) {
    strengths.push("You got in the room and faced it. That is the part most people never do.");
  }

  const add: string[] = [];
  const m = input.ctx.metrics;
  if (!/churn/i.test(input.pitchTranscript)) {
    add.push(`Bring your monthly churn — it is ${m.monthlyChurnPct}% and somebody will ask.`);
  }
  if (!/margin/i.test(input.pitchTranscript)) {
    add.push(`Say your gross margin out loud: ${input.ctx.company.grossMarginPt}%. It answers a question before it is asked.`);
  }
  if (!/(cac|acquisition|ltv|lifetime)/i.test(input.pitchTranscript)) {
    add.push(`Bring LTV against CAC — yours is ${m.ltvCacRatio}× and it is the first ratio an investor reaches for.`);
  }
  if (!/(market|billion|million)/i.test(input.pitchTranscript)) {
    add.push("Put a dollar figure on the market, and show the working behind it.");
  }
  if (input.ctx.competitors[0] && !input.pitchTranscript.toLowerCase().includes("compet")) {
    add.push(
      `Name a competitor and why you beat them — ${input.ctx.competitors[0].name} is the obvious one, and pretending they do not exist is worse than facing them.`,
    );
  }

  return { missing, unclear, contradictions, strengths, add: add.slice(0, 5) };
}

// ── Small helpers ───────────────────────────────────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

function letter(avg: number): string {
  if (avg >= 9.3) return "A+";
  if (avg >= 8.5) return "A";
  if (avg >= 7.5) return "B+";
  if (avg >= 6.5) return "B";
  if (avg >= 5.5) return "C+";
  if (avg >= 4.5) return "C";
  if (avg >= 3.5) return "D";
  return "F";
}

function money(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
