"use client";

import { PRO_ON_ACCOUNT_NOTE } from "@/lib/commerce";

/** Account-entitlement note for the existing Android presentation.
 * iOS does not mount this component: it ships the basic edition without restore.
 */
export function BuyOnWeb({ className = "" }: { className?: string }) {
  return (
    <p
      className={`text-center text-2xs leading-relaxed text-[var(--text-tertiary)] ${className}`}
    >
      {PRO_ON_ACCOUNT_NOTE}
    </p>
  );
}

/**
 * Restore, at the size Restore deserves.
 *
 * It was a full-width 48px pill directly under the purchase button, which put
 * the rarest action on the screen at nearly the weight of the primary one.
 * Most people have nothing to restore; the ones who do are looking for it and
 * will find a small button. Still a real target — 36px tall with the padding
 * that gets it past 44 — and still on every platform, because a player who
 * paid on a laptop has to be able to make it true here.
 */
export function RestoreButton({
  busy,
  onRestore,
  className = "",
}: {
  busy?: boolean;
  onRestore: () => void;
  className?: string;
}) {
  return (
    <div className={`flex justify-center ${className}`}>
      <button
        type="button"
        onClick={onRestore}
        disabled={busy}
        className="nv-gc nv-tap relative rounded-[var(--radius-pill)] px-4 py-2 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-60"
      >
        {busy ? "CHECKING…" : "RESTORE PURCHASE"}
      </button>
    </div>
  );
}
