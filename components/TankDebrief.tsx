"use client";

import { motion } from "framer-motion";
import { ENTER } from "@/components/ui/Motion";
import type { TankDebriefData } from "@/lib/ai/debrief-types";
import { SharkStage } from "@/components/SharkStage";

/**
 * THE DEBRIEF — everything, after the whole thing.
 *
 * ── Where it sits, and why that is the fix ─────────────────────────────────
 *
 * After The Tank. Not before it.
 *
 * The feedback card used to appear the moment the pitch ended, with the panel
 * happening afterwards — so the report could not say a word about the
 * questioning, which is the harder half of the exercise and the half where a
 * founder is genuinely tested. Everything a player learns about how they held
 * up under interrogation was, structurally, impossible to tell them. Moving one
 * screen is most of the fix.
 *
 * ── Two halves, one document, one very loud line between them ──────────────
 *
 * THE BUSINESS half — what you said, what was missing, what the room thought,
 * what the deal was worth. This is what was judged.
 *
 * THE DELIVERY half — eye contact, gestures, posture, pace, filler words,
 * volume. Measured on the device, reported, and scored NOWHERE. Players asked
 * for it in the same report; putting it in the same grade would break Brand
 * Law 5. So it is the same scroll with its own header that says, on every
 * render, that it did not affect anything.
 */
export function TankDebrief({
  data,
  companyName,
  onContinue,
}: {
  data: TankDebriefData;
  companyName: string;
  onContinue: () => void;
}) {
  const { report, critique, beats, delivery } = data;
  const covered = beats.filter((b) => b.covered).length;

  return (
    <motion.section
      className="flex-1 overflow-y-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER }}
    >
      <div className="mx-auto w-full max-w-lg px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
        <SharkStage state="verdict" className="h-32 w-full" />

        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--n-7)]">
          THE DEBRIEF · {companyName.toUpperCase()}
        </p>
        <h1 className="mt-1.5 text-[1.5rem] font-extrabold leading-tight tracking-[-0.02em]">
          {report.headline}
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-[var(--n-8)]">
          {report.outcome_summary}
        </p>

        {/* ── Grades ──────────────────────────────────────────────────── */}
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Grade label="PITCH" value={`${report.grades.pitch_performance}/10`} />
          <Grade label="THE DEAL" value={`${report.grades.deal_outcome}/10`} />
          <Grade label="OVERALL" value={report.grades.overall_grade} accent />
        </div>

        {/* ── The seven beats ─────────────────────────────────────────── */}
        <Section title={`YOUR STRUCTURE · ${covered}/7 COVERED`}>
          <ul className="border-t border-[var(--hairline)]">
            {beats.map((b) => (
              <li
                key={b.n}
                className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2"
              >
                <span
                  className={`w-4 shrink-0 text-center text-2xs font-extrabold ${
                    b.covered ? "text-[var(--solvency)]" : "text-[var(--alert)]"
                  }`}
                >
                  {b.covered ? "✓" : "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{b.title}</span>
                  {!b.covered && (
                    <span className="block text-2xs leading-snug text-[var(--n-7)]">{b.fix}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        {/* ── The four lists players asked for by name ─────────────────── */}
        {critique.missing.length > 0 && (
          <Bullets title="WHAT WAS MISSING" items={critique.missing} tone="alert" />
        )}
        {critique.contradictions.length > 0 && (
          <Bullets
            title="WHAT YOUR OWN BOOKS CONTRADICT"
            items={critique.contradictions}
            tone="alert"
          />
        )}
        {critique.unclear.length > 0 && (
          <Bullets title="WHAT WASN'T CLEAR" items={critique.unclear} />
        )}
        {critique.add.length > 0 && (
          <Bullets title="BRING THESE NEXT TIME" items={critique.add} />
        )}
        {critique.strengths.length > 0 && (
          <Bullets title="WHAT WORKED" items={critique.strengths} tone="good" />
        )}

        {/* ── The questioning ─────────────────────────────────────────── */}
        {report.qa_review.length > 0 && (
          <Section title="HOW YOU HANDLED THE QUESTIONS">
            <ul className="space-y-3">
              {report.qa_review.map((q, i) => (
                <li key={`${q.question}-${i}`}>
                  <p className="flex items-baseline gap-2">
                    <span
                      className={`shrink-0 text-2xs font-extrabold tracking-[0.1em] ${
                        q.answer_quality === "strong"
                          ? "text-[var(--solvency)]"
                          : q.answer_quality === "dodged"
                            ? "text-[var(--alert)]"
                            : "text-[var(--n-7)]"
                      }`}
                    >
                      {q.answer_quality.toUpperCase()}
                    </span>
                    <span className="text-2xs tracking-[0.08em] text-[var(--n-7)]">
                      {q.asked_by.toUpperCase()}
                    </span>
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-snug">{q.question}</p>
                  <p className="mt-0.5 text-xs leading-snug text-[var(--n-8)]">{q.note}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── Turning points ──────────────────────────────────────────── */}
        {report.turning_points.length > 0 && (
          <Section title="THE MOMENTS THAT MOVED IT">
            <ul className="space-y-3.5">
              {report.turning_points.map((t, i) => (
                <li key={`${t.moment}-${i}`}>
                  <p className="text-sm font-bold">{t.moment}</p>
                  {t.founder_quote && (
                    <p className="mt-1 border-l-2 border-[var(--n-6)] pl-2.5 text-sm italic leading-snug text-[var(--n-8)]">
                      &ldquo;{t.founder_quote}&rdquo;
                    </p>
                  )}
                  <p className="mt-1 text-xs leading-snug text-[var(--n-8)]">{t.consequence}</p>
                  {t.evidence && (
                    <p className="mt-0.5 text-2xs leading-snug text-[var(--n-7)]">{t.evidence}</p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── What the room privately thought ─────────────────────────── */}
        {report.shark_reads.length > 0 && (
          <Section title="WHAT THEY WERE ACTUALLY THINKING">
            <ul className="space-y-3">
              {report.shark_reads.map((s, i) => (
                <li key={`${s.shark}-${i}`}>
                  <p className="text-sm font-bold">{s.shark}</p>
                  <p className="mt-0.5 text-xs leading-snug text-[var(--n-8)]">{s.public_stance}</p>
                  {s.private_read && (
                    <p className="mt-1 text-xs leading-snug text-[var(--n-9)]">
                      <span className="font-bold text-[var(--n-7)]">PRIVATELY · </span>
                      {s.private_read}
                    </p>
                  )}
                  {s.what_would_have_won_them && (
                    <p className="mt-0.5 text-2xs leading-snug text-[var(--n-7)]">
                      Would have won them: {s.what_would_have_won_them}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── The scorecard ───────────────────────────────────────────── */}
        {report.attack_points_scorecard.length > 0 && (
          <Section title="THE HOLES IN YOUR BUSINESS">
            <ul className="border-t border-[var(--hairline)]">
              {report.attack_points_scorecard.map((a, i) => (
                <li
                  key={`${a.attack_point}-${i}`}
                  className="border-b border-[var(--hairline)] py-2"
                >
                  <p className="flex items-baseline gap-2">
                    <span
                      className={`shrink-0 text-2xs font-extrabold tracking-[0.1em] ${
                        a.status === "defended"
                          ? "text-[var(--solvency)]"
                          : a.status === "exposed"
                            ? "text-[var(--alert)]"
                            : "text-[var(--n-7)]"
                      }`}
                    >
                      {a.status.toUpperCase()}
                    </span>
                    <span className="min-w-0 text-sm font-semibold leading-snug">
                      {a.attack_point}
                    </span>
                  </p>
                  <p className="mt-0.5 text-2xs leading-snug text-[var(--n-7)]">{a.detail}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ── The deal ────────────────────────────────────────────────── */}
        <Section title="THE DEAL">
          <p className="text-sm font-semibold">{report.deal_analysis.accepted_offer_summary}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--n-8)]">
            {report.deal_analysis.vs_fair_range}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--n-8)]">
            {report.deal_analysis.decision_verdict}
          </p>
        </Section>

        {/* ══ THE LINE ════════════════════════════════════════════════════
            Everything above judged the business. Everything below did not
            judge anything at all, and says so before the first number. */}
        <section className="mt-9 rounded-[var(--radius-card)] bg-[var(--surface)] p-4">
          <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">
            HOW YOU CAME ACROSS
          </h2>
          <p className="mt-1 text-2xs font-bold leading-snug tracking-[0.06em] text-[var(--action)]">
            NONE OF THIS AFFECTED YOUR SCORE OR THE OFFERS. IT WAS MEASURED ON THIS
            DEVICE AND IS HERE SO YOU CAN PRACTISE.
          </p>

          <ul className="mt-3 border-t border-[var(--hairline)]">
            {delivery.notes.map((note, i) => (
              <li
                key={`${note.topic}-${i}`}
                className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2.5"
              >
                <span
                  className={`w-24 shrink-0 text-2xs font-extrabold tracking-[0.08em] ${
                    note.tone === "watch" ? "text-[var(--text-primary)]" : "text-[var(--n-7)]"
                  }`}
                >
                  {note.topic}
                </span>
                <span className="text-sm leading-snug text-[var(--text-secondary)]">
                  {note.text}
                </span>
              </li>
            ))}
          </ul>

          <dl className="tnum mt-3 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-[var(--n-7)]">
            <Stat label="Words" value={String(delivery.metrics.word_count)} />
            <Stat label="Pace" value={`${delivery.metrics.wpm} wpm`} />
            <Stat
              label="Fillers"
              value={`${delivery.metrics.filler_count} · ${delivery.metrics.fillers_per_minute}/min`}
            />
            {delivery.coaching && delivery.coaching.camera.frames > 0 && (
              <Stat
                label="Eyes on the lens"
                value={`${Math.round(delivery.coaching.camera.eyeContactShare * 100)}%`}
              />
            )}
          </dl>

          <p className="mt-3 text-2xs leading-relaxed text-[var(--n-7)]">
            The camera was read on this device, one frame at a time, and every frame
            was dropped the moment it was read. No video, no pictures and no
            measurements were uploaded or stored.
          </p>
        </section>

        {/* ── Next time ───────────────────────────────────────────────── */}
        {report.next_run_playbook.length > 0 && (
          <Section title="NEXT TIME">
            <ol className="border-t border-[var(--hairline)]">
              {report.next_run_playbook.map((line, i) => (
                <li
                  key={`${line}-${i}`}
                  className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2.5"
                >
                  <span className="tnum text-xs font-bold text-[var(--action)]">{i + 1}</span>
                  <span className="text-sm leading-snug">{line}</span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {data.termsUsed.length > 0 && (
          <p className="mt-6 text-2xs leading-relaxed text-[var(--n-7)]">
            Business terms you used in this pitch: {data.termsUsed.join(", ")}. Using the
            vocabulary correctly is half of sounding like someone who runs a company.
          </p>
        )}

        {data.offline && (
          /*
           * Said plainly rather than hidden. An offline debrief is a real
           * debrief — every claim in it is arithmetic over the session — but it
           * cannot tie a sentence to a shark's private note the way the live
           * one can, and pretending otherwise would be overclaiming.
           */
          <p className="mt-4 border-l-2 border-[var(--n-6)] pl-3 text-2xs leading-relaxed text-[var(--n-7)]">
            This debrief was written offline, from your transcript, your answers and
            your books. Everything in it is measured rather than inferred — it just
            reads a little flatter than the full one.
          </p>
        )}

        <button
          type="button"
          onClick={onContinue}
          className="nv-gc mt-8 w-full rounded-[var(--radius-card)] nv-t-action px-5 py-4 text-base font-extrabold tracking-[0.06em]"
        >
          BACK TO THE COMPANY ▸
        </button>
      </div>
    </motion.section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Bullets({
  title,
  items,
  tone = "flat",
}: {
  title: string;
  items: string[];
  tone?: "flat" | "good" | "alert";
}) {
  const dot =
    tone === "good"
      ? "bg-[var(--solvency)]"
      : tone === "alert"
        ? "bg-[var(--alert)]"
        : "bg-[var(--n-6)]";
  return (
    <Section title={title}>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={`${item}-${i}`} className="flex gap-2.5">
            <span aria-hidden="true" className={`mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span className="text-sm leading-snug text-[var(--n-9)]">{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Grade({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--surface)] px-3 py-2.5 text-center">
      <p className="text-2xs font-bold tracking-[0.12em] text-[var(--n-7)]">{label}</p>
      <p
        className={`tnum mt-0.5 text-xl font-extrabold leading-none ${
          accent ? "text-[var(--action)]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="inline font-bold">{label} </dt>
      <dd className="inline">{value}</dd>
    </div>
  );
}
