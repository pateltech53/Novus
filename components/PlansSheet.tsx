"use client";

import { PrimaryButton, StepShell } from "@/components/StepShell";

/**
 * O7 · Plans. Presented once, soft, skippable in one tap. The hard re-offer
 * comes after Fiscal Year 1, when the user actually wants more.
 *
 * Nothing purchasable here touches score, survival, revives, or leaderboard
 * position — content only, never outcomes.
 */
const ROWS: { label: string; free: string; pro: string }[] = [
  { label: "Industries", free: "4", pro: "12" },
  { label: "Active runs", free: "1", pro: "3" },
  { label: "Pitch retries", free: "1 / day", pro: "Practice Gym" },
  { label: "Replay analytics", free: "Score", pro: "Full transcript" },
  { label: "Leaderboard", free: "Same for everyone", pro: "Same for everyone" },
];

export function PlansSheet({ onDone }: { onDone: () => void }) {
  return (
    <StepShell>
      <div className="w-full flex-1">
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--n-7)]">
          BEFORE YOU FOUND ANYTHING
        </p>
        <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
          Pro founders get twelve industries. Free founders get my judgment either way.
        </h1>

        <table className="mt-7 w-full border-t border-[var(--hairline)] text-left">
          <thead>
            <tr>
              <th className="py-2 text-2xs font-bold tracking-[0.12em] text-[var(--n-7)]">
                &nbsp;
              </th>
              <th className="py-2 text-2xs font-bold tracking-[0.12em] text-[var(--n-7)]">
                FREE
              </th>
              <th className="py-2 text-2xs font-bold tracking-[0.12em] text-[var(--color-prestige)]">
                PRO
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-t border-[var(--hairline)]">
                <td className="py-2.5 text-sm text-[var(--n-8)]">{row.label}</td>
                <td className="py-2.5 text-sm font-semibold">{row.free}</td>
                <td className="py-2.5 text-sm font-semibold">{row.pro}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="mt-5 text-xs leading-relaxed text-[var(--n-7)]">
          Nothing you can buy changes a score, saves a company, or moves you up
          Still Standing. That is not a promise — it is the design.
        </p>
      </div>

      <div className="mt-auto w-full">
        <PrimaryButton onClick={onDone}>START FREE</PrimaryButton>
        <button
          type="button"
          onClick={onDone}
          className="mx-auto mt-3 block text-xs text-[var(--n-7)] underline underline-offset-4"
        >
          See Pro later
        </button>
      </div>
    </StepShell>
  );
}
