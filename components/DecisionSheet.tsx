"use client";

import { haptic } from "@/lib/haptics";

import { motion } from "framer-motion";
import type { Choice, GameEvent, Industry } from "@/lib/engine/types";
import { GLOSSARY } from "@/lib/engine/constants";

/**
 * A decision takes over the screen: situation in 1–3 lines of Voice v2, then
 * 2–4 choices, each showing its KNOWN tradeoff and hiding the rest.
 * Not a card grid — a single sheet with full-width choice rows.
 */
export function DecisionSheet({
  event,
  choices,
  industry,
  rookieMode,
  isMarket,
  explain,
  onChoose,
  onDismiss,
}: {
  event: GameEvent | null;
  choices: Choice[];
  industry: Industry;
  rookieMode: boolean;
  isMarket?: boolean;
  /** First decision of a guided run: teach how to READ a choice, once. */
  explain?: boolean;
  onChoose: (index: number) => void;
  onDismiss: () => void;
}) {
  if (!event) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <div className="absolute inset-0 bg-[var(--scrim)]" />
      <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
            className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[1.75rem] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
        initial={{ y: "6%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
            {isMarket ? (
              <MarketDateline />
            ) : (
              <p className="px-5 pt-5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
                {categoryLabel(event.category)}
              </p>
            )}

            <h2
              id="decision-title"
              className="px-5 pt-2 text-[1.375rem] font-extrabold leading-[1.15] tracking-[-0.01em]"
              style={{ overflowWrap: "anywhere" }}
            >
              {event.title}
            </h2>

            <p className="px-5 pt-2.5 text-[0.9375rem] leading-[1.55] text-[var(--text-secondary)]">
              {event.reskins?.[industry] ?? event.text}
            </p>

            {rookieMode && event.rookieTerms && event.rookieTerms.length > 0 && (
              <dl className="mx-5 mt-3.5 space-y-1.5 rounded-[var(--radius-row)] bg-[var(--chip)] p-3">
                {event.rookieTerms.map((term) => {
                  const gloss = GLOSSARY[term.toLowerCase()];
                  if (!gloss) return null;
                  return (
                    <div key={term} className="text-xs leading-snug">
                      <dt className="inline font-bold uppercase tracking-wide text-[var(--text)]">
                        {term}
                      </dt>
                      <dd className="inline text-[var(--text-secondary)]">
                        {" — "}
                        {gloss.rookie}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}

            {explain && (
              /*
               * Shown once, on the first decision of a guided run.
               *
               * Deliberately teaches how to REASON, not what each option
               * scores. The chips are coming out in Phase 2 precisely because
               * "pick the bigger number" is not a business decision — so the
               * tutorial must not train the habit the redesign is removing.
               */
              <div className="mx-3 mt-4 rounded-[var(--radius-row)] bg-[var(--surface-elevated)] p-3">
                <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                  HOW TO READ THIS
                </p>
                <p className="mt-1.5 text-sm leading-snug text-[var(--text-secondary)]">
                  There is no free option. Each one spends something —{" "}
                  <strong className="font-bold text-[var(--text-primary)]">cash</strong>,{" "}
                  <strong className="font-bold text-[var(--text-primary)]">time</strong>,{" "}
                  <strong className="font-bold text-[var(--text-primary)]">people</strong>, or{" "}
                  <strong className="font-bold text-[var(--text-primary)]">goodwill</strong>.
                  Ask which one you can most afford to lose right now, then look
                  at your runway to check you are right.
                </p>
              </div>
            )}

            <ul className="mt-4 space-y-2 px-3 pb-1">
              {choices.map((choice, i) => (
                <li key={`${choice.label}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("choice");
                      onChoose(i);
                    }}
                    className="nv-card flex w-full items-start justify-between gap-4 px-4 py-3.5 text-left transition-transform duration-150 active:scale-[0.985]"
                  >
                    <span className="flex-1 text-[0.9375rem] font-semibold leading-snug">
                      {choice.label}
                      {choice.perform && (
                        <span className="ml-2 inline-flex items-center gap-1 align-[1px] text-2xs font-bold tracking-[0.1em] text-[var(--action)]">
                          <CameraGlyph />
                          ON CAMERA
                        </span>
                      )}
                    </span>
                    {choice.known && (
                      <span className="tnum shrink-0 rounded-md bg-[var(--chip)] px-1.5 py-0.5 text-2xs font-bold text-[var(--text-secondary)]">
                        {choice.known}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {/* performOnly events with no tap-out are handled upstream: the
                dismiss control opens the camera instead of closing. */}
            {choices.length === 0 && event.performOnly && (
              <div className="px-5 py-5">
                <p className="text-sm text-[var(--text-secondary)]">
                  {event.performOnly.optional
                    ? "You can speak to this, or let it pass."
                    : "There is no tap-out here. You are the face."}
                </p>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--action)] text-base font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)] transition-transform duration-150 active:scale-[0.97]"
                >
                  <CameraGlyph />
                  OPEN THE CAMERA ▸
                </button>
              </div>
            )}
      </motion.section>
    </motion.div>
  );
}

/** Today's Market wears a dateline, not a category tag — same storm, every boat. */
function MarketDateline() {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-t-[1.75rem] bg-[var(--color-navy)] px-5 py-2.5">
      <span className="text-2xs font-bold tracking-[0.16em] text-[var(--color-prestige)]">
        TODAY&rsquo;S MARKET
      </span>
      <span className="text-2xs tracking-[0.1em] text-[var(--on-action)]/45">
        {today.toUpperCase()} · EVERY FOUNDER GETS THIS
      </span>
    </div>
  );
}

function CameraGlyph() {
  return (
    <svg width="12" height="10" viewBox="0 0 14 11" fill="none" aria-hidden="true">
      <rect x="0.5" y="1.5" width="9" height="8" rx="1.8" fill="currentColor" />
      <path d="M10.5 5.5 13.5 3v5.5l-3-2.5Z" fill="currentColor" />
    </svg>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  OPS: "OPERATIONS",
  PPL: "PEOPLE",
  FIN: "MONEY",
  MKT: "MARKETING",
  PRD: "PRODUCT",
  CUS: "CUSTOMERS",
  RIV: "RIVALS",
  LGL: "LEGAL",
  LIF: "YOUR LIFE",
  OPP: "OPPORTUNITY",
  K: "CRISIS",
  MILE: "MILESTONE",
  IND: "YOUR INDUSTRY",
  WILD: "WILDCARD",
};

const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c.toUpperCase();
