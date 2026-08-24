"use client";

import { useState } from "react";

import {
  canAfford,
  canAffordOption,
  isLocked,
  optionsFor,
  type Activity,
  type ActivityOption,
} from "@/lib/engine/activities";
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
 * ── The sixth state: a row that asks WHICH ──────────────────────────────────
 *
 * An activity carrying `options` does not fire when pressed. It EXPANDS, and
 * the branches underneath it are the decision — "talk to the press" is a shrug,
 * "the trade weekly or the national business desk" is a choice with a spine
 * (docs/PROGRESSION.md §2.2). The expansion is inline rather than a sheet for a
 * plain reason: three screens render this row, one of them is already a sheet,
 * and a modal inside a modal is where focus management goes to die.
 *
 * The parent row keeps every state above. A locked two-level row still opens
 * the paywall rather than expanding, because showing somebody four branches
 * they cannot take is a worse refusal than one chip that says why.
 *
 * ── What a locked press must NOT do ─────────────────────────────────────────
 *
 * It must not enter the caller's one-per-visit `spent` list. A player who
 * opens the paywall, reads it and closes it has done nothing, and a row that
 * went dead behind them would be a row that punished them for looking. The
 * same is true of expanding a chooser and closing it again.
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
  /** Run it. Only called when the row is genuinely runnable. For a two-level
   *  activity the branch id comes with it, and is what lands on the tape. */
  onRun: (optionId?: string) => void;
}) {
  const upgrade = useUpgrade();
  const [open, setOpen] = useState(false);
  const locked = isLocked(activity, run);
  const affordable = canAfford(activity, run);
  const branches = optionsFor(activity, run);
  const asks = branches.length > 0;
  const price =
    activity.costS !== undefined ? fmtMoney(activity.costS * S_UNIT[run.stage]) : null;
  const expanded = asks && open && !locked && !used;

  return (
    <li>
      <button
        type="button"
        /* A locked row stays live. Cash and "already done" are the only two
           things that grey a row out, and neither is a sales message. */
        disabled={!locked && (!affordable || used)}
        aria-expanded={asks && !locked ? expanded : undefined}
        onClick={() => {
          if (locked) {
            upgrade.open(activity.gate);
            return;
          }
          if (asks) {
            setOpen((o) => !o);
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
        ) : asks ? (
          /* A caret, not a price. A two-level row has no single price — the
             branches carry their own, and printing the cheapest here would
             quote a number the player may not end up paying. */
          <span
            aria-hidden
            className="shrink-0 text-2xs font-bold text-[var(--text-tertiary)] transition-transform duration-150"
            style={{ transform: expanded ? "rotate(180deg)" : "none" }}
          >
            ▾
          </span>
        ) : (
          price && (
            <span className="tnum shrink-0 text-2xs font-semibold text-[var(--text-primary)]">
              {price}
            </span>
          )
        )}
      </button>

      {expanded && (
        <ul
          role="group"
          aria-label={`${activity.label} — choose one`}
          className="mt-1.5 space-y-1.5 pl-3"
        >
          {branches.map((option) => (
            <BranchRow
              key={option.id}
              option={option}
              run={run}
              onRun={() => {
                setOpen(false);
                onRun(option.id);
              }}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One branch of a chooser.
 *
 * Visually a step in from its parent and a shade quieter, so the group reads as
 * belonging to the row above it rather than as five rows of equal weight. It
 * carries its own price, because the branches of a real decision cost different
 * amounts and that difference is most of what the player is weighing.
 */
function BranchRow({
  option,
  run,
  onRun,
}: {
  option: ActivityOption;
  run: RunState;
  onRun: () => void;
}) {
  const affordable = canAffordOption(option, run);
  const price =
    option.costS !== undefined ? fmtMoney(option.costS * S_UNIT[run.stage]) : null;

  return (
    <li>
      <button
        type="button"
        disabled={!affordable}
        onClick={onRun}
        className="flex w-full items-start justify-between gap-3 rounded-[var(--radius-row)] bg-[var(--n-3)] px-3.5 py-3 text-left transition-transform duration-150 enabled:nv-press-row disabled:opacity-45"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold leading-snug">{option.label}</span>
          <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-secondary)]">
            {affordable
              ? option.signal
              : `You don't have the ${price ?? "cash"}. That's the whole reason.`}
          </span>
        </span>
        {price && (
          <span className="tnum shrink-0 text-2xs font-semibold text-[var(--text-primary)]">
            {price}
          </span>
        )}
      </button>
    </li>
  );
}
