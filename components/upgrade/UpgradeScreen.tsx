"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { play } from "@/lib/sound";
import { billingStatus, goToCheckout } from "@/lib/cloud/billing";
import { EXIT, SHEET_SPRING } from "@/components/ui/Motion";
import {
  CADENCE_SUFFIX,
  MONTHLY_ANNUALISED_CENTS,
  PRO_FEATURES,
  PRO_MONTHLY,
  PRO_PROMISE,
  PRO_YEARLY,
  YEARLY_SAVING_CENTS,
  formatPrice,
  grantProLocally,
  type SubscriptionPlan,
} from "@/lib/monetization";
import type { Gate } from "@/lib/upgrade";

/**
 * The upgrade screen — what the notification opens into.
 *
 * ── Two compositions, not one stretched ─────────────────────────────────────
 *
 * Under 1024px this is a bottom sheet: the argument scrolls, and the price, the
 * button and the way out are pinned to the bottom where a thumb already is. The
 * pinned strip is the whole reason the sheet is not one long scroll — a paywall
 * that hides its free exit below the fold is a paywall that moved the exit, and
 * this one is read by fourteen-year-olds.
 *
 * At 1024px and up it is a centred card split down the middle: the argument on
 * the left, and the price, promise and buttons standing together in a solid
 * panel on the right. Same components, different composition — /play's own
 * breakpoint, so the two surfaces reflow at the same width.
 *
 * ── What it leads with ──────────────────────────────────────────────────────
 *
 * The headline is the gate the player just hit, not a slogan. Someone who was
 * refused The Room is looking at a screen whose first line is about The Room,
 * and the matching row in the feature list is marked so the list reads as an
 * answer rather than a menu. Opened cold from a "See Pro" control there is no
 * gate, and it falls back to the argument the onboarding screen makes: free is
 * the whole game.
 *
 * ── What the button does ────────────────────────────────────────────────────
 *
 * Exactly what /welcome's plans screen does, because two pricing surfaces that
 * behave differently is how one of them ends up lying. With Stripe keys set it
 * opens hosted checkout and Pro is granted by the webhook when the money lands.
 * With no keys it grants Pro on this device and says so. A checkout that FAILED
 * never falls back to the local grant — on a deploy that can take money, that
 * would make Pro free to anyone who can drop a request.
 */
export function UpgradeScreen({
  gate,
  onClose,
}: {
  gate: Gate | null;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<SubscriptionPlan>(PRO_YEARLY);
  const reduced = useReducedMotion();

  // Null until the status route answers. The line under the button promises
  // different things depending on it, so it renders a blank rather than
  // flashing the wrong promise for a frame.
  const [canCharge, setCanCharge] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void billingStatus().then((s) => {
      if (alive) setCanCharge(s.configured);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Escape closes it. A modal that traps a desktop player behind a price is the
  // exact behaviour this screen is trying not to have.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const takePro = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await goToCheckout(plan.id);
    if (result.ok) return; // navigating to Stripe; leave the button busy.

    if (result.reason === "not-configured") {
      // Writing entitlements announces itself, so the run, the industry grid
      // and the closet all pick Pro up without a reload. See
      // onEntitlementsChange in lib/monetization.ts.
      grantProLocally(plan.id);
      play("success");
      onClose();
      return;
    }
    if (result.reason === "owned") {
      onClose();
      return;
    }

    setBusy(false);
    setError(
      result.reason === "needs-account"
        ? "Pro attaches to an account, so it survives a new phone. Create one on the front page first — the free game does not need one."
        : result.reason === "signed-out"
          ? "Could not reach your account. Check your connection and try again."
          : "Checkout could not be opened. Nothing was charged.",
    );
  };

  const priceLine =
    canCharge === null
      ? " "
      : canCharge
        ? `${formatPrice(plan.priceCents)}${CADENCE_SUFFIX[plan.cadence]}, billed by Stripe. Cancel any time.`
        : "No card is taken. Pro switches on for this device until accounts launch.";

  /* The picker, the button and the two lines under it. Identical on both
     compositions — only where they sit changes, so the price a player reads is
     never a different element from the price they pressed. */
  const purchase = (
    <>
      <div
        className="grid grid-cols-2 gap-2 lg:grid-cols-1"
        role="group"
        aria-label="Billing period"
      >
        {[PRO_MONTHLY, PRO_YEARLY].map((p) => {
          const on = p.id === plan.id;
          const monthly = p.id === PRO_MONTHLY.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                play("click");
                setPlan(p);
              }}
              className={`nv-press rounded-[var(--radius-card)] px-3 py-2.5 text-left ${
                on
                  ? "bg-[var(--surface-elevated)] shadow-[var(--e2)]"
                  : "bg-[var(--surface)]"
              }`}
            >
              {/* Stacked, not "$6.99 A MONTH" on one line. Side by side, the
                  cadence broke across two lines inside a 320px tile — §7's
                  no-two-line-clickable-text rule, and it is the same three-line
                  tile the /welcome plans screen already uses. */}
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
              {/* The comparison is carried by BOTH tiles. A yearly plan that
                  advertises its saving beside a monthly plan that hides its
                  true annual cost is an argument, not a price list. */}
              <span className="tnum mt-0.5 block text-2xs text-[var(--text-tertiary)]">
                {monthly
                  ? `${formatPrice(MONTHLY_ANNUALISED_CENTS)} a year`
                  : `${formatPrice(YEARLY_SAVING_CENTS)} less`}
              </span>
            </button>
          );
        })}
      </div>

      {/* The one element on this screen wearing the action orange. */}
      <button
        type="button"
        onClick={takePro}
        disabled={busy}
        className="nv-press mt-3 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e2)] disabled:opacity-60"
      >
        {busy ? "OPENING…" : "GET PRO"}
      </button>

      {/* Deliberately NOT `.tnum`. It carries a price, but it is a sentence —
          and `.tnum` sets the ledger face, which put the whole promise in
          monospace. The ledger face belongs to figures being compared, which is
          the two tiles above, not this. */}
      <p className="mt-1.5 text-center text-2xs leading-snug text-[var(--text-tertiary)]">
        {priceLine}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-1.5 text-center text-2xs leading-relaxed text-[var(--alert)]"
        >
          {error}
        </p>
      ) : null}

      {/* Same width and height as GET PRO, solid rather than accented. Staying
          free is one of two answers to the question, not the way out of a
          paywall, and a 12px underline would say otherwise. */}
      <button
        type="button"
        onClick={onClose}
        className="nv-press mt-2.5 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--surface-elevated)] text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--text-primary)]"
      >
        KEEP PLAYING FREE
      </button>
    </>
  );

  return (
    <div className="fixed inset-0 z-[98] flex items-end justify-center lg:items-center lg:p-6">
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
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] bg-[var(--sheet)] shadow-[var(--e4)] lg:max-h-[min(42rem,92dvh)] lg:max-w-4xl lg:rounded-[var(--radius-card)]"
        initial={reduced ? { opacity: 0 } : { y: "8%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={reduced ? { opacity: 0, transition: EXIT } : { y: "6%", opacity: 0, transition: EXIT }}
        transition={SHEET_SPRING}
      >
        <header className="flex items-start justify-between gap-4 px-5 pt-5 lg:px-7 lg:pt-6">
          <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
            NOVUS PRO
          </p>
          <button
            type="button"
            onClick={onClose}
            className="nv-press -mr-1 -mt-1 shrink-0 rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]"
          >
            CLOSE
          </button>
        </header>

        {/*
          One scroll container, on both compositions. At lg it is the grid
          itself that scrolls, so a short viewport still reaches the button
          instead of clipping the right-hand panel against the card's edge.

          No `.nv-sheet-fade` here, deliberately. The utility pins its gradient
          with `position: absolute; bottom: 0`, which inside a scroller resolves
          against the scrolled CONTENT — the fade ends up at the bottom of the
          whole document and never on screen. Hanging it off a static wrapper
          fixes that and breaks something worse: this sheet is sized by its
          content under a `max-h`, so a wrapper whose only child is absolutely
          positioned has no intrinsic height and the scroll area collapses to
          nothing at 320px. The pinned strip already carries a hairline and a
          solid fill, which reads as the deliberate boundary it is.
        */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-7 lg:px-7 lg:pb-7">
          {/* ── The argument ─────────────────────────────────────────────── */}
          <div className="min-w-0">
            <h2 className="mt-1 text-[1.625rem] font-extrabold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere] lg:text-[1.75rem]">
              {gate ? gate.title : "Free is the whole game. Pro is more rooms in it."}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              {gate
                ? gate.body
                : "Same twelve months, same year-end pitch, same scoring, same board."}
            </p>

            <ul className="mt-5">
              {PRO_FEATURES.map((f) => {
                const hit = gate?.feature === f.id;
                return (
                  <li
                    key={f.id}
                    className={`border-t border-[var(--hairline)] py-3 ${
                      hit
                        ? "-mx-3 rounded-[var(--radius-row)] border-transparent bg-[var(--surface-elevated)] px-3 shadow-[var(--e1)]"
                        : ""
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="min-w-0 text-sm font-extrabold [overflow-wrap:anywhere]">
                        {f.title}
                      </h3>
                      {/* The marked row states why it is marked. A highlight
                          with no label is decoration; this one is the answer to
                          "what did I just hit". */}
                      <span
                        className={`shrink-0 text-2xs font-bold tracking-[0.1em] ${
                          hit
                            ? "text-[var(--color-prestige)]"
                            : "text-[var(--text-tertiary)]"
                        }`}
                      >
                        {hit ? "WHAT YOU HIT" : `FREE · ${f.free.toUpperCase()}`}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {f.body}
                      {hit ? (
                        <span className="text-[var(--text-tertiary)]">
                          {" "}
                          Free: {f.free.toLowerCase()}.
                        </span>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>

            {/* The promise travels with the argument on desktop and sits above
                the pinned strip on phone — either way it is read before the
                button, never after it in a footnote. */}
            <p className="mt-5 border-t border-[var(--hairline)] pt-3.5 text-xs leading-relaxed text-[var(--text-secondary)] lg:mt-6">
              {PRO_PROMISE}{" "}
              <span className="text-[var(--text-primary)]">
                That is not a promise — it is the design.
              </span>
            </p>
          </div>

          {/*
            ── The purchase · desktop only ─────────────────────────────────

            The well is `--bg`, a step BELOW the sheet, not `--card`. Card is
            n-3, which in light is the one true white — and so are the selected
            plan tile and KEEP PLAYING FREE, so a card-coloured panel swallowed
            both of them and the free exit rendered as bare text on white.
            Recessed, the three surfaces inside it read as three steps.
          */}
          <div className="hidden lg:sticky lg:top-0 lg:mt-1 lg:block lg:rounded-[var(--radius-card)] lg:bg-[var(--bg)] lg:p-4">
            {purchase}
          </div>
        </div>

        {/* ── The purchase · phone only, pinned ───────────────────────────── */}
        <div className="shrink-0 border-t border-[var(--hairline)] bg-[var(--sheet)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 lg:hidden">
          {purchase}
        </div>
      </motion.section>
    </div>
  );
}
