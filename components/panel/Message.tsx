"use client";

import { motion } from "framer-motion";
import { ENTER, STAGGER } from "@/components/ui/Motion";
import { FounderAvatar } from "@/components/FounderAvatar";
import { CAST } from "@/lib/ai/panel-cast";
import { fmtMoney } from "@/lib/engine/format";
import type { SharkId, SharkOffer } from "@/lib/ai/types";

/**
 * THE TANK, AS A CONVERSATION — the room's dialogue in message bubbles.
 *
 * ── Why this shape ─────────────────────────────────────────────────────────
 *
 * The panel is a conversation, and it was laid out as a transcript: a flat
 * column of rows where a shark's line, the founder's reply and the Chair's
 * framing all had the same weight, the same alignment and the same colour. In
 * a real exchange the single most useful piece of information is WHO IS
 * TALKING, and the old layout made you read a name label to find out. The
 * founder's own answer — the thing they just said out loud, under pressure —
 * looked like a footnote under the question in `--text-tertiary`.
 *
 * A message thread solves all of that with alignment alone. The sharks are on
 * the left, the founder is on the right, and the Chair sits in the middle
 * because he is not taking a side. Nobody has to read a label to know who
 * spoke. It is also the form every person using this app already knows how to
 * read, on every platform they will open it on.
 *
 * ── The rules this layout keeps ────────────────────────────────────────────
 *
 * · Consecutive messages from one speaker are GROUPED: the portrait and the
 *   name appear once, at the top of the run, exactly as a messaging app does.
 *   Repeating a face five times down a thread is noise.
 * · A shark's framing and their actual question are two bubbles, not one
 *   paragraph. The question is the thing being answered, so it gets its own
 *   weight and its own bubble.
 * · An offer is an attachment under the bubble, not prose. The arithmetic stays
 *   spelled out — that division is the thing the game exists to teach.
 * · The founder's bubble is TINTED with the action colour and not filled with
 *   it. `--action` is documented in globals.css as "the only colour that asks
 *   you to do something"; a passive message is not asking for anything, and
 *   filling every answer with it would spend the one signal the app has.
 */

/*
 * ── A line length, not a percentage ────────────────────────────────────────
 *
 * The bubbles are capped in `rem` as well as in `%`. A percentage alone is
 * fine on a phone and wrong on a desktop: at 88% of an 830px column a bubble
 * runs to about 130 characters a line, which is roughly twice the measure
 * anybody reads comfortably. `min(92%, 34rem)` keeps the phone behaviour
 * exactly as it was and stops the line growing past a readable width on a
 * wide screen, without a breakpoint to keep in sync.
 */

/** Where the tail goes. Left is the room, right is the founder. */
type Side = "left" | "right";

function bubbleShape(side: Side, grouped: boolean): string {
  // The corner nearest the speaker's face is the tight one, and only on the
  // last bubble of a run — the same trick every message thread uses to make a
  // group read as one utterance rather than several.
  const base = "rounded-[var(--radius-card)]";
  if (side === "left") return `${base} ${grouped ? "rounded-tl-[var(--radius-row)]" : ""}`;
  return `${base} ${grouped ? "rounded-tr-[var(--radius-row)]" : ""}`;
}

/**
 * One thing a shark said.
 *
 * `grouped` means the shark above this bubble is the same shark, so the face
 * and the name are already on screen.
 */
export function SharkMessage({
  shark,
  spoken,
  question,
  offer,
  decision,
  jointWith,
  grouped = false,
}: {
  shark: SharkId;
  spoken?: string;
  question?: string;
  offer?: SharkOffer | null;
  decision?: string;
  jointWith?: SharkId;
  grouped?: boolean;
}) {
  const cast = CAST[shark];
  // A verdict always gets its name row back, grouped or not: "OUT" under a
  // face that scrolled off the top is a verdict with no owner.
  const showWho = !grouped || !!decision;

  return (
    <div className="flex w-full gap-2 sm:gap-2.5">
      {/* The face, once per run. The spacer keeps the column when grouped. */}
      <div className="w-8 shrink-0 sm:w-9">
        {showWho && (
          <img
            src={cast.portrait}
            alt=""
            width={36}
            height={36}
            className="h-8 w-8 rounded-[var(--radius-pill)] bg-[var(--surface)] object-contain sm:h-9 sm:w-9"
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
        {showWho && (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pl-1">
            <span className="text-2xs font-bold tracking-[0.04em] text-[var(--text-primary)]">
              {cast.name}
            </span>
            <span className="text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
              {cast.tag.toUpperCase()}
            </span>
            {decision === "out" && (
              <span className="text-2xs font-bold tracking-[0.12em] text-[var(--alert)]">OUT</span>
            )}
            {jointWith && (
              <span className="text-2xs font-bold tracking-[0.12em] text-[var(--prestige)]">
                WITH {(CAST[jointWith]?.name ?? "").split(" ")[0].toUpperCase()}
              </span>
            )}
          </p>
        )}

        {spoken && (
          <div
            className={`max-w-[min(92%,34rem)] bg-[var(--surface-elevated)] px-3.5 py-2.5 shadow-[var(--e1)] ${bubbleShape("left", showWho)}`}
          >
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{spoken}</p>
          </div>
        )}

        {/* The question is its own message. It is the thing being answered, and
            burying it in the same paragraph as the framing is what made players
            answer the wrong half of a turn. */}
        {question && (
          <div
            className={`max-w-[min(95%,36rem)] bg-[var(--surface-elevated)] px-3.5 py-3 shadow-[var(--e2)] ring-1 ring-[var(--hairline)] ${bubbleShape("left", !spoken && showWho)}`}
          >
            <p className="text-base font-semibold leading-snug text-[var(--text-primary)]">
              {question}
            </p>
          </div>
        )}

        {offer && <OfferCard offer={offer} />}
      </div>
    </div>
  );
}

/** The terms, as an attachment under the bubble that proposed them. */
function OfferCard({ offer }: { offer: SharkOffer }) {
  return (
    <div className="w-full max-w-[min(95%,32rem)] rounded-[var(--radius-card)] bg-[var(--surface-elevated)] px-3.5 py-3 shadow-[var(--e2)] ring-1 ring-[var(--color-prestige)]/30">
      {/* --prestige, not the brand constant: the terms are the key figure of
          the room and the constant is ~1.6:1 on the light theme's white card. */}
      <p className="tnum text-base font-bold text-[var(--prestige)]">
        {fmtMoney(offer.amount_usd)} for {offer.equity_pct}%
      </p>
      {/*
        The offer's arithmetic, done in front of the player. "Post-money" as a
        bare label taught nothing; cheque ÷ slice = what this shark just said
        the whole company is worth, written as the division, is the sentence
        the game exists to make second nature.
      */}
      <p className="tnum mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
        Their math: {fmtMoney(offer.amount_usd)} ÷ {offer.equity_pct}% = they believe the company is
        worth {fmtMoney(offer.implied_valuation_usd)}.
      </p>
      {offer.conditions.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--hairline)] pt-2">
          {offer.conditions.map((c) => (
            <li key={c} className="text-2xs leading-snug text-[var(--text-tertiary)]">
              · {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the founder said — their words, on their side of the thread.
 *
 * This used to be `--text-tertiary` prose tucked under the question, which put
 * the one thing the player actually contributed at the bottom of the visual
 * hierarchy. A founder must be able to see what the room heard, and see it as
 * clearly as they see what the room said.
 */
export function FounderMessage({
  entry,
  avatar,
}: {
  entry: { text: string; spoken: boolean; declined: boolean };
  avatar: { gender: "male" | "female"; tier: 1 | 2 | 3 | 4 | 5 };
}) {
  const silent = entry.declined || !entry.text;

  return (
    <div className="flex w-full justify-end gap-2 sm:gap-2.5">
      <div className="flex min-w-0 flex-col items-end gap-1">
        <div
          /*
           * `in srgb`, and not `in oklch`, for the fill specifically.
           *
           * The neutral ramp is a near-grey at hue 260. Mixing the action
           * orange (hue ~45) into it in OKLCH interpolates the HUE ANGLE, which
           * takes the short way round through 285 — so a 16% orange tint came
           * out visibly lavender. Channel-wise sRGB mixing has no hue to
           * rotate and gives the warm tint the token was chosen for. The ring
           * mixes toward `transparent`, where no hue interpolation happens, so
           * it stays in OKLCH and stays correct.
           */
          className={`max-w-[min(92%,34rem)] px-3.5 py-2.5 shadow-[var(--e1)] ${bubbleShape("right", true)} ${
            silent
              ? "bg-[var(--surface)] ring-1 ring-[var(--hairline)]"
              : "bg-[color-mix(in_srgb,var(--action)_16%,var(--surface-elevated))] ring-1 ring-[color-mix(in_oklch,var(--action)_38%,transparent)]"
          }`}
        >
          <p
            className={`text-sm leading-relaxed ${
              silent ? "italic text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
            }`}
          >
            {/*
              The words, whether they were spoken or typed. This used to say only
              "You answered out loud", because a spoken answer genuinely carried
              no text — the recording was thrown away. It carries text now, so it
              is shown: a founder must be able to see what the room actually heard.
            */}
            {silent ? "You said nothing." : entry.text}
          </p>
        </div>
      </div>
      {/* FounderAvatar, not FounderPortrait: the panel seat wears whatever the
          player earned and equipped. Cosmetic only — the sharks judge the books. */}
      <div className="w-8 shrink-0 sm:w-9">
        <FounderAvatar avatar={avatar} size={36} />
      </div>
    </div>
  );
}

/**
 * The Chair, and anything else addressed to the whole room.
 *
 * Centred and unattributed, the way a messaging app renders a system notice.
 * He frames the round and takes no side, so putting him on the sharks' side of
 * the thread would have made him a sixth investor.
 */
export function SystemMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-center px-2 py-1">
      <p className="max-w-[min(92%,38rem)] text-balance rounded-[var(--radius-card)] bg-[var(--surface)] px-3.5 py-2 text-center text-2xs leading-relaxed text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]">
        {text}
      </p>
    </div>
  );
}

/**
 * A shark composing a reply.
 *
 * This replaces a static line of text — "They're thinking about it" — that sat
 * unchanged for however long the provider took, up to the 12 s client timeout,
 * five times per year gate. Nothing on the screen moved while it waited, so the
 * most common reading of a slow turn was that the app had crashed. Three dots
 * in a bubble under the face of the shark who is about to speak says the same
 * thing in the vocabulary of the rest of this screen, and says WHO is thinking,
 * which the old line could not.
 */
export function TypingBubble({ shark, label }: { shark?: SharkId; label?: string }) {
  const cast = shark ? CAST[shark] : null;

  return (
    <motion.div
      className="flex w-full gap-2 sm:gap-2.5"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
    >
      <div className="w-8 shrink-0 sm:w-9">
        {cast && (
          <img
            src={cast.portrait}
            alt=""
            width={36}
            height={36}
            className="h-8 w-8 rounded-[var(--radius-pill)] bg-[var(--surface)] object-contain sm:h-9 sm:w-9"
          />
        )}
      </div>
      <div className="flex flex-col items-start gap-1">
        <p className="pl-1 text-2xs font-bold tracking-[0.04em] text-[var(--text-primary)]">
          {cast?.name ?? label ?? "The room"}
        </p>
        <div className="rounded-[var(--radius-card)] rounded-tl-[var(--radius-row)] bg-[var(--surface-elevated)] px-4 py-3 shadow-[var(--e1)]">
          <span aria-hidden="true" className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="block h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]"
                animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * STAGGER * 2,
                }}
              />
            ))}
          </span>
          <span className="sr-only">{cast?.name ?? "The room"} is thinking</span>
        </div>
      </div>
    </motion.div>
  );
}
