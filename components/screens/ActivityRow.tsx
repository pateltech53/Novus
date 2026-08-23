"use client";

import { canAfford, isLocked, type Activity } from "@/lib/engine/activities";
import { S_UNIT } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import type { RunState } from "@/lib/engine/types";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";

/**
 * One thing you can do today.
 *
 * ── Why this is a component and not three copies ────────────────────────────
 *
 * It was three copies. `CompanyScreen`, `ProductScreen` and `ActivitySheet`
 * each rendered the same button with the same five states written out
 * longhand, which is fine right up until a state is ADDED — and then the one
 * that gets it is whichever file the author had open. That is exactly what
 * happened here: cold calling needed a locked state, and only one of the three
 * is even reachable from /play, so patching all three by hand would have been
 * three chances to disagree about what a lock looks like.
 *
 * ── The five states, in the order they are checked ──────────────────────────
 *
 * 1. **Locked** — Pro gates access to this and this account is free. Drawn at
 *    full strength with a gold PRO chip, and PRESSABLE: the press opens the
 *    paywall. Deliberately not `disabled`, which is the one thing that would
 *    make it read as broken rather than as bought. Checked first, because
 *    "you cannot afford it" is a worse answer than "this is Pro" to somebody
 *    who cannot buy it at any price.
 * 2. **Used** — already run this visit. Dimmed and dead; the month has to move.
 * 3. **Unaffordable** — the cash is not there, and the row says so with the
 *    number, because that is the whole reason and hiding it teaches nothing.
 * 4. **Ready** — the qualitative `signal`, never an effect preview.
 *
 * The price chip is the only number allowed before committing (Addendum A
 * §7.1): the money leaving the account, and nothing about what it buys.
 *
 * ── What a locked press must NOT do ─────────────────────────────────────────
 *
 * It must not enter the caller's one-per-visit `spent` list. A player who
 * opens the paywall, reads it and closes it has done nothing, and a row that
 * went dead behind them would be a row that punished them for looking.
 */
export function ActivityRow({
  activity,
  run,
  used,
  onRun,
}: {
  activity: Activity;
  run: RunState;
  /** Already run this visit — the caller owns that list. */
  used: boolean;
  /** Run it. Only called when the row is genuinely runnable. */
  onRun: () => void;
}) {
  const upgrade = useUpgrade();
  const locked = isLocked(activity, run);
  const affordable = canAfford(activity, run);
  const price =
    activity.costS !== undefined ? fmtMoney(activity.costS * S_UNIT[run.stage]) : null;

  return (
    <li>
      <button
        type="button"
        /* A locked row stays live. Cash and "already done" are the only two
           things that grey a row out, and neither is a sales message. */
        disabled={!locked && (!affordable || used)}
        onClick={() => {
          if (locked) {
            upgrade.open(activity.gate);
            return;
          }
          onRun();
        }}
        className="nv-card flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-transform duration-150 enabled:nv-press-row disabled:opacity-45"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-semibold leading-snug">
            {activity.label}
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-[var(--text-secondary)]">
            {locked
              ? /* The refusal, in the house voice: what Pro opens, and the
                   line Brand Law 4 requires anyway — a subscription buys the
                   door and never the answer behind it. */
                "Pro opens the phone. It never makes anyone say yes."
              : used
                ? "Done. The month has to move before you do that again."
                : !affordable
                  ? `You don't have the ${price ?? "cash"}. That's the whole reason.`
                  : activity.signal}
          </span>
        </span>

        {locked ? (
          <span className="shrink-0 rounded-[var(--radius-chip)] bg-[var(--color-prestige)] px-1.5 py-0.5 text-2xs font-extrabold tracking-[0.12em] text-[var(--color-navy)]">
            PRO
          </span>
        ) : (
          price && (
            <span className="tnum shrink-0 text-2xs font-semibold text-[var(--text-primary)]">
              {price}
            </span>
          )
        )}
      </button>
    </li>
  );
}
