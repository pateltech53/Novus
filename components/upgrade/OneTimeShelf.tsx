"use client";

import { useEffect, useMemo, useState } from "react";

import { billingStatus, goToCheckout } from "@/lib/cloud/billing";
import { INDUSTRIES } from "@/lib/engine/constants";
import type { Industry } from "@/lib/engine/types";
import {
  FREE_LIMITS,
  ISLAND_CAP,
  NO_ENTITLEMENTS,
  ONE_TIME_PURCHASES,
  PRO_INDUSTRY_CODES,
  formatPrice,
  isPro,
  priceLabel,
} from "@/lib/monetization";
import { useEntitlements } from "@/lib/plan";
import { play } from "@/lib/sound";

/**
 * The one-time buys, with actual buttons on them.
 *
 * The server could sell an Extra Island and an Industry Pack from the day
 * billing landed — catalogue entry, price verification, webhook grant, the
 * whole path — and no screen ever called it: the shelf was a line of grey
 * text under the subscription grid. This component is the missing half. It
 * renders on every WEB pricing surface (the paywall, the Pro sheet, the
 * landing prices); store builds never mount it, because the surfaces that
 * include it already gate on `useSellsHere()` — Guideline 3.1.1 applies to a
 * $1.99 island exactly as it does to a subscription.
 *
 * ── What each row is ───────────────────────────────────────────────────────
 *
 * · **Extra Island, $1.99, once.** One more company running at the same time,
 *   stacked on the plan's allowance — on EVERY plan, which is 0015's doing and
 *   worth naming here because it was false before it. Pro used to be handed
 *   the whole storage ceiling, so `min(cap, cap + bought)` meant a subscriber's
 *   $1.99 bought a no-op. Pro is ten again, the ceiling is fifty, and a bought
 *   island is worth exactly one island to anybody until they reach it.
 * · **Industry Pack, $2.99, once.** ONE locked industry, named here and
 *   carried to the webhook in metadata, kept for good. Meaningless on Pro —
 *   Pro already opens all twelve — so the row withdraws itself for Pro
 *   players rather than selling them something they own.
 * · **Cosmetic bundles** stay a text line: no per-bundle SKUs exist, and a
 *   price with no way to pay it is labelled rather than buttoned.
 *
 * When billing is not configured there is nothing to tap, so the shelf keeps
 * the old text-only shape — prices as facts, no dead buttons.
 *
 * ── What it says once you own some of it ───────────────────────────────────
 *
 * Nothing, until now. A player who bought an island saw a row identical to the
 * one they saw before paying — same name, same $1.99, same BUY AN ISLAND — and
 * the only evidence the purchase had landed was a number on a different screen.
 * Islands stack, so the button cannot simply withdraw once one is owned; what it
 * can do is count what is already yours beside the offer of another. The
 * industry row answers the same question by NAME rather than by count, because
 * the packs a player owns are precisely the ones missing from the picker at the
 * end of the row, and an absence is not a receipt.
 *
 * The one sale refused outright is an island with nowhere to go: `ISLAND_CAP`
 * is a storage bound — `saves.slot` is checked `between 0 and 49` since 0015 —
 * so past the free tier's two plus forty-eight bought there is no fifty-first
 * row for the next one to live in, on any tier, ever.
 */

interface ShelfState {
  configured: boolean;
  skus: string[];
}

/** An industry code with the name a player would recognise it by. Module
 *  scope so the two lists below can memoise on the entitlement alone. */
const named = (code: Industry) => ({
  code,
  name: INDUSTRIES.find((i) => i.code === code)?.name ?? code,
});

export function OneTimeShelf({
  lead,
  onNeedsAccount,
  className = "",
}: {
  /** Which row the surface's gate is about, shown first. */
  lead?: "extra_island" | "industry_pack";
  /** Landing scrolls to its sign-up gate; sheets just show the message. */
  onNeedsAccount?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<ShelfState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /* Live, not read once at mount.
     It used to be `useState(() => loadEntitlements())`, on the reasoning that
     the moment that matters is "what does this player own as the shelf
     appears". That was true while the shelf only decided which rows to draw,
     and false the moment it started reporting what is owned: the boot restore
     adopts the server's copy a second after mount, the heartbeat adopts a
     purchase made on another device, and an admin skip grants without a
     reload. All three used to leave this shelf stating yesterday's answer.
     NO_ENTITLEMENTS for the first render is the SSR-safe floor — it hides the
     owned marks for one frame and shows no row that should be hidden. */
  const entitlements = useEntitlements() ?? NO_ENTITLEMENTS;
  const pro = isPro(entitlements);
  const ownedIslands = Math.max(0, entitlements.extraIslands);
  /*
   * When another island could never do anything for this account, on any tier.
   *
   * Measured against the FREE tier's allowance plus what has been bought, not
   * against `islandCapFor`, and the difference is the judgement: an island is
   * bought outright and outlives a subscription, so what matters is whether it
   * could ever be spent — not whether today's tier happens to leave room for
   * it. Free's two plus forty-eight bought is ISLAND_CAP, and there is no
   * fifty-first row in `public.saves` for a forty-ninth purchase to live in.
   * That is the only sale worth refusing, so it is the only one refused.
   *
   * Before 0015 there was a second case here, and it is worth knowing why it
   * is gone: Pro used to receive the whole ceiling, so `min(cap, 50 + bought)`
   * meant a subscriber's purchase did nothing at all and the row carried a
   * paragraph apologising for it. Pro is ten again and a bought island stacks
   * on top, so there is no longer anything to apologise for.
   */
  const islandsMaxed = FREE_LIMITS.islands + ownedIslands >= ISLAND_CAP;

  const island = ONE_TIME_PURCHASES.find((p) => p.id === "extra_island")!;
  const pack = ONE_TIME_PURCHASES.find((p) => p.id === "industry_pack")!;
  const bundles = ONE_TIME_PURCHASES.find((p) => p.id === "cosmetic_bundle")!;

  const lockedIndustries = useMemo(
    () =>
      PRO_INDUSTRY_CODES.filter((code) => !entitlements.industryPacks.includes(code)).map(named),
    [entitlements.industryPacks],
  );

  /* The other half of the same list, and the one this shelf never used to
     show: the packs already paid for. Read off the entitlement rather than
     inferred from what is missing above, so a code the industry table no
     longer carries is still reported as owned rather than silently vanishing
     from both lists. */
  const ownedPacks = useMemo(
    () => entitlements.industryPacks.map(named),
    [entitlements.industryPacks],
  );
  const [industry, setIndustry] = useState<Industry | "">(
    lockedIndustries[0]?.code ?? "",
  );

  /*
   * Keep the picker pointed at something still buyable.
   *
   * The seed above runs on the first render, where entitlements are not
   * readable yet and "locked" therefore means all eight — so a player who
   * already owns Fashion starts with Fashion selected and would be sent to a
   * checkout the server refuses with "FASHION is already unlocked". The same
   * correction covers a purchase completed in this tab: the industry that was
   * just bought leaves the list, and the picker must not keep pointing at it.
   */
  useEffect(() => {
    if (lockedIndustries.some((i) => i.code === industry)) return;
    setIndustry(lockedIndustries[0]?.code ?? "");
  }, [lockedIndustries, industry]);

  useEffect(() => {
    let alive = true;
    void billingStatus().then((s) => {
      if (alive) setState({ configured: s.configured, skus: s.skus });
    });
    return () => {
      alive = false;
    };
  }, []);

  const buy = async (sku: "extra_island" | "industry_pack") => {
    if (busy) return;
    setBusy(sku);
    setMessage(null);
    play("click");

    const result = await goToCheckout(sku, sku === "industry_pack" ? industry || undefined : undefined);
    if (result.ok) return; // leaving for Stripe; keep the button busy

    setBusy(null);

    // The operator's fork. A skip already granted and adopted the
    // entitlements, and the write announced itself — the shelf's owned
    // states update live; this line is just the receipt.
    if (result.reason === "admin-cancel") return;
    if (result.reason === "admin-skip") {
      play("success");
      setMessage("Granted without payment — admin skip. Nothing was charged.");
      return;
    }

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

  const islandRow = (
    <li key="island" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--hairline)] py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold">
          {island.name}{" "}
          <span className="tnum font-bold text-[var(--text-secondary)]">
            {formatPrice(island.priceCents)}
          </span>{" "}
          <span className="text-2xs font-bold tracking-[0.08em] text-[var(--text-tertiary)]">
            ONCE
          </span>
          {ownedIslands > 0 ? <Owned>{ownedIslands} YOURS</Owned> : null}
        </p>
        <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">
          {island.what}
          {islandsMaxed ? (
            <span className="text-[var(--text-tertiary)]">
              {" "}
              You are at the {ISLAND_CAP}-island ceiling — there is nowhere to
              put another.
            </span>
          ) : (
            /* On any tier, said plainly, because "does this do anything for
               ME?" is the question this row could not answer before 0015. */
            <span className="text-[var(--text-tertiary)]">
              {" "}
              Stacks on whatever your plan gives, up to {ISLAND_CAP}. Yours for
              good — an island outlives a subscription.
            </span>
          )}
        </p>
      </div>
      {/* Still offered after the first one: islands stack. Withdrawn only at
          the storage ceiling, where the money would buy a slot the database
          has no row for. */}
      {has("extra_island") && !islandsMaxed && (
        <button
          type="button"
          onClick={() => void buy("extra_island")}
          disabled={busy !== null}
          className="nv-gc shrink-0 rounded-[var(--radius-pill)] nv-t-action px-4 py-2 text-2xs font-extrabold tracking-[0.08em] shadow-[var(--e1)] disabled:opacity-40"
        >
          {busy === "extra_island"
            ? "OPENING…"
            : ownedIslands > 0
              ? "BUY ANOTHER"
              : "BUY AN ISLAND"}
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
        <p className="mt-0.5 text-xs leading-snug text-[var(--text-secondary)]">
          {pack.what}
          {/* By name, and only by name — a count beside the price would say
              "2 YOURS" and leave the actual question unanswered. The packs a
              player owns are exactly the ones missing from the picker at the
              end of this row, and an absence is not a receipt: "which ones did
              I buy" has to be answerable without opening the dropdown and
              reasoning about what is no longer in it. */}
          {ownedPacks.length > 0 ? (
            <span className="font-semibold text-[var(--text-secondary)]">
              {" "}
              Yours: {ownedPacks.map((i) => i.name).join(", ")}.
            </span>
          ) : null}
          {lockedIndustries.length === 0 ? (
            <span className="text-[var(--text-tertiary)]">
              {" "}
              Every industry is open on this account.
            </span>
          ) : null}
        </p>
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

  if (lead === "industry_pack" && packRow) rows.push(packRow, islandRow);
  else {
    rows.push(islandRow);
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

/**
 * "2 YOURS" — the receipt, inline with the price it was paid.
 *
 * Prestige ink and no border: it sits inside a sentence that already carries a
 * name and a figure, and a second boxed thing on that line would compete with
 * the button at the end of the row for the eye. Deliberately not the accent —
 * §1.5 keeps that for the control asking to be pressed, which this is not.
 */
function Owned({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1 text-2xs font-bold tracking-[0.08em] text-[var(--color-prestige)]">
      {children}
    </span>
  );
}
