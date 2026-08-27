/**
 * What a choice costs, read at a glance.
 *
 * ── What it was ───────────────────────────────────────────────────────────
 *
 * A grey pill: `bg-[var(--chip)]` with `text-[var(--text-secondary)]` on it —
 * grey on grey, at the 12px floor, holding the one piece of information the
 * whole decision turns on. Three options meant reading three strings one after
 * another and holding them in your head to compare, when they are a table.
 *
 * ── What it is ────────────────────────────────────────────────────────────
 *
 * The same authored string, unrewritten, set in the ledger's own face at full
 * ink, with each clause coloured by whether the money moved the right way.
 * The costs of three options then land on one vertical axis in one column and
 * can be scanned rather than read.
 *
 * This is what the iOS native sheet has already shipped for a while —
 * `monospacedSystemFont(ofSize: 12, weight: .semibold)` in `UIColor.label`
 * (GlassSheetController.swift) — so the change is the web and Android catching
 * up to it, plus the direction colour on both.
 *
 * ── Why parsing authored strings is safe here ─────────────────────────────
 *
 * `choice.known` is authored content and `data/sections/*.json` is protected:
 * nothing here rewrites a single character of it. The parse is read-only and
 * conservative — it looks for `<Metric> <sign><rest>`, and ANY clause it does
 * not recognise, or any metric not on the explicit list below, renders at full
 * ink with no colour at all. Of 577 chips in the library, 17 are unsigned
 * phrases ("free", "Cash saved", "dilution 7%") and they simply stay neutral.
 *
 * Colour is never the only carrier: the sign is in the text, where it always
 * was.
 */

/**
 * Which way is the good way, per metric.
 *
 * Taken from the app's own semantics rather than invented here — `diffStats`
 * in lib/state/GameProvider.tsx pushes every stat with `goodWhenUp = true`
 * except churn, and TheBooks marks a burn at or below zero as `good`. The
 * short forms are the ones the event library actually uses; anything absent
 * from this map is deliberately left uncoloured rather than guessed at, because
 * a cost painted the wrong way is worse than a cost painted no way.
 */
const GOOD_WHEN_UP: Record<string, boolean> = {
  // More is better.
  cash: true,
  rev: true,
  brand: true,
  csat: true,
  qual: true,
  quality: true,
  mor: true,
  morale: true,
  en: true,
  energy: true,
  resp: true,
  respect: true,
  gm: true,
  share: true,
  val: true,
  emp: true,
  runway: true,
  // Read off the library rather than assumed: every CTR rise is paired with a
  // revenue rise and the only fall is the do-nothing option (E-MKT-008,
  // E-PERF-002); every CWP rise is something a choice PAYS for in cash or
  // share, and the only fall is ignoring the problem (E-IND-GRN-3, E-RIV-007).
  ctr: true,
  cwp: true,
  // Less is better. Burn and churn are the two the game itself inverts;
  // COGS and CAC are costs by definition.
  burn: false,
  churn: false,
  cogs: false,
  cac: false,
};

/**
 * `Cash −2S`, `Burn +0.1S/mo`, `Rev +25% this yr`.
 *
 * Group 1 is the metric, group 2 the sign, group 3 whatever follows. The
 * metric is letters and spaces only, so "En cap −5" resolves to "en cap" —
 * which is not on the map, so it stays neutral, which is the correct outcome
 * for a clause nobody has classified.
 */
const CLAUSE = /^([A-Za-z][A-Za-z ]*?)\s*([+−-])\s*(.+)$/;

type Tone = "up" | "down" | "flat";

function toneOf(clause: string): Tone {
  const m = clause.match(CLAUSE);
  if (!m) return "flat";
  const goodWhenUp = GOOD_WHEN_UP[m[1].trim().toLowerCase()];
  if (goodWhenUp === undefined) return "flat";
  // U+2212 MINUS is what the library and `fmtMoney` both write; ASCII hyphen
  // is accepted because a few authored clauses use it.
  const rose = m[2] === "+";
  return rose === goodWhenUp ? "up" : "down";
}

const TONE_CLASS: Record<Tone, string> = {
  up: "text-[var(--solvency)]",
  down: "text-[var(--alert)]",
  flat: "text-[var(--text-primary)]",
};

export function CostChip({ known, className = "" }: { known: string; className?: string }) {
  const clauses = known.split("·").map((c) => c.trim()).filter(Boolean);
  return (
    <span
      // `.tnum` already carries `--font-ledger` and tabular figures; a
      // `font-mono` here would replace the ledger face with Tailwind's default
      // stack and quietly undo the one thing this chip is for.
      //
      // NOT `shrink-0`: the longest authored strings (41 mono characters) are
      // wider than a whole choice row on a phone, and a chip that refuses to
      // shrink ran over the "?" button and out of the sheet. The chip shrinks
      // to its min-content instead — each CLAUSE stays whole (nowrap below),
      // so lines break only at the separators and stack on the right edge.
      className={`tnum text-right text-2xs font-semibold ${className}`}
    >
      {clauses.map((clause, i) => (
        <span key={`${clause}-${i}`}>
          {i > 0 && <span className="text-[var(--text-tertiary)]"> · </span>}
          <span className={`whitespace-nowrap ${TONE_CLASS[toneOf(clause)]}`}>{clause}</span>
        </span>
      ))}
    </span>
  );
}
