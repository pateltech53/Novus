import { CAST } from "./panel-cast";
import type { PanelLogLine, SharkId } from "./types";

const IDS: SharkId[] = ["marcus", "serena", "dev", "lily", "viktor"];

export const isSharkId = (v: unknown): v is SharkId =>
  typeof v === "string" && (IDS as string[]).includes(v);

/** What a shark did on their turn, reduced to the part another shark reacts to. */
export interface RoomBeat {
  shark: SharkId;
  /** "asked", "bid", "walked" — the Chair and the founder never appear here. */
  did: "asked" | "bid" | "walked" | "held";
  spoken: string;
  question?: string;
  offer?: { amount_usd: number; equity_pct: number; implied_valuation_usd: number } | null;
}

function beatOf(line: PanelLogLine | null | undefined): RoomBeat | null {
  // A null entry is not a hypothetical: the log arrives on the wire at
  // /api/panel, and a POST carrying `log: [null]` used to throw here and take
  // the whole route to a 500 rather than a handled error. Nothing about a
  // malformed log should be able to end the round.
  if (!line || !isSharkId(line.speaker)) return null;
  const did: RoomBeat["did"] =
    line.decision === "out"
      ? "walked"
      : line.decision === "offer" || line.decision === "join" || line.decision === "revise"
        ? "bid"
        : line.decision === "hold"
          ? "held"
          : "asked";
  return {
    shark: line.speaker,
    did,
    spoken: line.spoken ?? "",
    question: line.questions?.[0],
    offer: line.offer ?? null,
  };
}

/**
 * The last thing somebody ELSE said — the thing this shark is about to react to.
 *
 * Skips the Chair (who frames and never takes a side, so agreeing with him says
 * nothing) and skips this shark's own previous turns, because a room where
 * Marcus opens by agreeing with Marcus is worse than one that never interacts.
 */
export function lastOtherBeat(log: PanelLogLine[] | undefined, me: SharkId): RoomBeat | null {
  for (let i = (log?.length ?? 0) - 1; i >= 0; i -= 1) {
    const beat = beatOf(log![i]);
    if (beat && beat.shark !== me) return beat;
  }
  return null;
}

/** Everyone who has folded so far, oldest first. */
export function whoWalked(log: PanelLogLine[] | undefined): SharkId[] {
  const out: SharkId[] = [];
  for (const line of log ?? []) {
    const beat = beatOf(line);
    if (beat?.did === "walked" && !out.includes(beat.shark)) out.push(beat.shark);
  }
  return out;
}

/**
 * WHO THESE FIVE ARE TO EACH OTHER — the room as a conversation, not a queue.
 *
 * ── The complaint this answers ─────────────────────────────────────────────
 *
 * Five sharks, five turns, and in certain situations five word-for-word
 * identical sentences. The worst offender was the defence-floor override in
 * `app/api/panel/route.ts`: when the founder answered nothing, every seat said
 * "You were asked real questions and the room got nothing back" — the same
 * string, five times, one after another. The offline negotiate turn had the
 * same shape: one pool of three lines shared by all five, and one no-counter
 * line that was literally hardcoded for the whole panel.
 *
 * Underneath that is the bigger version of the same problem: nobody in this
 * room has ever acknowledged that anybody else is in it. Panel Rulebook rule 2
 * asks for exactly that ("React to the panel log in character — agree, spar,
 * mock a rival's thesis, team up. Refer to other sharks by name"), and every
 * persona file carries a PANEL DYNAMICS line saying who they respect and who
 * they needle. None of it was ever handed to a model or read by the offline
 * room. It was five monologues that happened to share a table.
 *
 * ── What is here ──────────────────────────────────────────────────────────
 *
 * `RELATIONS` is that persona text turned into something both rooms can read:
 * for every ordered pair, how the first shark reads the second and whether
 * they are inclined to back them or take them on. The live route ships it into
 * the turn brief so the model knows who it is talking about; the offline shark
 * uses it to pick a line. One table, so the two rooms cannot disagree about
 * whether Marcus trusts Viktor.
 *
 * Everything below is quotable back to the persona files. Nothing here invents
 * a relationship the pack did not already state.
 */

export type Stance =
  /** Natural alliance. Joint offers write themselves. */
  | "ally"
  /** Different thesis, earned respect. Backs them and then adds their own half. */
  | "respect"
  /** The needle. Affectionate or not, they take the other one on. */
  | "spar"
  /** Useful, and tiring. Agrees rarely and never warmly. */
  | "wary";

export interface Relation {
  stance: Stance;
  /** How this shark would describe the other, unprompted, in one clause. */
  read: string;
}

/**
 * Read as: RELATIONS[who is speaking][who they are speaking about].
 *
 * Sourced line by line from the PANEL DYNAMICS and AT THE TABLE sections of
 * `lib/ai/prompts/shark-*.md`. Those files are verbatim from the prompt pack
 * and are not edited (see `lib/ai/prompts/README.md`) — this is a reading of
 * them, kept next to the code that needs it.
 */
export const RELATIONS: Record<SharkId, Partial<Record<SharkId, Relation>>> = {
  marcus: {
    serena: {
      stance: "spar",
      read: "she prices deals like lottery tickets, and you say so out loud rather than chase her number",
    },
    dev: {
      stance: "respect",
      read: "his operating scars are real, and his hands protect your money — your favourite joint offer",
    },
    lily: {
      stance: "wary",
      read: "you call her metrics soft, and she keeps answering you in cohort math",
    },
    viktor: {
      stance: "ally",
      read: "the only diligence at this table you trust; you never coordinate out loud and never need to",
    },
  },
  serena: {
    marcus: {
      stance: "spar",
      read: "he invests through the rearview mirror, and never let his anchor become the room's reference point",
    },
    dev: {
      stance: "respect",
      read: "he teases your trajectories, and he is still right about what breaks first",
    },
    lily: {
      stance: "ally",
      read: "your natural alliance on anything brand-led — she builds the love, you buy the reach",
    },
    viktor: {
      stance: "wary",
      read: "useful and exhausting; worth taking seriously exactly once a session and no more",
    },
  },
  dev: {
    marcus: {
      stance: "respect",
      read: "his discipline is real, and you will join his structures if he gives you the board seat",
    },
    serena: {
      stance: "spar",
      read: "trajectories don't load trucks — though when she is right about demand, that is an ops problem you would love to have",
    },
    lily: {
      stance: "ally",
      read: "she is asking about the same machine you are, from the customer end of it",
    },
    viktor: {
      stance: "spar",
      read: "you suspect he has never shipped anything but doubt, and execution risk is the one risk you can buy down personally",
    },
  },
  lily: {
    marcus: {
      stance: "spar",
      read: "he calls your metrics soft, and you enjoy answering him in cohorts",
    },
    serena: {
      stance: "ally",
      read: "she buys the reach and you build the love; the joint offer usually writes itself",
    },
    dev: {
      stance: "respect",
      read: "he fixes the thing your customers are actually complaining about",
    },
    viktor: {
      stance: "spar",
      read: "the affectionate feud — he thinks customers are churn risks, you think they compound",
    },
  },
  viktor: {
    marcus: {
      stance: "ally",
      read: "the only one here you half-respect; when you both go quiet at once the founder should worry",
    },
    serena: {
      stance: "spar",
      read: "her optimism is a rounding error away from fraud, and you say it charmingly",
    },
    dev: {
      stance: "spar",
      read: "he buys down the risk he can touch and waves at everything he cannot",
    },
    lily: {
      stance: "spar",
      read: "the affectionate feud — she counts the ones who stayed, you count the ones who left",
    },
  },
};

export function relationOf(shark: SharkId, other: SharkId): Relation {
  return (
    RELATIONS[shark]?.[other] ?? {
      stance: "wary",
      read: "another seat at the same table",
    }
  );
}

/** Whether this shark's instinct is to back the other one or to take them on. */
export const backs = (stance: Stance): boolean => stance === "ally" || stance === "respect";

/** First names, because that is how a panel actually addresses each other. */
export const firstName = (id: SharkId): string => (CAST[id]?.name ?? "").split(" ")[0] || "";

// ── What one shark says about another, out loud ─────────────────────────────

/**
 * The pairs the personas name explicitly.
 *
 * These are the lines these two specific people would actually say to each
 * other — Serena's "he's pricing your past", Dev's "trajectories don't load
 * trucks", Lily's cohort-math needle at Marcus. Generic reactions are below and
 * cover every pair; these exist so the pairs the pack bothered to write about
 * sound like they have history, because they do.
 */
const SIGNATURE: Partial<Record<SharkId, Partial<Record<SharkId, string[]>>>> = {
  marcus: {
    serena: ["Serena can have the vision. I want the arithmetic."],
    viktor: ["Viktor and I are reading the same line. He'll be polite about it and I won't."],
    lily: ["Lily's metrics are soft. Mine aren't, so let's do mine."],
  },
  serena: {
    marcus: [
      "Marcus is pricing your past. I'm pricing your future.",
      "Don't let Marcus's number become the price of this company.",
    ],
    viktor: ["Viktor gets one real risk a session, and he's just spent it."],
    lily: ["Lily and I usually end up on the same side of this one."],
  },
  dev: {
    serena: ["Trajectories don't load trucks, Serena."],
    marcus: ["Marcus is buying the structure. I'm buying whether it runs on a Monday."],
    viktor: [
      "Viktor's already written the obituary. Execution risk is the one risk somebody can actually fix.",
    ],
  },
  lily: {
    marcus: ["Marcus calls my metrics soft. Watch."],
    viktor: [
      "Viktor thinks your customers are churn risks. I think they compound. Settle it for us.",
    ],
    serena: ["Serena's buying the reach. I want to know whether there's anything to come back to."],
  },
  viktor: {
    serena: ["Serena's optimism is charming, as always. Let's do the math anyway."],
    marcus: ["Marcus already found it. I'll say the part he was being polite about."],
    lily: ["Lily counts the ones who stayed. I'd like to talk about the ones who left."],
  },
};

/**
 * The general move, in each shark's own register.
 *
 * `with` is the agreement family the room was missing entirely — the "I agree
 * with what Serena just asked" beat, which is the single most ordinary thing
 * five people at a table do and the one this panel had never once done.
 * `against` is the needle. Which one fires is the stance, softened by a die
 * roll: a room where the same two people always agree is a lookup table, and
 * every persona file explicitly forbids being one.
 */
const REACT: Record<SharkId, { with: (r: string) => string[]; against: (r: string) => string[] }> = {
  marcus: {
    with: (r) => [
      `${r} asked the right question. I'm going to ask it again with a number attached.`,
      `I agree with ${r}, which doesn't happen often. Now the arithmetic.`,
    ],
    against: (r) => [
      `${r} is pricing a story. I'm pricing a company.`,
      `You can answer ${r} in a minute. Answer me first, with a figure.`,
    ],
  },
  serena: {
    with: (r) => [
      `${r} is right, and I'd go further than that.`,
      `I agree with what ${r} just asked — I want the bigger version of the answer.`,
    ],
    against: (r) => [
      `${r} is measuring the room you're standing in. I want to know how big the building gets.`,
      `Put ${r} aside for one minute and dream bigger for me.`,
    ],
  },
  dev: {
    with: (r) => [
      `${r} is asking about the machine, and so am I.`,
      `Same question ${r} asked, from the workshop end of it.`,
    ],
    against: (r) => [
      `${r} can have the story. I want the mechanics.`,
      `Fine question, ${r}. Mine is more boring and it matters more.`,
    ],
  },
  lily: {
    with: (r) => [
      `${r} is right, and there are people underneath that number.`,
      `I agree with ${r}. I want the same answer with a customer in it.`,
    ],
    against: (r) => [
      `${r} is counting. I'd like to ask who's being counted.`,
      `You'll get the spreadsheet version from ${r}. Mine needs a name in it.`,
    ],
  },
  viktor: {
    with: (r) => [
      `${r} found it. I'll say the part they were being polite about.`,
      `I agree with ${r}, and I think it's worse than they said.`,
    ],
    against: (r) => [
      `${r} is being generous. I'm going to be early.`,
      `Charming, ${r}. Now help me with the math.`,
    ],
  },
};

/**
 * One shark taking a position on the last thing another shark said.
 *
 * Returns "" when there is nobody to react to — the first voice after the Chair
 * has an empty room behind them, and faking a reaction there is the tell.
 */
export function crossTalkOnQuestion(
  shark: SharkId,
  other: SharkId,
  rng: () => number,
): string {
  if (shark === other) return "";
  const { stance } = relationOf(shark, other);
  /*
   * The stance is an inclination, not a rule. One turn in five an ally needles
   * and a rival concedes, which is both truer to the personas ("never respond
   * like a lookup table — you are a person, not a decision tree") and the only
   * thing stopping a repeat playthrough hearing the identical exchange.
   */
  const agreeing = rng() < (backs(stance) ? 0.8 : 0.2);
  const r = firstName(other);
  const pool = [
    ...(agreeing ? [] : SIGNATURE[shark]?.[other] ?? []),
    ...REACT[shark][agreeing ? "with" : "against"](r),
  ];
  return pool[Math.floor(rng() * pool.length)] ?? "";
}

// ── Reacting to the money ───────────────────────────────────────────────────

const ON_A_RIVAL_BID: Record<
  SharkId,
  { with: (r: string, m: string) => string; against: (r: string, m: string) => string }
> = {
  marcus: {
    with: (r, m) => `${r} is in at ${m} and I don't hate it.`,
    against: (r, m) => `${r} is at ${m}. That number has a mood. Here's one that doesn't.`,
  },
  serena: {
    with: (r, m) => `${r} is at ${m}, and that's a fair floor. I don't bid floors.`,
    against: (r, m) => `${r} just anchored you at ${m}. Don't let that become what you're worth.`,
  },
  dev: {
    with: (r, m) => `${r} is at ${m}, and I'd happily sit alongside that.`,
    against: (r, m) => `${r} is offering ${m} and no hands.`,
  },
  lily: {
    with: (r, m) => `${r} is at ${m} and I'm not here to undercut a good offer.`,
    against: (r, m) => `${r} priced the ledger at ${m}. I'm pricing the people, and I get a different number.`,
  },
  viktor: {
    with: (r, m) => `${r} is at ${m}. I'll be in the same neighbourhood and slower about it.`,
    against: (r, m) => `${r} is at ${m}, which is what optimism costs.`,
  },
};

const ON_A_RIVAL_WALKING: Record<SharkId, { with: (r: string) => string; against: (r: string) => string }> = {
  marcus: {
    with: (r) => `${r} walked, and for the right reason.`,
    against: (r) => `${r} walked. I'm staying, and I'm pricing it like someone who watched him leave.`,
  },
  serena: {
    with: (r) => `${r} is out, and I understand why.`,
    against: (r) => `${r} is out, so you've heard the safe read. I've never made money on the safe read.`,
  },
  dev: {
    with: (r) => `${r} is out and I can see it from here.`,
    against: (r) => `${r} is out on the risk. That's the one risk somebody in this room can fix.`,
  },
  lily: {
    with: (r) => `${r} is out, and I don't enjoy agreeing with that.`,
    against: (r) => `${r} is out on the numbers. The numbers aren't the whole company.`,
  },
  viktor: {
    with: (r) => `${r} is out. That's two of us reading the same page.`,
    against: (r) => `${r} left early. I prefer to stay and watch.`,
  },
};

/** "Serena's in at $500K." — said before this shark states their own terms. */
export function onRivalBid(
  shark: SharkId,
  rival: SharkId,
  moneyLabel: string,
  rng: () => number,
): string {
  if (shark === rival) return "";
  const { stance } = relationOf(shark, rival);
  const agreeing = rng() < (backs(stance) ? 0.8 : 0.2);
  return ON_A_RIVAL_BID[shark][agreeing ? "with" : "against"](firstName(rival), moneyLabel);
}

/** "Viktor's out. I'm not far behind." */
export function onRivalWalking(shark: SharkId, rival: SharkId, rng: () => number): string {
  if (shark === rival) return "";
  const { stance } = relationOf(shark, rival);
  const agreeing = rng() < (backs(stance) ? 0.8 : 0.2);
  return ON_A_RIVAL_WALKING[shark][agreeing ? "with" : "against"](firstName(rival));
}

// ── Nothing to price ────────────────────────────────────────────────────────

/**
 * Walking because the questions went unanswered — in five different voices.
 *
 * This replaces the one hardcoded sentence that `app/api/panel/route.ts` put in
 * all five mouths in a row. It is the situation where identical answers were
 * most visible and most damaging, because it is also the situation where the
 * founder most needs to believe five separate people reached the same verdict
 * separately.
 */
const NOTHING_TO_PRICE: Record<SharkId, string> = {
  marcus:
    "You were asked for numbers and the room got weather. I price what I'm told and I wasn't told anything. I'm out.",
  serena:
    "I can forgive a small number. I can't do anything at all with silence. I'm out.",
  dev: "I asked how it works and nothing came back. I don't buy machines I'm not allowed to look inside. I'm out.",
  lily: "You didn't have to be polished. You did have to be here. Nothing came back, so neither can I. I'm out.",
  viktor:
    "Unanswered questions are the diligence, and you've just done mine for me. I'm out.",
};

/**
 * Acknowledging the seat that just walked — one phrasing per shark.
 *
 * Deliberately per seat rather than one "same page as X" template reused five
 * times. A shared template is the identical-answers bug at one remove: the
 * names change and the sentence does not, and after two of them a player is
 * hearing the machine again. Pronoun-free throughout, since which seat is being
 * acknowledged is decided at runtime.
 */
const NOD_TO_A_WALKER: Record<SharkId, { with: (r: string) => string; against: (r: string) => string }> = {
  marcus: {
    with: (r) => `${r} said it first and said it correctly.`,
    against: (r) => `${r} beat me to it, and we don't often agree.`,
  },
  serena: {
    with: (r) => `${r} already said this, and I'm not going to dress it up.`,
    against: (r) => `Even ${r} got there before me, which should worry you.`,
  },
  dev: {
    with: (r) => `${r} said it. Same read, from the workshop end.`,
    against: (r) => `${r} got there first. I'd have used shorter words.`,
  },
  lily: {
    with: (r) => `Same page as ${r}, and I'm sorry about that.`,
    against: (r) => `${r} said it before I could, and I wanted to be wrong.`,
  },
  viktor: {
    with: (r) => `${r} and I have landed in the same place, which never helps a founder.`,
    against: (r) => `${r} found it before I did. That is genuinely unusual.`,
  },
};

/**
 * The same verdict, said by someone who heard the last person say it.
 *
 * `alreadyOut` is who has walked before this shark speaks. When the room is
 * emptying for one shared reason, sharks acknowledge each other instead of
 * reciting — which is the difference between a panel agreeing and a bug.
 */
export function nothingToPriceLine(shark: SharkId, alreadyOut: SharkId[] = []): string {
  const base = NOTHING_TO_PRICE[shark] ?? NOTHING_TO_PRICE.marcus;
  const other = alreadyOut.filter((id) => id !== shark).at(-1);
  if (!other) return base;
  const nod = NOD_TO_A_WALKER[shark] ?? NOD_TO_A_WALKER.marcus;
  return `${backs(relationOf(shark, other).stance) ? nod.with(firstName(other)) : nod.against(firstName(other))} ${base}`;
}
