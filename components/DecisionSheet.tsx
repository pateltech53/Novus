"use client";

import { useEffect, useState } from "react";

import { haptic } from "@/lib/haptics";

import { motion } from "framer-motion";
import { ENTER, EXIT, SCRIM } from "@/components/ui/Motion";
import type { Choice, GameEvent, Industry } from "@/lib/engine/types";
import { GLOSSARY } from "@/lib/engine/constants";
import { CostChip } from "@/components/CostChip";
import { termsUsed } from "@/lib/ai/terms";

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
  /** Which option's "?" is open. One at a time; tapping again closes it. */
  const [decoded, setDecoded] = useState<number | null>(null);
  // A new card is a new set of options; an explainer left open from the last
  // card would be explaining the wrong row.
  const eventId = event?.id;
  useEffect(() => setDecoded(null), [eventId]);

  if (!event) return null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: EXIT }}
      transition={SCRIM}
    >
      <div className="absolute inset-0 bg-[var(--scrim)]" />
      <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
            className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
        initial={{ y: "6%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "6%", opacity: 0, transition: EXIT }}
        transition={ENTER}
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
              {choices.map((choice, i) => {
                const lines = decodeChoice(choice);
                return (
                <li key={`${choice.label}-${i}`}>
                  {/* The "?" is a SIBLING of the choice, never nested inside
                      it — a button in a button is invalid HTML and a mistap
                      away from spending the decision while asking about it. */}
                  <div className="flex items-stretch gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      haptic("choice");
                      onChoose(i);
                    }}
                    className="nv-card flex w-full flex-1 items-start justify-between gap-4 px-4 py-3.5 text-left nv-press-row"
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
                    {choice.known && <CostChip known={choice.known} />}
                  </button>
                  <button
                    type="button"
                    aria-label={`Explain this option: ${choice.label}`}
                    aria-expanded={decoded === i}
                    onClick={() => setDecoded(decoded === i ? null : i)}
                    className={`nv-gc w-9 shrink-0 self-stretch rounded-[var(--radius-row)] text-sm font-extrabold transition-colors ${
                      decoded === i
                        ? "text-[var(--action)]"
                        : "text-[var(--text-tertiary)]"
                    }`}
                  >
                    ?
                  </button>
                  </div>
                  {decoded === i && (
                    <div className="mt-1.5 rounded-[var(--radius-row)] bg-[var(--chip)] px-3.5 py-2.5">
                      {lines.length > 0 ? (
                        <dl className="space-y-1.5">
                          {lines.map((line) => (
                            <div key={line.term} className="text-xs leading-snug">
                              <dt className="inline font-bold uppercase tracking-wide text-[var(--text-primary)]">
                                {line.term}
                              </dt>
                              <dd className="inline text-[var(--text-secondary)]">
                                {" — "}
                                {line.meaning}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-xs leading-snug text-[var(--text-secondary)]">
                          No jargon in this one — it says what it does.
                        </p>
                      )}
                      {choice.known && (
                        <p className="mt-1.5 border-t border-[var(--hairline)] pt-1.5 text-2xs leading-snug text-[var(--text-tertiary)]">
                          The chip shows what this choice is KNOWN to change
                          before you pick it. Everything else resolves after,
                          like it would in real life.
                        </p>
                      )}
                    </div>
                  )}
                </li>
                );
              })}
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
                  className="nv-gc mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-card)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
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

/*
 * ── The option decoder ──────────────────────────────────────────────────────
 *
 * What the per-option "?" shows. Two vocabularies feed it:
 *
 *   · Real business terms in the label ("equity", "churn", "margin") come
 *     from GLOSSARY via the same scanner the term coach uses, so a word means
 *     the same thing here as everywhere else.
 *   · The KNOWN chip's shorthand ("GM −3", "Burn +0.5S/mo", "CSAT +2") has
 *     its own table below, because the chip abbreviates stats that GLOSSARY
 *     spells out — a player squinting at "GM" needs the abbreviation
 *     explained, not a lecture on margin accounting.
 */
const CHIP_SHORTHAND: { pattern: RegExp; term: string; meaning: string }[] = [
  { pattern: /\bGM\b/, term: "GM", meaning: "gross margin — of each $1 sold, what you keep before rent and salaries." },
  { pattern: /\bRev\b/i, term: "Rev", meaning: "revenue — everything customers pay you." },
  { pattern: /\bBurn\b/i, term: "Burn", meaning: "burn — how fast your bank account shrinks each month." },
  { pattern: /\bCash\b/i, term: "Cash", meaning: "cash — money in the bank right now." },
  { pattern: /\bCSAT\b/, term: "CSAT", meaning: "customer satisfaction — how happy the people who bought it are." },
  { pattern: /\bQual\b/, term: "Qual", meaning: "product quality — how good the thing you sell actually is." },
  { pattern: /\bMor\b/, term: "Mor", meaning: "morale — how your team is holding up." },
  { pattern: /\bEn\b/, term: "En", meaning: "energy — yours. Founders run out too." },
  { pattern: /\bResp\b/, term: "Resp", meaning: "shark respect — what the room thinks of you." },
  { pattern: /\bEmp\b/, term: "Emp", meaning: "employees — headcount." },
  { pattern: /\bShare\b/i, term: "Share", meaning: "market share — your slice of everyone buying this kind of thing." },
  { pattern: /\bBrand\b/i, term: "Brand", meaning: "brand — how many people know and trust the name." },
  { pattern: /\bCWP\b/, term: "CWP", meaning: "customer wow points — delight beyond what was promised." },
  { pattern: /\bCTR\b/, term: "CTR", meaning: "click-through rate — of the people who saw it, how many tapped." },
  { pattern: /\bCAC\b/, term: "CAC", meaning: "customer acquisition cost — what one new customer costs you to win." },
  {
    pattern: /\d\s?S\b|\bS\/mo\b|\+S\b|−S\b|-S\b/,
    term: "S",
    meaning:
      "the money unit at your stage — $1,000 in a garage, up to $10M at the top. It scales so the same card matters all game. “S/mo” is per month.",
  },
];

/** The plain-English lines for one option: label terms first, chip shorthand after. */
function decodeChoice(choice: Choice): { term: string; meaning: string }[] {
  const lines: { term: string; meaning: string }[] = [];
  const seen = new Set<string>();

  // Real terms in the label, from the shared glossary.
  for (const term of termsUsed(choice.label)) {
    const gloss = GLOSSARY[term];
    if (!gloss || seen.has(term)) continue;
    seen.add(term);
    lines.push({ term, meaning: gloss.rookie });
  }

  // The chip's abbreviations.
  const chip = choice.known ?? "";
  for (const entry of CHIP_SHORTHAND) {
    if (!chip || seen.has(entry.term.toLowerCase())) continue;
    if (!entry.pattern.test(chip)) continue;
    seen.add(entry.term.toLowerCase());
    lines.push({ term: entry.term, meaning: entry.meaning });
  }

  return lines;
}

/** Today's Market wears a dateline, not a category tag — same storm, every boat. */
function MarketDateline() {
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
  });
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-t-[var(--radius-sheet)] bg-[var(--color-navy)] px-5 py-2.5">
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

/** Exported so the native sheet labels a card the same way this one does —
 *  two copies of this table is two vocabularies for the same game. */
export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c.toUpperCase();

/** The market dateline's right-hand side, shared for the same reason. */
export const marketDatelineDetail = () =>
  `${new Date()
    .toLocaleDateString("en-US", { month: "long", day: "numeric" })
    .toUpperCase()} · EVERY FOUNDER GETS THIS`;

/**
 * The once-only "how to read this", as plain text.
 *
 * The DOM version marks the four things a choice can spend in bold. A native
 * label has no place to put that emphasis, and the sentence has to survive
 * without it — so this is the same argument written to stand on its own,
 * rather than the same string with the tags stripped out.
 */
export const HOW_TO_READ = {
  title: "How to read this",
  text:
    "There is no free option. Each one spends something — cash, time, people, or goodwill. " +
    "Ask which one you can most afford to lose right now, then look at your runway to check " +
    "you are right.",
};
