"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LandingShark } from "@/components/landing/LandingShark";
import { useStill } from "@/components/ui/Motion";

/**
 * The gate: one game, two ways in.
 *
 * The champion stands centre stage and the two doors arrive from the sides
 * they sit on. The shark already leans toward the pointer (LandingSharkCanvas
 * tracks it window-wide), so hovering a door makes the mascot look at the
 * choice with you — a behaviour inherited, not built, which is the best kind.
 *
 * Choosing is a navigation with a breath in it: the stage eases toward the
 * camera for 240 ms and the route changes under the fade. The doors stay real
 * anchors the whole time — a crawler, a middle-click and a no-JS visitor all
 * get an ordinary link; the transition is a courtesy layered on top, and
 * reduced motion cuts it to the navigation it decorates.
 */

const DOORS = [
  {
    href: "/product/you",
    kicker: "FOR YOU",
    title: "Play it",
    body: "Found a company. Keep it alive, month by month. Defend it out loud, on camera.",
    meta: "Free to play · pro optional",
    enter: "pv-door-l",
  },
  {
    href: "/product/institutions",
    kicker: "FOR INSTITUTIONS",
    title: "Run it with a group",
    body: "Classrooms, clubs, summer programs and competitions — a seat for every student, a board for the season.",
    meta: "Chapters · every seat is Pro",
    enter: "pv-door-r",
  },
] as const;

export function Gate() {
  const router = useRouter();
  const still = useStill();
  const [leaving, setLeaving] = useState(false);

  const choose = (href: string) => {
    if (leaving) return;
    if (still) {
      router.push(href);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => router.push(href), 240);
  };

  return (
    <main
      data-live-3d
      data-leaving={leaving || undefined}
      className="pv-dark pv-gate nv-stage flex min-h-svh flex-col overflow-hidden"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 lg:px-10">
        <div className="flex items-baseline justify-between pt-[max(1.5rem,var(--nv-safe-top))]">
          <Link
            href="/"
            className="text-sm font-extrabold tracking-[0.24em] text-[var(--text-primary)]"
          >
            NOVUS
          </Link>
          <p className="hidden text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)] sm:block">
            RUN A COMPANY · PITCH IT OUT LOUD
          </p>
        </div>

        {/* The champion. The stage sweep behind it is `.nv-stage`, re-pointed
            navy by `.pv-dark` — the same three-gradient budget, no new entry. */}
        <div className="nv-rise nv-rise-stage relative mx-auto mt-2 h-[30svh] min-h-[200px] w-full max-w-[20rem] sm:h-[34svh]">
          <div
            aria-hidden="true"
            className="absolute bottom-[3%] left-1/2 h-[4.5%] w-[46%] -translate-x-1/2 rounded-[50%] bg-black/35 blur-xl"
          />
          <LandingShark className="h-full w-full" />
        </div>

        <div className="pb-4 text-center">
          <h1
            className="font-display nv-rise mx-auto max-w-[14em] text-[2.375rem] font-normal leading-[1.04] tracking-[-0.015em] sm:text-[3rem] lg:text-[3.375rem]"
            style={{ "--nv-rise-delay": "80ms" } as React.CSSProperties}
          >
            One game. Two ways in.
          </h1>
          <p
            className="nv-rise mx-auto mt-3 max-w-[30rem] text-[0.9375rem] leading-relaxed text-[var(--text-secondary)]"
            style={{ "--nv-rise-delay": "160ms" } as React.CSSProperties}
          >
            A life sim for a company: you run it, and once a year you defend it
            out loud to investors who have read your numbers. Choose your door.
          </p>
        </div>

        <div className="mx-auto grid w-full max-w-3xl gap-4 pb-6 sm:grid-cols-2">
          {DOORS.map((door, i) => (
            <Link
              key={door.href}
              href={door.href}
              onClick={(e) => {
                e.preventDefault();
                choose(door.href);
              }}
              className={`${door.enter} pv-door group flex flex-col rounded-[var(--radius-card)] bg-[var(--surface)] p-5 text-left shadow-[var(--e2)] ring-1 ring-[var(--hairline)]`}
              style={{ "--pv-door-delay": `${240 + i * 90}ms` } as React.CSSProperties}
            >
              <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
                {door.kicker}
              </p>
              <p className="mt-1.5 text-[1.25rem] font-extrabold leading-tight tracking-[-0.01em]">
                {door.title}
              </p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                {door.body}
              </p>
              <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] pt-3 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
                {door.meta.toUpperCase()}
                <span
                  aria-hidden="true"
                  className="text-sm leading-none text-[var(--text-secondary)] transition-transform duration-200 group-hover:translate-x-1"
                >
                  →
                </span>
              </p>
            </Link>
          ))}
        </div>

        <p className="pb-[max(1.5rem,var(--nv-safe-bottom))] text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
          Score, survival and the leaderboard are never for sale — on either
          side of this page.
        </p>
      </div>
    </main>
  );
}
