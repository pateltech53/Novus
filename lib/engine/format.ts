/** Display rules (GDD §5): money compresses — 12.4K / 3.1M / 1.2B. */

export function fmtMoney(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${trim(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}$${trim(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function trim(x: number): string {
  const s = x >= 100 ? Math.round(x).toString() : x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export function fmtMonths(m: number): string {
  if (!isFinite(m) || m > 99) return "∞";
  return `${Math.max(0, Math.floor(m))}mo`;
}

export function fmtPct(n: number, signed = false): string {
  const rounded = Math.round(n * 10) / 10;
  const s = `${Math.abs(rounded)}%`;
  if (!signed) return s;
  return rounded < 0 ? `−${s}` : `+${s}`;
}

/**
 * A signed money change — "+$3.2K", "−$2,000".
 *
 * This existed with two replaces that each swapped a string for itself, and no
 * caller, so nothing ever noticed. It has one now: the ledger's
 * month-over-month line. `fmtMoney` already renders its own U+2212 for a
 * negative, so the sign is applied to the absolute value exactly once.
 */
export function fmtDelta(n: number): string {
  return `${n < 0 ? "−" : "+"}${fmtMoney(Math.abs(n))}`;
}

/**
 * A signed change in months — "+2mo", "−1mo".
 *
 * Not `fmtMonths`, which collapses anything over 99 to "∞": an infinity is a
 * legitimate runway and a nonsense *change*, so a move into or out of the
 * clamp is reported as the plain number of months it is worth.
 */
export function fmtMonthsDelta(m: number): string {
  const whole = Math.round(m);
  return `${whole < 0 ? "−" : "+"}${Math.abs(whole)}mo`;
}

export const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

/** 1-based game month → an index MONTH_NAMES actually has. */
const monthName = (m: number): string => MONTH_NAMES[Math.min(11, Math.max(0, m - 1))];

/**
 * Where the year is, and where one tap takes it — "MAY → JUN".
 *
 * This is the whole of what a twelve-tick meter above the advance button and a
 * MONTH 4 OF 12 caption below it used to say between them: the same fact,
 * drawn twice, in two materials that were not the app's. It is one capsule now,
 * beside the button rather than wrapped around it, and it says the thing the
 * button is actually about rather than the thing the calendar is.
 *
 * At the gate the next stop is not a month. Saying JAN there would promise a
 * year that closes without a pitch, and the year does not close without one.
 */
export function monthBadge(month: number, year: number, atGate: boolean): string {
  return atGate
    ? `${monthName(month)} → FY${year + 1}`
    : `${monthName(month)} → ${monthName(month + 1)}`;
}

/** The same, spoken. An arrow is a picture; VoiceOver reads it as nothing. */
export function monthBadgeLabel(month: number, year: number, atGate: boolean): string {
  return atGate
    ? `${monthName(month)}. Closing fiscal year ${year}.`
    : `${monthName(month)}. Advances to ${monthName(month + 1)}.`;
}
