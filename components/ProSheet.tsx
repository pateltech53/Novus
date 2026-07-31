"use client";

import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";

/**
 * Novus Pro — simulated. There's no billing here; the toggle exists so the
 * whole Pro surface can be played and judged.
 *
 * Brand Law 4 is the design, not a disclaimer: Pro adds CONTENT (industries,
 * cosmetics, candidates, asset classes). It never adds outcomes — no better
 * scores, no survival advantage, no leaderboard movement.
 */
const ROWS: { label: string; free: string; pro: string }[] = [
  { label: "Industries", free: "4", pro: "12" },
  { label: "Closet items", free: "Basics", pro: "Every colour + accessory" },
  { label: "LinkedOut pool", free: "Standard", pro: "Full talent pool" },
  { label: "Asset classes", free: "Property, equipment", pro: "+ art, islands" },
  { label: "Replay analytics", free: "Score only", pro: "Full transcript + filler map" },
  { label: "Pitch retries", free: "1 / day", pro: "Practice Gym" },
  { label: "Score, survival, leaderboard", free: "Identical", pro: "Identical" },
];

export function ProSheet({ onClose }: { onClose: () => void }) {
  const { run, setPro } = useGame();
  if (!run) return null;
  const active = run.pro;

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)]"
      />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="Novus Pro"
        className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[1.75rem] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
        initial={{ y: "6%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <p className="text-2xs font-bold tracking-[0.16em] text-[var(--color-prestige)]">
              NOVUS PRO · SIMULATED
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-[-0.01em]">
              More to play with. Never an easier game.
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
          >
            CLOSE
          </button>
        </div>

        <table className="mt-5 w-full px-5 text-left">
          <thead>
            <tr>
              <th className="pl-5 pb-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                &nbsp;
              </th>
              <th className="pb-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                FREE
              </th>
              <th className="pr-5 pb-2 text-2xs font-bold tracking-[0.12em] text-[var(--color-prestige)]">
                PRO
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-t border-[var(--hairline)]">
                <td className="py-2.5 pl-5 text-sm text-[var(--text-secondary)]">{row.label}</td>
                <td className="py-2.5 text-sm font-semibold">{row.free}</td>
                <td className="py-2.5 pr-5 text-sm font-semibold">{row.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="px-5 pt-4 text-xs leading-relaxed text-[var(--text-secondary)]">
          The last row is the important one. Nothing you can buy changes a score,
          saves a company, or moves you up Still Standing. That is not a promise —
          it is the design.
        </p>

        <div className="px-5 pt-5">
          <button
            type="button"
            onClick={() => setPro(!active)}
            className={`h-14 w-full rounded-[var(--radius-pill)] text-base font-extrabold tracking-[0.04em] transition-transform duration-150 active:scale-[0.97] ${
              active
                ? "bg-[var(--chip)] text-[var(--text)]"
                : "bg-[var(--action)] text-[var(--on-action)] shadow-[var(--e3)]"
            }`}
          >
            {active ? "TURN PRO OFF" : "SIMULATE PRO ▸"}
          </button>
          <p className="mt-2 text-center text-2xs font-semibold tracking-[0.12em] text-[var(--text-tertiary)]">
            {active ? "PRO IS ON · NOTHING IS BEING CHARGED" : "NO PAYMENT · A SWITCH FOR TESTING"}
          </p>
        </div>
      </motion.section>
    </div>
  );
}
