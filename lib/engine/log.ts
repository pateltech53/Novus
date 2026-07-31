import type { LogLine, RunState } from "./types";
import { fmtMoney, fmtMonths } from "./format";
import { deriveRunwayMonths } from "./sim";
import { pickOne, type Rng } from "./rng";

/**
 * Voice v2 line banks — second person, present tense, dry needle.
 * The narrator needles decisions, never the kid. Placeholders are injected
 * with real Books numbers at compose time.
 */
const LINES = {
  profitable: [
    "Revenue: {rev}. Burn: {burn}. The books are… fine. Don't get used to it.",
    "You made more than you spent this month. Frame it.",
    "Profitable. The shark checks the number twice. It holds.",
    "Money in exceeds money out. This is the whole trick. Keep doing it.",
    "The books balance in your favor. Somewhere, an accountant smiles.",
    "Green month. Enjoy the novelty of not explaining yourself.",
  ],
  losingPolitely: [
    "Revenue: {rev}. Burn: {burn}. You are losing money politely.",
    "The gap between in and out is small enough to ignore. You ignore it.",
    "Still underwater, but swimming with style.",
    "You lose a little money every month. It adds up. That's what runway is for.",
    "Burn exceeds revenue. The polite word for this is 'investing'.",
    "Another month of paying for the privilege of existing.",
  ],
  hemorrhaging: [
    "Revenue: {rev}. Burn: {burn}. This is not a leak, it's a hole.",
    "The money is leaving faster than it arrives. Considerably faster.",
    "Your burn rate has opinions about your future. Loud ones.",
    "Cash is exiting the building. It did not say goodbye.",
    "At this rate the bank account becomes a rumor.",
  ],
  flat: [
    "Revenue: {rev}. Burn: {burn}. Nothing moved. Even the shark yawned.",
    "A flat month. The market noticed you exactly as much as last month.",
    "Numbers unchanged. Somewhere, Marco shipped something.",
  ],
  quiet: [
    "A quiet month. Suspiciously quiet.",
    "No fires this month. You check twice.",
    "The phone doesn't ring. You get actual work done.",
    "Nothing breaks. You almost miss the chaos. Almost.",
    "A month of just… running the company. Rare. Pleasant. Brief.",
    "The inbox stays boring. Take the win.",
    "Everyone does their job this month, including you.",
    "Calm. The market is saving up for something.",
  ],
  lowRunway: [
    "Runway: {runway}. The word gets less abstract every time.",
    "Runway: {runway}. Start deciding what you'd regret not trying.",
    "{runway} of cash left at this burn. The math is not subtle.",
    "Runway: {runway}. The shark stops smiling when it's single digits.",
  ],
  redCash: [
    "Cash: {cash}. That's a minus sign. Banks notice minus signs.",
    "You are officially spending money you don't have.",
    "The account is negative. This has a deadline attached.",
  ],
  yearOpen: [
    "Fiscal Year {year}. {company} is still here. Prove it deserves to be.",
    "Year {year} opens. The market did not wait for you.",
    "A new fiscal year. Same books, higher stakes.",
    "Fiscal Year {year}. Twelve months. One pitch at the end of them.",
  ],
  stageUp: {
    2: ["Welcome to Startup stage. Real revenue, real problems.", "You've outgrown the garage. The bills noticed first."],
    3: ["Welcome to Growth stage. Bigger checks, bigger fires.", "Growth stage. Everything scales now — including the mistakes."],
    4: ["Scale stage. You have departments now. Departments have politics.", "Welcome to Scale. The decisions get heavier from here."],
    5: ["Public territory. Everyone can see your books now. Everyone.", "Unicorn air. Thin, expensive, full of lawyers."],
  } as Record<number, string[]>,
  coasting: [
    "Days pass. The company coasts. Coasting is not a strategy.",
    "You were gone. The company idled. Marco wasn't idle.",
    "Nothing died while you were away. Nothing grew either.",
  ],
} as const;

let lineCounter = 0;
const nextId = () => `L${++lineCounter}-${Math.random().toString(36).slice(2, 7)}`;

export function makeLine(
  state: RunState,
  kind: LogLine["kind"],
  text: string,
  deltas?: LogLine["deltas"],
): LogLine {
  return { id: nextId(), year: state.year, month: state.month, kind, text, deltas };
}

function inject(state: RunState, template: string): string {
  return template
    .replaceAll("{rev}", fmtMoney(state.stats.revenueAnnual / 12))
    .replaceAll("{burn}", fmtMoney(Math.max(0, state.stats.burnMonthly)))
    .replaceAll("{cash}", fmtMoney(state.stats.cash))
    .replaceAll("{runway}", fmtMonths(deriveRunwayMonths(state)))
    .replaceAll("{valuation}", fmtMoney(state.stats.valuation))
    .replaceAll("{month}", String(state.month))
    .replaceAll("{year}", String(state.year))
    .replaceAll("{company}", state.companyName);
}

export function monthRule(state: RunState): LogLine {
  return makeLine(state, "month-rule", `MONTH ${state.month} · FISCAL YEAR ${state.year}`);
}

/** The monthly finance line, tone picked from the actual Books. */
export function financeLine(state: RunState, rng: Rng): LogLine {
  const revMo = state.stats.revenueAnnual / 12;
  const burn = state.stats.burnMonthly;
  let bank: readonly string[];
  if (burn <= 0) bank = LINES.profitable;
  else if (revMo === 0 || burn > revMo * 0.6) bank = LINES.hemorrhaging;
  else if (burn > revMo * 0.12) bank = LINES.losingPolitely;
  else bank = LINES.flat;
  // Pre-revenue months read as polite loss, not hemorrhage, in year one.
  if (revMo === 0 && state.year === 1) bank = LINES.losingPolitely;
  return makeLine(state, "finance", inject(state, pickOne([...bank], rng)));
}

export function quietLine(state: RunState, rng: Rng): LogLine {
  return makeLine(state, "narration", pickOne([...LINES.quiet], rng));
}

export function runwayWarning(state: RunState, rng: Rng): LogLine | null {
  const runway = deriveRunwayMonths(state);
  if (state.stats.cash < 0) {
    return makeLine(state, "finance", inject(state, pickOne([...LINES.redCash], rng)));
  }
  if (runway < 5) {
    return makeLine(state, "finance", inject(state, pickOne([...LINES.lowRunway], rng)));
  }
  return null;
}

export function yearOpenLine(state: RunState, rng: Rng): LogLine {
  return makeLine(state, "year-open", inject(state, pickOne([...LINES.yearOpen], rng)));
}

export function stageUpLine(state: RunState, stage: number, rng: Rng): LogLine {
  const bank = LINES.stageUp[stage] ?? ["The company changes weight class."];
  return makeLine(state, "milestone", pickOne(bank, rng));
}

export function coastLine(state: RunState, rng: Rng): LogLine {
  return makeLine(state, "system", pickOne([...LINES.coasting], rng));
}
