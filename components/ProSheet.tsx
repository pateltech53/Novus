"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

import { useGame } from "@/lib/state/GameProvider";
import { LegalSheet } from "@/components/LegalSheet";
import { PRIVACY, TERMS, type LegalDocument } from "@/lib/legal/documents";
import { billingStatus, goToCheckout, restorePurchases } from "@/lib/cloud/billing";
import { useSellsHere } from "@/lib/commerce";
import { BuyOnWeb, RestoreButton } from "@/components/upgrade/BuyOnWeb";
import {
  CADENCE_SUFFIX,
  MONTHLY_ANNUALISED_CENTS,
  PRO_MONTHLY,
  PRO_PROMISE,
  PRO_YEARLY,
  YEARLY_SAVING_CENTS,
  formatPrice,
  grantProLocally,
  isPro,
  loadEntitlements,
  type SubscriptionPlan,
} from "@/lib/monetization";

/**
 * Novus Pro, in the game.
 *
 * ── What this sheet used to be ──────────────────────────────────────────────
 *
 * A comparison table and one button reading SIMULATE PRO, which flipped
 * `run.pro` on and off with no payment involved. That was honest while billing
 * did not exist and it cannot ship: App Store Guideline 2.1 rejects builds
 * carrying demo, placeholder or test functionality, and 2.3.1 covers a hidden
 * switch that hands out the paid tier. It was also, plainly, a cheat button in
 * a product whose whole pricing argument is that nothing purchasable changes an
 * outcome.
 *
 * ── What it is now ──────────────────────────────────────────────────────────
 *
 * The same table — that part was always the point — plus the real state of the
 * account, and then one of two things depending on where the app is running:
 *
 * · **In a browser**, the plan chips and a checkout button, with the
 *   disclosures a subscription has to carry beside them (Guideline 3.1.2:
 *   length, price per period, that it renews, and links to the terms and the
 *   privacy policy — reachable, in the app, without leaving it).
 * · **In the iPhone or Android app**, no in-app checkout, because a store build
 *   cannot take the money (lib/commerce.ts). What it offers instead is a link
 *   that leaves for the browser, and Restore under it — the path by which a
 *   purchase made anywhere actually arrives on this phone.
 *
 * Brand Law 4 is the design, not a disclaimer: Pro adds CONTENT (industries,
 * cosmetics, candidates, asset classes). It never adds outcomes — no better
 * scores, no survival advantage, no leaderboard movement. The last row of the
 * table is the one that matters, which is why it is in the table rather than
 * in a footnote.
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
  const game = useGame();
  const { run } = game;
  const sellsHere = useSellsHere();

  const [active, setActive] = useState(!!run?.pro);
  const [plan, setPlan] = useState<SubscriptionPlan>(PRO_YEARLY);
  const [legal, setLegal] = useState<LegalDocument | null>(null);

  /** Null until the status route answers — see the same pattern in /welcome. */
  const [canCharge, setCanCharge] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setActive(isPro(loadEntitlements()) || !!run?.pro);
  }, [run?.pro]);

  useEffect(() => {
    let alive = true;
    void billingStatus().then((s) => {
      if (alive) setCanCharge(s.configured);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!run) return null;

  /**
   * Web only. With Stripe keys set this leaves for hosted checkout and Pro is
   * granted by the webhook when the money lands, never here. With no keys it
   * keeps the pre-billing behaviour — grant on this device, no card — because
   * that is still the honest answer on a deploy that cannot charge anyone.
   *
   * A failed checkout deliberately does NOT fall back to the local grant: on a
   * deploy that CAN take money, that would make Pro free to anyone who can drop
   * a request.
   */
  const takePro = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    const result = await goToCheckout(plan.id);
    if (result.ok) return; // navigating to Stripe; leave the button busy

    if (result.reason === "not-configured") {
      grantProLocally(plan.id);
      game.setPro(true);
      setActive(true);
      setBusy(false);
      setMessage("Pro is on for this device. No card was taken — billing is not switched on for this build.");
      return;
    }

    setBusy(false);
    setMessage(
      result.reason === "owned"
        ? "This account already has Pro. Tap Restore to bring it to this device."
        : result.reason === "needs-account"
          ? "Pro attaches to an account so it survives a new phone. Create one on the front page first — the free game does not need one."
          : result.reason === "signed-out"
            ? "Could not reach your account. Check your connection and try again."
            : "Checkout could not be opened. Nothing was charged.",
    );
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    const result = await restorePurchases();
    setBusy(false);

    if (!result.ok) {
      setMessage(
        result.reason === "signed-out"
          ? "Sign in first — purchases attach to your Novus account, not to this device. Settings › Account."
          : result.reason === "not-configured"
            ? "Purchases are not switched on for this build."
            : "Could not reach the server. Check your connection and try again.",
      );
      return;
    }

    setActive(result.pro);
    if (result.pro && !run.pro) game.setPro(true);
    setMessage(
      result.pro
        ? "Novus Pro is on. Every industry and room is open."
        : "Nothing to restore on this account.",
    );
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center sm:items-center sm:p-6">
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
        className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[1.75rem] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)] sm:max-h-[86dvh] sm:rounded-[var(--radius-card)]"
        initial={{ y: "6%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <p className="text-2xs font-bold tracking-[0.16em] text-[var(--color-prestige)]">
              {active ? "NOVUS PRO · ACTIVE" : "NOVUS PRO"}
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-[-0.01em]">
              More to play with. Never an easier game.
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="nv-press shrink-0 rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
          >
            CLOSE
          </button>
        </div>

        <table className="mt-5 w-full text-left">
          <thead>
            <tr>
              <th className="pb-2 pl-5 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
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
          The last row is the important one. {PRO_PROMISE}
        </p>

        <div className="px-5 pt-5">
          {active ? (
            <p className="rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--text-primary)]">
              Pro is on for this account. Every industry and room is open.
            </p>
          ) : sellsHere === true ? (
            <>
              {/* Both options carry the comparison, not only the one being
                  sold. A yearly plan that shows its saving while the monthly
                  plan hides its true cost is an argument, not a price list. */}
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Billing period">
                {[PRO_MONTHLY, PRO_YEARLY].map((p) => {
                  const on = p.id === plan.id;
                  const monthly = p.id === PRO_MONTHLY.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPlan(p)}
                      className={`nv-press rounded-[var(--radius-card)] px-3 py-2 text-left ${
                        on
                          ? "bg-[var(--surface-elevated)] shadow-[var(--e2)]"
                          : "bg-[var(--surface)]"
                      }`}
                    >
                      <span
                        className={`tnum block text-base font-extrabold ${
                          on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                        }`}
                      >
                        {formatPrice(p.priceCents)}
                      </span>
                      <span className="block text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
                        {monthly ? "A MONTH" : "A YEAR"}
                      </span>
                      <span className="tnum mt-0.5 block text-2xs text-[var(--text-tertiary)]">
                        {monthly
                          ? `${formatPrice(MONTHLY_ANNUALISED_CENTS)} a year`
                          : `${formatPrice(YEARLY_SAVING_CENTS)} less`}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => void takePro()}
                disabled={busy}
                className="nv-press mt-3 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-base font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)] disabled:opacity-60"
              >
                {busy ? "OPENING…" : "CHOOSE PRO"}
              </button>

              {/* The disclosure a subscription has to carry beside its button:
                  what it is, how long, what it costs, that it renews, and how
                  to stop it. */}
              <p className="mt-2 text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
                {canCharge === null
                  ? " "
                  : canCharge
                    ? `Novus Pro, ${formatPrice(plan.priceCents)}${CADENCE_SUFFIX[plan.cadence]}, billed by Stripe. Renews automatically each ${plan.cadence} until you cancel; cancel any time from Settings.`
                    : "No card is taken. Pro switches on for this device — billing is not switched on for this build."}
              </p>
            </>
          ) : sellsHere === false ? (
            <BuyOnWeb />
          ) : null}

          {/* Always available, on every platform and in both states: a player
              who paid on another device has to be able to get it back, and a
              player who thinks they paid has to be able to check. Small,
              because for most people the answer is that there is nothing to
              restore. */}
          <RestoreButton busy={busy} onRestore={() => void restore()} className="mt-3" />

          {message ? (
            <p
              role="status"
              className="mt-2 text-center text-2xs leading-relaxed text-[var(--text-secondary)]"
            >
              {message}
            </p>
          ) : null}

          <div className="mt-3 flex justify-center gap-5 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            <button
              type="button"
              onClick={() => setLegal(TERMS)}
              className="underline underline-offset-4"
            >
              TERMS OF USE
            </button>
            <button
              type="button"
              onClick={() => setLegal(PRIVACY)}
              className="underline underline-offset-4"
            >
              PRIVACY
            </button>
          </div>
        </div>
      </motion.section>

      {legal && <LegalSheet doc={legal} onClose={() => setLegal(null)} />}
    </div>
  );
}
