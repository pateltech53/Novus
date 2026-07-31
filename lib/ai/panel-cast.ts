import type { SharkId } from "./types";

/**
 * The Panel — five investors with faces.
 *
 * The panel used to be one 80×80 mascot in a header and five *names in a list*.
 * Every shark now has their own portrait, so the room is a room: you can see
 * who is talking, who has leaned in, and who has folded and is still sitting
 * there watching you.
 *
 * Seat order is left-to-right as rendered and is deliberately fixed — players
 * should learn where Marcus sits the way you learn where someone sits at a
 * table.
 */

export interface SharkCast {
  id: SharkId;
  name: string;
  /** The epithet the GDD gives them. */
  tag: string;
  portrait: string;
  /** One line on what they actually care about — used for the seat tooltip. */
  cares: string;
}

export const PANEL: SharkCast[] = [
  {
    id: "marcus",
    name: "Marcus Cole",
    tag: "The Ledger",
    portrait: "/sharks/marcus.webp",
    cares: "Unit economics. He will ask for the number behind your number.",
  },
  {
    id: "serena",
    name: "Serena Voss",
    tag: "Blue Sky",
    portrait: "/sharks/serena.webp",
    cares: "How big this gets. She forgives a bad quarter, never a small idea.",
  },
  {
    id: "dev",
    name: "Dev Okafor",
    tag: "The Wrench",
    portrait: "/sharks/dev.webp",
    cares: "Whether it actually works. He has built the thing you are describing.",
  },
  {
    id: "lily",
    name: "Lily Zhang",
    tag: "The Loyalist",
    portrait: "/sharks/lily.webp",
    cares: "Your people and your customers. She notices who you thank.",
  },
  {
    id: "viktor",
    name: "Viktor Reyes",
    tag: "The Autopsy",
    portrait: "/sharks/viktor.webp",
    cares: "How this dies. He is not being cruel; he is being early.",
  },
];

export const CAST: Record<SharkId, SharkCast> = Object.fromEntries(
  PANEL.map((s) => [s.id, s]),
) as Record<SharkId, SharkCast>;

/** The Chair frames the round but never bids, so it has no seat. */
export const CHAIR = { name: "The Chair", tag: "" } as const;

export const castOf = (id: string): SharkCast | null => CAST[id as SharkId] ?? null;

/**
 * How a seat is currently reading the room. Legible at a glance, without text.
 * `out` stays visible: a shark who folded is part of the story.
 */
export type SeatState =
  | "idle"
  | "speaking"
  | "listening"
  | "interested"
  | "skeptical"
  | "bidding"
  | "out";
