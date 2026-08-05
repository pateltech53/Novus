"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
/*
 * No framer-motion import here any more.
 *
 * Every animation this component owned was an entrance, and entrances are the
 * one kind of motion that must not wait for a JavaScript bundle — see `.nv-rise`
 * in globals.css. What is left on this page that genuinely needs JS (the
 * scroll-linked phone, the WebGL mascot) lives in its own dynamically-imported
 * child, so `/` no longer pulls Framer's DOM feature bundle to fade in a
 * headline.
 */
import { LandingShark } from "@/components/landing/LandingShark";
import { AccountGate } from "@/components/landing/AccountGate";
import { Faq } from "@/components/landing/Faq";
import { ScrollPhone } from "@/components/landing/ScrollPhone";
import {
  CHAPTER_CUSTOM_MAX_SEATS,
  CHAPTER_CUSTOM_MIN_SEATS,
  CHAPTER_LICENCES,
  PRO_MONTHLY,
  PRO_YEARLY,
  YEARLY_SAVING_CENTS,
  customChapterPriceCents,
  formatPrice,
  grantProLocally,
  isCustomSeatCount,
  perSeatCents,
  type ChapterLicence,
  type ProPlanId,
  type SubscriptionPlan,
} from "@/lib/monetization";
import { goToCheckout } from "@/lib/cloud/billing";
import { OneTimeShelf } from "@/components/upgrade/OneTimeShelf";
import { rememberPendingPro } from "@/lib/cloud/pending-pro";
import { whenRestored } from "@/lib/cloud/sync";
import { useSellsHere } from "@/lib/commerce";
import { entryRoute } from "@/lib/entry";
import { loadAccount } from "@/lib/account";
import { useNavigating } from "@/lib/navigating";

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

/**
 * The account form the pricing section sends a signed-out buyer to.
 *
 * The gate is rendered twice — hero and close — and this is the second one,
 * because it is the one a player standing at the prices is nearest to. An
 * anchor pointing three sections back up the page is a scroll a phone reads as
 * having lost its place.
 */
const ACCOUNT_ANCHOR = "account";

export function Landing() {
  /*
   * ── There used to be a redirect here, and it is not coming back ──────────
   *
   * The app is meant to open at /boot.html, and a player who reaches THIS page
   * inside the app has already gone somewhere they should not be. The obvious
   * repair was for the page to notice and bounce itself to the entry route.
   *
   * It was shipped and it made the app worse: launches began hanging on the
   * splash. Which is a specific failure worth writing down, because the
   * redirect itself was not obviously at fault — `launchAutoHide` was false,
   * so the launch screen had exactly one way to end, and that was
   * `NativeShell` mounting and calling `SplashScreen.hide()`. A navigation
   * during boot throws away the frame that was going to make that call. The
   * next page does mount and does call it, so on paper it recovers; on a
   * device, one more chance to not run the only code that can dismiss the
   * launch screen is one chance too many.
   *
   * The backstop in capacitor.config.ts now means a missed dismissal is no
   * longer fatal. This is still not the place to fix a wrong entry point: a
   * page that navigates during its own boot is a race against the shell, and
   * the entry point is the shell's to get right. What is left is the thing
   * that actually hurt — CONTINUE AS being unable to navigate — and that is
   * fixed where the tap is handled, which runs long after boot has settled.
   */

  /*
   * The hero's entrance is CSS now — `.nv-rise` in globals.css, where the
   * reasoning lives.
   *
   * The short version: this used to be a Framer `initial={{ opacity: 0 }}`, and
   * Framer writes `initial` into the server-rendered markup. The prerendered
   * index.html shipped the H1, the subhead, the account gate and the stage box
   * all carrying `style="opacity:0"` — the entire above-the-fold — and they
   * stayed invisible until the bundle had downloaded, parsed and hydrated. The
   * page was prerendered and then hidden.
   *
   * `reduced` is not consulted here on purpose: the media query in globals.css
   * reaches a CSS animation directly, which is the one case where it does not
   * need JavaScript's help. (It still matters below, where the motion IS JS.)
   */
  const rise = (delay: number, className: string) => ({
    className: `nv-rise ${className}`,
    style: { "--nv-rise-delay": `${delay}ms` } as React.CSSProperties,
  });

  return (
    <main className="min-h-dvh">
      {/* ── 1 · The stage ─────────────────────────────────────────────────── */}
      <header data-live-3d className="nv-stage relative overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-6 lg:px-10">
          <div className="flex items-baseline justify-between pt-[max(1.5rem,env(safe-area-inset-top))]">
            <p className="text-sm font-extrabold tracking-[0.24em]">NOVUS</p>
            <p className="tnum hidden text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)] sm:block">
              FREE TO PLAY · PRO OPTIONAL
            </p>
          </div>

          <div className="lg:grid lg:grid-cols-12 lg:items-end lg:gap-6">
            <div
              /* `svh`, not `dvh`. A mobile browser re-resolves `dvh` on every
                 frame of its toolbar collapse, and this box holds a WebGL
                 canvas — so the drawing buffer was being reallocated and the
                 page reflowed all the way through the visitor's first drag.
                 `svh` holds still. Same reasoning in ScrollPhone. */
              className="nv-rise nv-rise-stage relative mx-auto mt-2 h-[44svh] min-h-[280px] w-full max-w-[24rem] lg:order-2 lg:col-span-6 lg:mx-0 lg:mt-0 lg:h-[560px] lg:max-w-none"
            >
              <div
                aria-hidden="true"
                className="absolute bottom-[3.5%] left-1/2 h-[4.5%] w-[46%] -translate-x-1/2 rounded-[50%] bg-black/25 blur-xl"
              />
              <LandingShark className="h-full w-full" />
            </div>

            <div className="pb-10 lg:order-1 lg:col-span-6 lg:self-center lg:pb-20">
              <h1
                {...rise(
                  80,
                  "mt-6 text-[2.25rem] font-extrabold leading-[1.04] tracking-[-0.03em] sm:text-[2.75rem] lg:mt-0 lg:text-[3rem]",
                )}
              >
                Keep a company alive.
                <br />
                Defend it out loud.
              </h1>
              <p
                {...rise(
                  160,
                  "mt-4 max-w-[26rem] text-[0.9375rem] leading-relaxed text-[var(--text-secondary)] lg:text-base",
                )}
              >
                A life sim for a company. You make every call — who to hire,
                what to ship, which deal to walk past — and once a year the game
                stops and asks you to defend it: a pitch, out loud, to five
                investors who have read your numbers.
              </p>

              <div {...rise(240, "mt-7 max-w-[24rem]")}>
                <AccountGate />
              </div>
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
              And once a year, stand up — actually out loud, actually on camera
              — and defend the whole thing to investors who have read your
              books. Not a lecture about pitching. The pitch.
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
                <li
                  key={row.title}
                  className="border-t border-[var(--hairline)] pt-3"
                >
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

      {/* ── 4b · The questions asked before anyone starts ─────────────────── */}
      <Faq />

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
                <div className="overflow-hidden rounded-[var(--radius-card)] shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
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
          <div id={ACCOUNT_ANCHOR} className="mt-6 max-w-[24rem] scroll-mt-6">
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
            {/* The two accounts, linked rather than only claimed.
                lib/seo.ts lists them in the Organization's `sameAs`, and a
                search engine treats that claim as evidence when the site
                actually links out to them. `rel="me"` says the same thing in
                the older, simpler vocabulary some crawlers still read. */}
            <a
              href="https://www.instagram.com/novuspitch/"
              rel="me noopener"
              target="_blank"
              className="text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
            >
              Instagram
            </a>
            <a
              href="https://www.tiktok.com/@novuspitch"
              rel="me noopener"
              target="_blank"
              className="text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
            >
              TikTok
            </a>
            {/* Both documents, from the front door. App Store Connect asks for
                these two URLs and a reviewer follows them from here. */}
            <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              <a className="underline underline-offset-4" href="/privacy">
                PRIVACY
              </a>
              <span className="px-2">·</span>
              <a className="underline underline-offset-4" href="/terms">
                TERMS OF USE
              </a>
            </p>
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

  /**
   * This is a marketing page, and the whole page ships inside the app bundle —
   * `out/index.html` is the export of this file. Nothing routes here from
   * inside the app on purpose (native/boot.html opens the game, sign-out lands
   * on the entry route, and the legal sheets name URLs instead of linking
   * them), but a price list one stray navigation away from an App Store build
   * is a rejection waiting for a bug. So the section that carries every price
   * and both checkout buttons removes itself in a store build — see
   * lib/commerce.ts. On the web nothing changes.
   */
  const sells = useSellsHere();

  /** The plan whose checkout is opening, so only that button reads BUSY. */
  const [busy, setBusy] = useState<ProPlanId | ChapterLicence["id"] | "chapter_custom" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  /*
   * PLAY FREE is the one control on this page that leaves it, and it awaited
   * the cloud restore for up to four seconds with nothing on the button.
   * Separate from `busy` above, which tracks which PLAN is mid-checkout.
   */
  const [entering, goEnter, releaseEnter] = useNavigating();
  /** The chapter column's own error line — a teacher refused at 35 SEATS
   *  should not read the message inside the Pro card two columns away. */
  const [chapterError, setChapterError] = useState<string | null>(null);
  /** What the CUSTOM row's input holds — kept as text so a half-typed number
   *  ("2", on the way to "25") is not fought by the field. */
  const [customSeatsText, setCustomSeatsText] = useState("");

  const enter = async () => {
    // Settled state first, exactly as AccountGate's CONTINUE does and for the
    // same reason: these three reads are localStorage, and on a device the
    // boot restore is still filling they answer for a player who is not this
    // one. Resolves immediately once that has landed.
    //
    // It resolves immediately in the common case and waits up to
    // RESTORE_WAIT_MS otherwise — which is why the latch is taken BEFORE the
    // await rather than around the push. The wait is the part the player was
    // staring at an unchanged button through.
    await whenRestored();
    /*
     * Playing starts at the gate now. PLAY FREE used to walk a visitor
     * straight into the game with nothing for their companies to attach to —
     * the one door on this page that skipped the account. Same handling as a
     * signed-out plan press, because it is the same situation: say why, and
     * put them in front of the form that fixes it. Sign-up keeps whatever
     * this device has already played, so nothing is lost by being asked.
     */
    if (!loadAccount()) {
      // Not a navigation after all — give the button back before the timer
      // would, so OPENING… does not sit next to the message explaining why
      // nothing opened.
      releaseEnter();
      setBusy(null);
      setError(
        "Novus plays on a free account, so your companies are saved and can follow you to a new device. Create one below and you're in.",
      );
      document
        .getElementById(ACCOUNT_ANCHOR)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    // An open company wins over everything else — buying Pro must never be the
    // moment a player is handed a "found a new one" screen instead of the one
    // they already have (lib/entry.ts). Below that, a named account with an
    // onboarded profile skips straight to founding.
    // `entryRoute()` rather than a third copy of the ladder. This block and
    // native/boot.html and lib/entry.ts were three transcriptions of one rule,
    // and they had already drifted once — the whole reason lib/entry.ts exists.
    router.push(entryRoute());
  };

  /**
   * Same two behaviours as the onboarding sheet, and for the same reason —
   * see the long note on takePro() in app/welcome/page.tsx. Checkout when
   * Stripe is configured, the device-local grant when it is not, and no grant
   * at all when a configured checkout fails.
   *
   * ── The refusal this used not to have a name for ───────────────────────────
   *
   * `signed-out` had no branch, so a visitor with no session — which is EVERY
   * visitor arriving from the App Store build, whose GET PRO link opens this
   * section in a browser that has never held the app's cookie — pressed MONTHLY
   * or YEARLY and was told "Checkout could not be opened. Nothing was charged."
   * That sentence is for a checkout that broke. Nothing was broken: the server
   * declined to sell a subscription to nobody, exactly as it should, and the one
   * fact the player needed — make an account first — was the one thing the
   * screen did not say.
   *
   * So it says it, and then does something about it: the plan is remembered, the
   * page scrolls to the gate, and finishing sign-up or sign-in opens the
   * checkout by itself (lib/cloud/pending-pro.ts). Pressing a price should not
   * cost a player their place in the flow.
   */
  const choosePro = async (plan: SubscriptionPlan) => {
    if (busy) return;
    setBusy(plan.id);
    setError(null);

    const result = await goToCheckout(plan.id);
    if (result.ok) return; // leaving for Stripe

    // The operator's fork: a skip is a completed purchase (granted
    // server-side, already adopted), so it enters exactly as `owned` does.
    if (result.reason === "admin-cancel") {
      setBusy(null);
      return;
    }
    if (result.reason === "admin-skip") {
      await enter();
      return;
    }

    if (result.reason === "not-configured") {
      grantProLocally(plan.id);
      await enter();
      return;
    }
    if (result.reason === "owned") {
      await enter();
      return;
    }

    setBusy(null);

    if (result.reason === "signed-out" || result.reason === "needs-account") {
      rememberPendingPro(plan.id);
      setError(
        result.reason === "signed-out"
          ? `Pro attaches to a Novus account, so it survives a new phone — and this browser is not signed in to one. Create an account or sign in below and ${plan.label.toLowerCase()} checkout opens by itself.`
          : "Pro attaches to a named account so it survives a new phone. Create one below — it costs nothing, and checkout opens by itself.",
      );
      // The gate is two sections further down and off-screen either way. A
      // message pointing at a form nobody can see is the same dead end in
      // politer words.
      document
        .getElementById(ACCOUNT_ANCHOR)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    // A real failure. The server's own words are carried through rather than
    // swallowed: "STRIPE_PRICE_PRO_YEARLY … costs 3999 cents but the app
    // displays 4999" is answerable from a screenshot. "Checkout could not be
    // opened", on its own, is not — it was every failure this page had.
    setError(
      result.message
        ? `Checkout could not be opened. Nothing was charged. (${result.message})`
        : "Checkout could not be opened. Nothing was charged.",
    );
  };

  /**
   * A licence checkout, from the chapters column — a fixed size, or the
   * CUSTOM row's typed one (`seats` set exactly when the sku is custom).
   *
   * Same shape as choosePro with two differences that matter: there is no
   * device-local fallback (a classroom licence on one browser's localStorage
   * would be a licence for nobody), and success lands on /chapter — the
   * console the purchase just opened — rather than back in the game.
   */
  const chooseChapter = async (
    sku: ChapterLicence["id"] | "chapter_custom",
    seats?: number,
  ) => {
    if (busy) return;
    setBusy(sku);
    setChapterError(null);

    const result = await goToCheckout(sku, undefined, seats);
    if (result.ok) return; // leaving for Stripe

    // The operator's fork: a skipped licence is a live chapter, and success
    // lands on the console it just opened — the same place a paid one lands.
    if (result.reason === "admin-skip") {
      window.location.assign("/chapter");
      return;
    }

    setBusy(null);

    if (result.reason === "admin-cancel") return;

    if (result.reason === "signed-out" || result.reason === "needs-account") {
      setChapterError(
        "A chapter attaches to the account that runs it. Create one or sign in below, then choose the licence again.",
      );
      document
        .getElementById(ACCOUNT_ANCHOR)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (result.reason === "owned") {
      setChapterError("This account already runs a chapter — open its console below.");
      return;
    }
    if (result.reason === "not-configured") {
      // No local-grant fallback for a licence. The mail address is the honest
      // door on a deploy that cannot take the money.
      setChapterError(
        "This build cannot take payments. Email team@novuspitch.com and a person will set the chapter up.",
      );
      return;
    }
    setChapterError(
      result.message
        ? `Checkout could not be opened. Nothing was charged. (${result.message})`
        : "Checkout could not be opened. Nothing was charged.",
    );
  };

  if (sells === false) return null;

  return (
    <section
      // The app's purchase link lands here by fragment — see PRO_PURCHASE_URL
      // in lib/commerce.ts. A player who tapped GET PRO on a phone arrives at
      // the plans, not at the top of a marketing page they then have to scroll.
      id="pro"
      aria-label="Pricing"
      className="scroll-mt-6 border-y border-[var(--hairline)] bg-[var(--n-2)]"
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
              onClick={() => entering || goEnter(() => enter())}
              disabled={entering}
              className="nv-gc mt-6 w-full rounded-[var(--radius-card)] px-5 py-3 text-sm font-extrabold tracking-[0.04em] disabled:opacity-60"
            >
              {entering ? "OPENING…" : "PLAY FREE"}
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
                className="nv-gc w-full rounded-[var(--radius-card)] nv-t-action px-4 py-3 text-sm font-extrabold tracking-[0.04em] disabled:opacity-60"
              >
                {busy === PRO_MONTHLY.id ? "OPENING…" : "MONTHLY"}
              </button>
              <button
                type="button"
                onClick={() => void choosePro(PRO_YEARLY)}
                disabled={busy !== null}
                className="nv-gc w-full rounded-[var(--radius-card)] nv-t-action px-4 py-3 text-sm font-extrabold tracking-[0.04em] disabled:opacity-60"
              >
                {busy === PRO_YEARLY.id ? "OPENING…" : "YEARLY"}
              </button>
            </div>

            {/* What a subscription owes the person about to start one, said
                beside the button rather than on a page they have to find:
                length, price per period, that it renews by itself, and where
                it is stopped. */}
            <p className="mt-2.5 text-2xs leading-relaxed text-[var(--text-tertiary)]">
              Billed by Stripe. Both plans renew automatically —{" "}
              {formatPrice(PRO_MONTHLY.priceCents)} each month or{" "}
              {formatPrice(PRO_YEARLY.priceCents)} each year — until you cancel,
              which you can do at any time from Settings.{" "}
              <a className="underline underline-offset-4" href="/terms">
                Terms
              </a>{" "}
              ·{" "}
              <a className="underline underline-offset-4" href="/privacy">
                Privacy
              </a>
            </p>
            {error ? (
              <p
                role="alert"
                className="mt-2 text-xs leading-relaxed text-[var(--color-alert)]"
              >
                {error}
              </p>
            ) : null}
          </div>

          {/* Chapters — the teacher's column, with real checkout on it. Every
              seat is Pro for the year; the buyer lands on /chapter, hands the
              seats out by email or by list, and no student is asked for a
              card. */}
          <div className="flex flex-col rounded-[var(--radius-card)] bg-[var(--n-3)] p-6 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
            <p className="text-sm font-extrabold tracking-[0.08em]">CHAPTERS</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              For classrooms and clubs — every seat gets Pro, handed out by
              email from a console. No student is asked for a card.
            </p>
            <div className="mt-5 flex-1 space-y-3">
              {CHAPTER_LICENCES.map((licence) => (
                <div key={licence.id} className="border-t border-[var(--hairline)] pt-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-bold">{licence.seats} seats</p>
                    <p className="tnum text-right text-sm">
                      <span className="font-extrabold">
                        {formatPrice(licence.priceCents)}
                      </span>
                      <span className="text-2xs text-[var(--text-tertiary)]">
                        {" "}
                        / yr · {formatPrice(perSeatCents(licence))} a seat
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void chooseChapter(licence.id)}
                    disabled={busy !== null}
                    className="nv-gc mt-2.5 w-full rounded-[var(--radius-card)] nv-t-action px-4 py-2.5 text-sm font-extrabold tracking-[0.04em] disabled:opacity-60"
                  >
                    {busy === licence.id ? "OPENING…" : `START ${licence.seats} SEATS`}
                  </button>
                </div>
              ))}

              {/* The buyer-sized licence: type a seat count, read the exact
                  yearly price it computes to, start checkout on it. The same
                  formula prices it on the server, so this number IS the
                  charge. */}
              {(() => {
                const parsed = /^\d+$/.test(customSeatsText.trim())
                  ? Number(customSeatsText.trim())
                  : NaN;
                const seats = isCustomSeatCount(parsed) ? parsed : null;
                const price = seats !== null ? customChapterPriceCents(seats) : null;
                return (
                  <div className="border-t border-[var(--hairline)] pt-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-bold">Custom size</p>
                      <p className="tnum text-right text-sm">
                        {seats !== null && price !== null ? (
                          <>
                            <span className="font-extrabold">{formatPrice(price)}</span>
                            <span className="text-2xs text-[var(--text-tertiary)]">
                              {" "}
                              / yr · {formatPrice(Math.round(price / seats))} a seat
                            </span>
                          </>
                        ) : (
                          <span className="text-2xs text-[var(--text-tertiary)]">
                            {CHAPTER_CUSTOM_MIN_SEATS}–{CHAPTER_CUSTOM_MAX_SEATS} seats
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="mt-2.5 grid grid-cols-[6rem_1fr] gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={CHAPTER_CUSTOM_MIN_SEATS}
                        max={CHAPTER_CUSTOM_MAX_SEATS}
                        step={1}
                        value={customSeatsText}
                        onChange={(e) => setCustomSeatsText(e.target.value)}
                        placeholder="Seats"
                        aria-label={`Custom seat count, ${CHAPTER_CUSTOM_MIN_SEATS} to ${CHAPTER_CUSTOM_MAX_SEATS}`}
                        className="tnum w-full rounded-[var(--radius-card)] border border-[var(--hairline)] bg-transparent px-4 py-2.5 text-sm font-bold placeholder:text-[var(--n-6)] focus:border-[var(--n-11)] focus-visible:outline-none!"
                      />
                      <button
                        type="button"
                        onClick={() => seats !== null && void chooseChapter("chapter_custom", seats)}
                        disabled={busy !== null || seats === null}
                        className="nv-gc w-full rounded-[var(--radius-card)] nv-t-action px-4 py-2.5 text-sm font-extrabold tracking-[0.04em] disabled:opacity-60"
                      >
                        {busy === "chapter_custom"
                          ? "OPENING…"
                          : seats !== null
                            ? `START ${seats} SEATS`
                            : "START CUSTOM"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>

            <p className="mt-4 text-2xs leading-relaxed text-[var(--text-tertiary)]">
              Billed yearly by Stripe until cancelled. The buyer gets the seat
              console at{" "}
              <a className="underline underline-offset-4" href="/chapter">
                novuspitch.com/chapter
              </a>{" "}
              — invite by email, or register a whole class from a list.
            </p>
            {chapterError ? (
              <p
                role="alert"
                className="mt-2 text-xs leading-relaxed text-[var(--color-alert)]"
              >
                {chapterError}
              </p>
            ) : null}
            <a
              href="/chapter"
              className="mt-3 text-2xs font-bold tracking-[0.08em] text-[var(--text-tertiary)] underline underline-offset-4"
            >
              ALREADY RUN ONE? OPEN YOUR CHAPTER
            </a>
          </div>
        </div>

        {/* One-time buys — a shelf, not a column, and since the buttons landed
            an actual shop: a run slot or one industry, bought once, no
            subscription anywhere near them. */}
        <OneTimeShelf
          className="mt-8 max-w-[38rem]"
          onNeedsAccount={() =>
            document
              .getElementById(ACCOUNT_ANCHOR)
              ?.scrollIntoView({ block: "center", behavior: "smooth" })
          }
        />

        <p className="mt-6 max-w-[34rem] text-xs leading-relaxed text-[var(--text-secondary)]">
          <span className="font-bold text-[var(--text-primary)]">
            Pro never buys a score, a survival, a revive, or a place on the
            board.
          </span>{" "}
          Those are earned or they are nothing.
        </p>
      </div>
    </section>
  );
}

/** Photos ship from files named by each person — no guessed mappings. */
const TEAM = [
  {
    name: "Yuvan",
    role: "Marketing & media",
    photo: "/landing/team/yuvan.webp",
  },
  {
    name: "Dhruv",
    role: "Coding, app building & operations",
    photo: "/landing/team/dhruv.webp",
  },
  {
    name: "Zach",
    role: "Coding & app building",
    photo: "/landing/team/zach.webp",
  },
  { name: "Ana", role: "Customer research", photo: "/landing/team/ana.webp" },
  { name: "Monica", role: "Outreach", photo: "/landing/team/monica.webp" },
] as const;
