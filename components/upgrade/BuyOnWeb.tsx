"use client";

import { PRO_ON_ACCOUNT_NOTE } from "@/lib/commerce";

/**
 * What a store build offers where a checkout button would be: a statement of
 * fact, and nothing else.
 *
 * ── One component, four surfaces ────────────────────────────────────────────
 *
 * The onboarding plans step, the Pro sheet, Settings and the upgrade paywall
 * all reach the same wall — nothing can be sold inside a store build (see
 * lib/commerce.ts) — and they answer it identically, from here, because four
 * pricing surfaces that word the same fact four ways is how one of them ends
 * up saying too much.
 *
 * ── What used to be here, and why it is gone ────────────────────────────────
 *
 * A GET PRO button that opened the website's pricing section, with both plan
 * prices under it. That was built on the April 2025 *Epic v. Apple* carve-out
 * and on the belief that `Browser.open` "genuinely leaves" the app — and App
 * Review rejected build 1.0(3) over it (Guideline 3.1.1: "the plans can be
 * purchased in the app using payment mechanisms other than In-App Purchase"),
 * because on iOS `Browser.open` is SFSafariViewController: a sheet presented
 * INSIDE the app, with a Done button returning to it, showing a page where
 * both plans and the chapter licences were purchasable through Stripe. The
 * full account is in lib/commerce.ts's header; the short version is that a
 * store build is back to selling nothing, pricing nothing and linking to
 * nothing, which is the shape that predates the experiment.
 *
 * Restore stays, at the size Restore deserves — it is the one path by which
 * Pro reaches a store build at all.
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
