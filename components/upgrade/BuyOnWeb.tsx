"use client";

import { BUY_IN_BROWSER_NOTE, openProPurchase } from "@/lib/commerce";
import { PRO_MONTHLY, PRO_YEARLY, formatPrice } from "@/lib/monetization";

/**
 * What a store build offers where a checkout button would be: a link out.
 *
 * ── One component, three surfaces ───────────────────────────────────────────
 *
 * The onboarding plans step, the Pro sheet and the upgrade paywall all reach
 * the same wall — nothing can be sold inside an App Store build (see
 * lib/commerce.ts) — and all three used to answer it with a paragraph saying
 * so and nothing else. A player who wanted Pro was told it existed, told it
 * could not be bought here, and left to work out the rest.
 *
 * They now answer it identically, from here, because three pricing surfaces
 * that word the same offer three ways is how one of them ends up lying about
 * what it costs or where the money goes.
 *
 * ── Why the price is on it ──────────────────────────────────────────────────
 *
 * A link labelled only GET PRO asks a player to open a browser to find out
 * what it costs. Both prices are stated here, from the same constants the web
 * checkout charges, so the number on the link is the number on the invoice.
 */
export function BuyOnWeb({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      {/* A button rather than an <a>: on a device this does not navigate, it
          hands the URL to the system browser. An anchor would promise a
          navigation the webview must never actually perform. */}
      <button
        type="button"
        onClick={() => void openProPurchase()}
        className="nv-press flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--action)] text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e2)]"
      >
        GET PRO
        <ExternalGlyph />
      </button>

      <p className="tnum mt-2 text-center text-2xs font-bold tracking-[0.06em] text-[var(--text-secondary)]">
        {formatPrice(PRO_YEARLY.priceCents)} A YEAR · {formatPrice(PRO_MONTHLY.priceCents)} A MONTH
      </p>

      <p className="mt-1.5 text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
        {BUY_IN_BROWSER_NOTE}
      </p>
    </div>
  );
}

/** The arrow that means "this leaves". The one thing the label cannot say. */
function ExternalGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M5.2 2.2h6.6v6.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.8 2.2 5.6 8.4M10 8.4v3.4H2.2V4h3.4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
        className="nv-press nv-tap relative rounded-[var(--radius-pill)] bg-[var(--chip)] px-4 py-2 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] disabled:opacity-60"
      >
        {busy ? "CHECKING…" : "RESTORE PURCHASE"}
      </button>
    </div>
  );
}
