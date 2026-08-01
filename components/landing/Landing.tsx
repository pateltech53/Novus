"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { LandingShark } from "@/components/landing/LandingShark";
import { AccountGate } from "@/components/landing/AccountGate";
import { ScrollPhone } from "@/components/landing/ScrollPhone";
import {
  CHAPTER_LICENCES,
  ONE_TIME_PURCHASES,
  PRO_MONTHLY,
  PRO_YEARLY,
  YEARLY_SAVING_CENTS,
  formatPrice,
  formatRange,
  grantProLocally,
  perSeatCents,
  type ProPlanId,
  type SubscriptionPlan,
} from "@/lib/monetization";
import { goToCheckout } from "@/lib/cloud/billing";
import { loadProfile } from "@/lib/engine/save";
import { loadAccount } from "@/lib/account";

/**
 * The front door.
 *
 * The page is the argument for the product, in the order a stranger needs it:
 *
 *   1. WHAT — the champion on its stage, the promise, the gate.
 *   2. WHY — the belief the whole product is built on: you do not learn to
 *      ride a bike by watching videos. This is the identity section, and it is
 *      set like a manifesto because it is one.
 *   3. THE GAME — one real screen, in hand, on a phone the visitor turns with
 *      their own scroll.
 *   4. THE PRICE — every tier on the table with real numbers, and the line
 *      that governs all of them.
 *   5. WHO — five students at LaunchX Flagship, San Diego 2026.
 *   6. The address: team@novuspitch.com.
 */

export function Landing() {
  const reduced = useReducedMotion();
  const rise = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <main className="min-h-dvh">
      {/* ── 1 · The stage ─────────────────────────────────────────────────── */}
      <header className="nv-stage relative overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-10">
          <div className="flex items-baseline justify-between pt-[max(1.5rem,env(safe-area-inset-top))]">
            <p className="text-sm font-extrabold tracking-[0.24em]">NOVUS</p>
            <p className="tnum hidden text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)] sm:block">
              FREE TO PLAY · PRO OPTIONAL
            </p>
          </div>

          <div className="lg:grid lg:grid-cols-12 lg:items-end lg:gap-6">
            <motion.div
              {...(reduced
                ? {}
                : {
                    initial: { opacity: 0, y: 24 },
                    animate: { opacity: 1, y: 0 },
                    transition: {
                      duration: 0.55,
                      ease: [0.16, 1, 0.3, 1] as const,
                    },
                  })}
              className="relative mx-auto mt-2 h-[44dvh] min-h-[280px] w-full max-w-[24rem] lg:order-2 lg:col-span-6 lg:mx-0 lg:mt-0 lg:h-[560px] lg:max-w-none"
            >
              <div
                aria-hidden="true"
                className="absolute bottom-[3.5%] left-1/2 h-[4.5%] w-[46%] -translate-x-1/2 rounded-[50%] bg-black/25 blur-xl"
              />
              <LandingShark className="h-full w-full" />
            </motion.div>

            <div className="pb-10 lg:order-1 lg:col-span-6 lg:self-center lg:pb-20">
              <motion.h1
                {...rise(0.08)}
                className="mt-6 text-[2.25rem] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[2.75rem] lg:mt-0 lg:text-[3rem]"
              >
                Keep a company alive.
                <br />
                Defend it out loud.
              </motion.h1>
              <motion.p
                {...rise(0.16)}
                className="mt-4 max-w-[26rem] text-[0.9375rem] leading-relaxed text-[var(--text-secondary)] lg:text-base"
              >
                A life sim for a company. You make every call — who to hire,
                what to ship, which deal to walk past — and once a year the game
                stops and asks you to defend it: a pitch, out loud, to five
                investors who have read your numbers.
              </motion.p>

              <motion.div {...rise(0.24)} className="mt-7 max-w-[24rem]">
                <AccountGate />
              </motion.div>
            </div>
          </div>
        </div>
      </header>

      {/* ── 2 · The belief ─────────────────────────────────────────────────
          The reason the product exists, set as a statement because it is one.
          This is the section the rest of the page hangs off. */}
      <section
        aria-label="Why Novus exists"
        className="border-y border-[var(--hairline)] bg-[var(--n-2)]"
      >
        <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:px-10 lg:py-24">
          <p className="max-w-[17em] text-[1.75rem] font-extrabold leading-[1.12] tracking-[-0.02em] sm:text-[2.25rem] lg:text-[2.75rem]">
            You don&rsquo;t learn to ride a bike by watching videos of people
            riding bikes.
          </p>
          <div className="mt-8 max-w-[38rem] space-y-4 text-[0.9375rem] leading-relaxed text-[var(--text-secondary)] lg:text-base">
            <p>
              You get on. You wobble. You fall off in front of everyone, and you
              go again. That is how anyone has ever learned anything worth
              knowing — and it is exactly how business is not taught.
            </p>
            <p>
              Novus is built on one belief:{" "}
              <span className="font-bold text-[var(--text-primary)]">
                you learn business by running one.
              </span>{" "}
              Set the prices. Make the hires. Sit with a bad quarter you caused.
              And once a year, stand up — actually out loud, actually on camera —
              and defend the whole thing to investors who have read your books.
              Not a lecture about pitching. The pitch.
            </p>
          </div>
        </div>
      </section>

      {/* ── 3 · The game, in hand ──────────────────────────────────────────
          One real screen on a phone the visitor turns with their own scroll. */}
      <section aria-label="The game itself">
        <ScrollPhone>
          <div>
            <h2 className="text-[1.5rem] font-extrabold leading-tight tracking-[-0.02em] lg:text-[1.875rem]">
              Your whole company,
              <br />
              one month at a time.
            </h2>
            <ul className="mt-5 max-w-[24rem] space-y-3.5">
              {[
                {
                  title: "Run it",
                  body: "Cash, burn, runway, valuation — live, and moved by every call you make.",
                },
                {
                  title: "Live with it",
                  body: "Suppliers squeeze, rivals copy, a critic books a table. Your industry, your problems.",
                },
                {
                  title: "Defend it",
                  body: "The year ends when you pitch it — on camera, judged on what you say, never how you sound.",
                },
              ].map((row) => (
                <li key={row.title} className="border-t border-[var(--hairline)] pt-3">
                  <p className="text-sm font-extrabold">{row.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {row.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </ScrollPhone>
      </section>

      {/* ── 4 · The price of everything ────────────────────────────────────── */}
      <PricingSection />

      {/* ── 5 · Who made this ─────────────────────────────────────────────── */}
      <section
        aria-label="The team"
        className="mx-auto w-full max-w-6xl px-6 pt-16 lg:px-10 lg:pt-24"
      >
        <div className="lg:grid lg:grid-cols-12 lg:gap-6">
          <div className="lg:col-span-4">
            <h2 className="text-[1.5rem] font-extrabold leading-tight tracking-[-0.02em] lg:text-[1.875rem]">
              Built by five students.
            </h2>
            <p className="mt-3 max-w-[20rem] text-sm leading-relaxed text-[var(--text-secondary)]">
              Novus was designed and built at the{" "}
              <span className="font-bold text-[var(--text-primary)]">
                LaunchX Flagship program, San&nbsp;Diego, summer 2026
              </span>{" "}
              — designed, coded and pitched in one summer.
            </p>
          </div>
          <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:col-span-8 lg:mt-0 lg:grid-cols-5">
            {TEAM.map((member) => (
              <li key={member.name} className="min-w-0">
                <div className="overflow-hidden rounded-[1.1rem] shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
                  <Image
                    src={member.photo}
                    alt={`${member.name} — ${member.role}`}
                    width={720}
                    height={900}
                    sizes="(min-width: 1024px) 14vw, (min-width: 640px) 30vw, 45vw"
                    className="block w-full"
                  />
                </div>
                <p className="mt-2.5 text-sm font-extrabold">{member.name}</p>
                <p className="mt-0.5 text-2xs font-bold tracking-[0.06em] text-[var(--text-tertiary)]">
                  {member.role.toUpperCase()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── 6 · Close ─────────────────────────────────────────────────────── */}
      <footer className="mx-auto w-full max-w-6xl px-6 pb-[max(3rem,env(safe-area-inset-bottom))] pt-16 lg:px-10 lg:pt-24">
        <div className="border-t border-[var(--hairline)] pt-10 lg:pt-14">
          <p className="text-[2rem] font-extrabold leading-none tracking-[-0.03em] lg:text-[2.75rem]">
            Found something.
          </p>
          <div className="mt-6 max-w-[24rem]">
            <AccountGate />
          </div>
          <div className="mt-12 flex flex-col gap-3 border-t border-[var(--hairline)] pt-5 sm:flex-row sm:items-baseline sm:justify-between">
            <p className="text-2xs font-extrabold tracking-[0.24em] text-[var(--text-tertiary)]">
              NOVUS
            </p>
            <a
              href="/download"
              className="text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
            >
              Get the app
            </a>
            <a
              href="mailto:team@novuspitch.com"
              className="tnum text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
            >
              team@novuspitch.com
            </a>
            <p className="text-2xs leading-relaxed text-[var(--text-tertiary)]">
              Score, survival and the leaderboard are never for sale.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}

/**
 * Every tier on the table, with the rule that governs all of them stated in
 * the same breath. Buttons are real: choosing Pro grants it on this device now
 * (lib/monetization.ts — the honest pre-billing behaviour) and walks into the
 * game.
 */
function PricingSection() {
  const router = useRouter();

  /** The plan whose checkout is opening, so only that button reads BUSY. */
  const [busy, setBusy] = useState<ProPlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enter = () => {
    // A named account with an onboarded profile skips straight to founding.
    const dest =
      loadAccount() && loadProfile()?.onboarded ? "/found" : "/welcome";
    router.push(dest);
  };

  /**
   * Same two behaviours as the onboarding sheet, and for the same reason —
   * see the long note on takePro() in app/welcome/page.tsx. Checkout when
   * Stripe is configured, the device-local grant when it is not, and no grant
   * at all when a configured checkout fails.
   */
  const choosePro = async (plan: SubscriptionPlan) => {
    if (busy) return;
    setBusy(plan.id);
    setError(null);

    const result = await goToCheckout(plan.id);
    if (result.ok) return; // leaving for Stripe

    if (result.reason === "not-configured") {
      grantProLocally(plan.id);
      enter();
      return;
    }
    if (result.reason === "owned") {
      enter();
      return;
    }

    setBusy(null);
    setError("Checkout could not be opened. Nothing was charged.");
  };

  return (
    <section
      aria-label="Pricing"
      className="border-y border-[var(--hairline)] bg-[var(--n-2)]"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-16 lg:px-10 lg:py-24">
        <h2 className="text-[1.5rem] font-extrabold leading-tight tracking-[-0.02em] lg:text-[1.875rem]">
          Free is the whole game.
        </h2>
        <p className="mt-2 max-w-[30rem] text-sm leading-relaxed text-[var(--text-secondary)]">
          Same twelve months, same pitch, same scoring, same board. Pro opens
          more of the world — never a better game.
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-3">
          {/* Free — first, and a real column, not a foil. */}
          <div className="flex flex-col rounded-[var(--radius-card)] bg-[var(--n-3)] p-6 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
            <p className="text-sm font-extrabold tracking-[0.08em]">FREE</p>
            <p className="tnum mt-2 text-[2rem] font-extrabold leading-none">
              $0
            </p>
            <ul className="mt-5 flex-1 space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              <li>Four industries, whole game</li>
              <li>One company a day — no redo</li>
              <li>The full pitch, scored the same</li>
              <li>The wardrobe track banks progress</li>
            </ul>
            <button
              type="button"
              onClick={enter}
              className="nv-press mt-6 w-full rounded-full bg-[var(--n-4)] px-5 py-3 text-sm font-extrabold tracking-[0.04em]"
            >
              PLAY FREE
            </button>
          </div>

          {/* Pro — two cadences, one card, yearly framed by its saving. */}
          <div className="flex flex-col rounded-[var(--radius-card)] bg-[var(--n-3)] p-6 shadow-[var(--e2)] ring-1 ring-[var(--text-primary)]">
            <p className="text-sm font-extrabold tracking-[0.08em]">PRO</p>
            <p className="tnum mt-2 text-[2rem] font-extrabold leading-none">
              {formatPrice(PRO_MONTHLY.priceCents)}
              <span className="text-sm font-bold text-[var(--text-tertiary)]">
                {" "}
                / month
              </span>
            </p>
            <p className="tnum mt-1 text-2xs font-bold text-[var(--text-tertiary)]">
              OR {formatPrice(PRO_YEARLY.priceCents)} A YEAR —{" "}
              {formatPrice(YEARLY_SAVING_CENTS)} LESS
            </p>
            <ul className="mt-5 flex-1 space-y-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              <li>All twelve industries</li>
              <li>Three companies a day</li>
              <li>The Room — cold-call real investors</li>
              <li>Wear the wardrobe you earn</li>
            </ul>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void choosePro(PRO_MONTHLY)}
                disabled={busy !== null}
                className="nv-press w-full rounded-full bg-[var(--action)] px-4 py-3 text-sm font-extrabold tracking-[0.04em] text-[var(--on-action)] disabled:opacity-60"
              >
                {busy === PRO_MONTHLY.id ? "OPENING…" : "MONTHLY"}
              </button>
              <button
                type="button"
                onClick={() => void choosePro(PRO_YEARLY)}
                disabled={busy !== null}
                className="nv-press w-full rounded-full bg-[var(--action)] px-4 py-3 text-sm font-extrabold tracking-[0.04em] text-[var(--on-action)] disabled:opacity-60"
              >
                {busy === PRO_YEARLY.id ? "OPENING…" : "YEARLY"}
              </button>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-xs leading-relaxed text-[var(--color-alert)]">
                {error}
              </p>
            ) : null}
          </div>

          {/* Chapters — the teacher's column. */}
          <div className="flex flex-col rounded-[var(--radius-card)] bg-[var(--n-3)] p-6 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
            <p className="text-sm font-extrabold tracking-[0.08em]">CHAPTERS</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              For classrooms and clubs — every seat gets Pro.
            </p>
            <dl className="mt-5 flex-1 space-y-3">
              {CHAPTER_LICENCES.map((licence) => (
                <div
                  key={licence.id}
                  className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] pt-3"
                >
                  <dt className="text-sm font-bold">{licence.seats} seats</dt>
                  <dd className="tnum text-right text-sm">
                    <span className="font-extrabold">
                      {formatPrice(licence.priceCents)}
                    </span>
                    <span className="text-2xs text-[var(--text-tertiary)]">
                      {" "}
                      / yr · {formatPrice(perSeatCents(licence))} a seat
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <a
              href="mailto:team@novuspitch.com?subject=Novus%20chapter%20licence"
              className="nv-press mt-6 w-full rounded-full bg-[var(--n-4)] px-5 py-3 text-center text-sm font-extrabold tracking-[0.04em]"
            >
              EMAIL THE TEAM
            </a>
          </div>
        </div>

        {/* One-time buys — a shelf, not a column. Closet only, per the rule. */}
        <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {ONE_TIME_PURCHASES.map((item) => (
            <p key={item.id} className="text-sm text-[var(--text-secondary)]">
              <span className="font-bold text-[var(--text-primary)]">
                {item.name}
              </span>{" "}
              <span className="tnum">
                {item.maxPriceCents
                  ? formatRange(item.priceCents, item.maxPriceCents)
                  : formatPrice(item.priceCents)}
              </span>
            </p>
          ))}
        </div>

        <p className="mt-6 max-w-[34rem] text-xs leading-relaxed text-[var(--text-secondary)]">
          <span className="font-bold text-[var(--text-primary)]">
            Pro never buys a score, a survival, a revive, or a place on the
            board.
          </span>{" "}
          Those are earned or they are nothing. No card is taken yet — choosing
          Pro switches it on for this device until online accounts launch.
        </p>
      </div>
    </section>
  );
}

/** Photos ship from files named by each person — no guessed mappings. */
const TEAM = [
  { name: "Yuvan", role: "Marketing & media", photo: "/landing/team/yuvan.webp" },
  {
    name: "Dhruv",
    role: "Coding, app building & operations",
    photo: "/landing/team/dhruv.webp",
  },
  { name: "Zach", role: "Coding & app building", photo: "/landing/team/zach.webp" },
  { name: "Ana", role: "Customer research", photo: "/landing/team/ana.webp" },
  { name: "Monica", role: "Outreach", photo: "/landing/team/monica.webp" },
] as const;
