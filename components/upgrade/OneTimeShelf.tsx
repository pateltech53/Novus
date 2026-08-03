"use client";

import { useEffect, useMemo, useState } from "react";

import { billingStatus, goToCheckout } from "@/lib/cloud/billing";
import { INDUSTRIES } from "@/lib/engine/constants";
import type { Industry } from "@/lib/engine/types";
import {
  ONE_TIME_PURCHASES,
  PRO_INDUSTRY_CODES,
  formatPrice,
  isPro,
  loadEntitlements,
  priceLabel,
} from "@/lib/monetization";
import { play } from "@/lib/sound";

/**
 * The one-time buys, with actual buttons on them.
 *
 * The server could sell an Extra Run Slot and an Industry Pack from the day
 * billing landed — catalogue entry, price verification, webhook grant, the
 * whole path — and no screen ever called it: the shelf was a line of grey
 * text under the subscription grid. This component is the missing half. It
 * renders on every WEB pricing surface (the paywall, the Pro sheet, the
 * landing prices); store builds never mount it, because the surfaces that
 * include it already gate on `useSellsHere()` — Guideline 3.1.1 applies to a
 * $1.99 slot exactly as it does to a subscription.
 *
 * ── What each row is ───────────────────────────────────────────────────────
 *
 * · **Extra Run Slot, $1.99, once.** One more company running at the same
 *   time, stacked on the plan's allowance. Useful on free AND on Pro.
 * · **Industry Pack, $2.99, once.** ONE locked industry, named here and
 *   carried to the webhook in metadata, kept for good. Meaningless on Pro —
 *   Pro already opens all twelve — so the row withdraws itself for Pro
 *   players rather than selling them something they own.
 * · **Cosmetic bundles** stay a text line: no per-bundle SKUs exist, and a
 *   price with no way to pay it is labelled rather than buttoned.
 *
 * When billing is not configured there is nothing to tap, so the shelf keeps
 * the old text-only shape — prices as facts, no dead buttons.
 */

interface ShelfState {
  configured: boolean;
  skus: string[];
}

export function OneTimeShelf({
  lead,
  onNeedsAccount,
  className = "",
}: {
  /** Which row the surface's gate is about, shown first. */
  lead?: "extra_run_slot" | "industry_pack";
  /** Landing scrolls to its sign-up gate; sheets just show the message. */
  onNeedsAccount?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<ShelfState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /* Entitlements are read once on mount — the moment that matters is "is this
     player Pro / which packs do they own" as the shelf appears. */
  const [entitlements] = useState(() => loadEntitlements());
  const pro = isPro(entitlements);

  const slot = ONE_TIME_PURCHASES.find((p) => p.id === "extra_run_slot")!;
  const pack = ONE_TIME_PURCHASES.find((p) => p.id === "industry_pack")!;
  const bundles = ONE_TIME_PURCHASES.find((p) => p.id === "cosmetic_bundle")!;

  const lockedIndustries = useMemo(
    () =>
      PRO_INDUSTRY_CODES.filter((code) => !entitlements.industryPacks.includes(code)).map(
        (code) => ({
          code,
          name: INDUSTRIES.find((i) => i.code === code)?.name ?? code,
        }),
      ),
    [entitlements.industryPacks],
  );
  const [industry, setIndustry] = useState<Industry | "">(
    lockedIndustries[0]?.code ?? "",
  );

  useEffect(() => {
    let alive = true;
    void billingStatus().then((s) => {
      if (alive) setState({ configured: s.configured, skus: s.skus });
    });
    return () => {
      alive = false;
    };
  }, []);

  const buy = async (sku: "extra_run_slot" | "industry_pack") => {
    if (busy) return;
    setBusy(sku);
    setMessage(null);
    play("click");

    const result = await goToCheckout(sku, sku === "industry_pack" ? industry || undefined : undefined);
    if (result.ok) return; // leaving for Stripe; keep the button busy

    setBusy(null);
    if (result.reason === "signed-out" || result.reason === "needs-account") {
      setMessage(
        "One-time buys attach to a Novus account, so they survive a new phone. Sign in or create one first — the free game does not need one.",
      );
      onNeedsAccount?.();
      return;
    }
    setMessage(
      result.reason === "owned"
        ? (result.message ?? "This account already owns that.")
        : result.message
          ? `Checkout could not be opened. Nothing was charged. (${result.message})`
          : "Checkout could not be opened. Nothing was charged.",
    );
  };

  /* Unconfigured billing: the honest shelf is the old one — names and prices,
     no buttons that cannot work. Unknown yet: render the same, so nothing
     flashes from text to button after the status answers. */
  const sellable = state?.configured === true;
  const has = (sku: string) => sellable && state!.skus.includes(sku);

  const rows: React.ReactNode[] = [];

  const slotRow = (
    <li key="slot" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--hairline)] py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold">
          {slot.name}{" "}
          <span className="tnum font-bold text-[var(--text-secondary)]">
            {formatPrice(slot.priceCents)}
          </span>{" "}
          <span className="text-2xs font-bold tracking-[0.08em] text-[var(--text-tertiary)]">
            ONCE
          </span>
        </p>
        <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">{slot.what}</p>
      </div>
      {has("extra_run_slot") && (
        <button
          type="button"
          onClick={() => void buy("extra_run_slot")}
          disabled={busy !== null}
          className="nv-gc shrink-0 rounded-[var(--radius-pill)] nv-t-action px-4 py-2 text-2xs font-extrabold tracking-[0.08em] shadow-[var(--e1)] disabled:opacity-40"
        >
          {busy === "extra_run_slot" ? "OPENING…" : "BUY A SLOT"}
        </button>
      )}
    </li>
  );

  const packRow = pro ? null : (
    <li key="pack" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--hairline)] py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold">
          {pack.name}{" "}
          <span className="tnum font-bold text-[var(--text-secondary)]">
            {formatPrice(pack.priceCents)}
          </span>{" "}
          <span className="text-2xs font-bold tracking-[0.08em] text-[var(--text-tertiary)]">
            ONCE
          </span>
        </p>
        <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">{pack.what}</p>
      </div>
      {has("industry_pack") && lockedIndustries.length > 0 && (
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={industry}
            onChange={(e) => setIndustry(e.target.value as Industry)}
            aria-label="Which industry"
            className="nv-gc rounded-[var(--radius-pill)] bg-transparent px-3 py-2 text-2xs font-bold text-[var(--text-primary)] focus-visible:outline-none!"
          >
            {lockedIndustries.map((i) => (
              <option key={i.code} value={i.code}>
                {i.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void buy("industry_pack")}
            disabled={busy !== null || !industry}
            className="nv-gc rounded-[var(--radius-pill)] nv-t-action px-4 py-2 text-2xs font-extrabold tracking-[0.08em] shadow-[var(--e1)] disabled:opacity-40"
          >
            {busy === "industry_pack" ? "OPENING…" : "BUY"}
          </button>
        </div>
      )}
    </li>
  );

  if (lead === "industry_pack" && packRow) rows.push(packRow, slotRow);
  else {
    rows.push(slotRow);
    if (packRow) rows.push(packRow);
  }

  return (
    <div className={className}>
      <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
        ONE-TIME, NO SUBSCRIPTION
      </p>
      <ul className="mt-1">
        {rows}
        <li className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold">
              {bundles.name}{" "}
              <span className="tnum font-bold text-[var(--text-secondary)]">{priceLabel(bundles)}</span>
            </p>
            <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">
              {bundles.what} Earned in the Closet — not sold here yet.
            </p>
          </div>
        </li>
      </ul>
      {message && (
        <p role="alert" className="mt-1 text-2xs leading-relaxed text-[var(--color-alert)]">
          {message}
        </p>
      )}
    </div>
  );
}
