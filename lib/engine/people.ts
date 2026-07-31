/**
 * The roster and the hiring pool. Employees are people with names and track
 * records, not a headcount integer — firing one should cost you something you
 * can see.
 */

import { mulberry32, hashString } from "./rng";
import type { RunState } from "./types";
import { S_UNIT } from "./constants";

export type Seat = "COO" | "CMO" | "CTO" | "CFO" | "IC";

export interface Employee {
  id: string;
  name: string;
  role: string;
  seat: Seat;
  /** 0–100. Drifts with morale and tenure; drives their stat aura. */
  performance: number;
  /** 0–100. Low loyalty means a rival can poach them. */
  loyalty: number;
  /** Monthly cost in S units at the stage they were hired. */
  salaryS: number;
  hiredYear: number;
  /** What they move while they're on the team. */
  aura: { stat: "qual" | "brand" | "morale" | "csat" | "gm_pt"; amount: number };
  bio: string;
}

export interface Candidate extends Omit<Employee, "hiredYear"> {
  /** LinkedOut headline. */
  headline: string;
  /** Signing cost in S units. */
  signingS: number;
  /** Pro-only candidates are visibly better and visibly locked. */
  pro?: boolean;
}

const FIRST = [
  "Ama", "Rosa", "Dev", "Nina", "Omar", "Priya", "Kai", "Lena", "Tomas", "Ines",
  "Yusuf", "Mei", "Jonah", "Sade", "Petra", "Andre", "Hana", "Marcus", "Zoe", "Ravi",
];
const LAST = [
  "Okonkwo", "Delgado", "Mehta", "Larsen", "Haddad", "Nair", "Bergström", "Ferreira",
  "Kowalski", "Duarte", "Osei", "Tanaka", "Whitfield", "Bello", "Novak", "Reyes",
];

const SEAT_ROLES: Record<Seat, { role: string; aura: Employee["aura"] }[]> = {
  COO: [{ role: "Head of Operations", aura: { stat: "gm_pt", amount: 3 } }],
  CMO: [{ role: "Head of Marketing", aura: { stat: "brand", amount: 6 } }],
  CTO: [{ role: "Head of Engineering", aura: { stat: "qual", amount: 7 } }],
  CFO: [{ role: "Head of Finance", aura: { stat: "gm_pt", amount: 4 } }],
  IC: [
    { role: "Support Lead", aura: { stat: "csat", amount: 5 } },
    { role: "Product Designer", aura: { stat: "qual", amount: 4 } },
    { role: "Account Manager", aura: { stat: "brand", amount: 3 } },
    { role: "Operations Associate", aura: { stat: "gm_pt", amount: 2 } },
    { role: "Community Manager", aura: { stat: "csat", amount: 4 } },
  ],
};

const BIOS = [
  "Did the ugly jobs at a company you've heard of. Doesn't mention it.",
  "Left a bigger title for a smaller room. Says the room matters more.",
  "Quietly fixes things before anyone files a ticket about them.",
  "Argues with you in private and backs you in public.",
  "Has opinions about process. Most of them are right.",
  "Came from a competitor. Won't say a bad word about them, which tells you something.",
  "First real job. Learns faster than anyone else on the team.",
  "Been doing this fifteen years and still reads the manual.",
];

/** A deterministic candidate pool that refreshes each fiscal month. */
export function candidatePool(state: RunState, count = 5): Candidate[] {
  const rng = mulberry32(hashString(`${state.id}:hire:${state.year}:${state.month}`));
  const out: Candidate[] = [];

  for (let i = 0; i < count; i++) {
    const seat: Seat = i === 0 && state.stage >= 2 ? pickSeat(rng) : "IC";
    const roleDef = SEAT_ROLES[seat][Math.floor(rng() * SEAT_ROLES[seat].length)];
    /*
     * Pro gates VISIBILITY of the last two candidates, never their quality.
     *
     * This used to roll Pro candidates at 72–96 against free's 48–78, which made
     * a subscription buy hiring auras, and auras reach qual/brand/csat — i.e.
     * valuation. That is Brand Law 4 broken in a for-loop. Every candidate now
     * rolls on the SAME 48–96 curve; what Pro buys is a wider slice of the same
     * market, which is what "full talent pool" honestly means.
     */
    const pro = i >= count - 2; // the last two require Pro to SEE, not to be better
    const performance = Math.round(48 + rng() * 48);
    const name = `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`;

    out.push({
      id: `cand-${state.year}-${state.month}-${i}`,
      name,
      role: roleDef.role,
      seat,
      performance,
      loyalty: Math.round(45 + rng() * 40),
      salaryS: +( (seat === "IC" ? 0.15 : 0.35) * (1 + performance / 140) ).toFixed(2),
      signingS: +(rng() * (seat === "IC" ? 0.6 : 1.6)).toFixed(2),
      aura: {
        stat: roleDef.aura.stat,
        amount: Math.max(1, Math.round(roleDef.aura.amount * (performance / 70))),
      },
      headline: `${roleDef.role} · ${performance >= 75 ? "Top decile" : performance >= 55 ? "Solid track record" : "Early career"}`,
      bio: BIOS[Math.floor(rng() * BIOS.length)],
      pro,
    });
  }
  return out;
}

function pickSeat(rng: () => number): Seat {
  const seats: Seat[] = ["COO", "CMO", "CTO", "CFO"];
  return seats[Math.floor(rng() * seats.length)];
}

export function hire(state: RunState, candidate: Candidate): void {
  const S = S_UNIT[state.stage];
  state.stats.cash -= candidate.signingS * S;
  state.burnDeltaS += candidate.salaryS;
  state.stats.employees += 1;
  state.roster.push({
    id: `emp-${state.roster.length}-${candidate.id}`,
    name: candidate.name,
    role: candidate.role,
    seat: candidate.seat,
    performance: candidate.performance,
    loyalty: candidate.loyalty,
    salaryS: candidate.salaryS,
    hiredYear: state.year,
    aura: candidate.aura,
    bio: candidate.bio,
  });
  applyAura(state, candidate.aura, 1);
}

export function fire(state: RunState, employeeId: string): Employee | null {
  const idx = state.roster.findIndex((e) => e.id === employeeId);
  if (idx < 0) return null;
  const [gone] = state.roster.splice(idx, 1);
  state.burnDeltaS = Math.max(0, state.burnDeltaS - gone.salaryS);
  state.stats.employees = Math.max(0, state.stats.employees - 1);
  applyAura(state, gone.aura, -1);
  state.stats.morale = Math.max(0, state.stats.morale - 6);
  return gone;
}

function applyAura(state: RunState, aura: Employee["aura"], sign: 1 | -1) {
  const amount = aura.amount * sign;
  switch (aura.stat) {
    case "qual":
      state.stats.qual = clamp(state.stats.qual + amount);
      break;
    case "brand":
      state.stats.brand = clamp(state.stats.brand + amount);
      break;
    case "morale":
      state.stats.morale = clamp(state.stats.morale + amount);
      break;
    case "csat":
      state.stats.csat = clamp(state.stats.csat + amount);
      break;
    case "gm_pt":
      state.stats.grossMarginPt = Math.min(95, Math.max(2, state.stats.grossMarginPt + amount));
      break;
  }
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Yearly drift: performance follows morale, loyalty follows tenure and pay. */
export function tickRoster(state: RunState) {
  for (const e of state.roster) {
    const moraleEffect = (state.stats.morale - 55) / 12;
    e.performance = clamp(Math.round(e.performance + moraleEffect));
    e.loyalty = clamp(Math.round(e.loyalty + (state.stats.morale > 60 ? 3 : -5)));
  }
}
