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

export function fmtDelta(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${fmtMoney(Math.abs(n)).replace("$", "$")}`.replace("+$", "+$");
}

export const MONTH_NAMES = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
