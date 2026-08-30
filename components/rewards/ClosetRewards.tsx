"use client";

import { useEffect, useState } from "react";

import MySkins from "./MySkins";

/**
 * The briefcase loop, seen from inside the Closet.
 *
 * ── Why it lives here and not only on /rewards ──────────────────────────────
 *
 * A collection screen a player has to remember to visit is a screen they
 * visit twice. The Closet is where they already go to look at themselves, and
 * a wardrobe that shows five owned fits while saying nothing about the
 * ninety-six it does not have is telling half the truth. So the silhouettes
 * come to the Closet, and the sealed cases announce themselves on the way
 * past.
 *
 * ── Why it can render nothing ───────────────────────────────────────────────
 *
 * Every /api/rewards route 404s for an account without `rewards_beta`, and
 * this component treats that as "there is nothing here" rather than an error.
 * On an off-beta account the Closet is byte-for-byte the screen it was before
 * this shipped — no empty heading, no disabled row, no hint that a feature is
 * being withheld. That is the point of a per-account flag.
 */
export default function ClosetRewards({ base = "novus" }: { base?: "novus" | "nova" }) {
  const [sealed, setSealed] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/api/rewards/vault", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!live || !data?.cases) return;
        setSealed(data.cases.length as number);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  return (
    <>
      {sealed !== null && (
        <>
          <h2 className="mt-7 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
            BRIEFCASES
          </h2>
          <a
            href="/rewards"
            data-sfx="tab"
            className="nv-gc mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-card)] p-4"
          >
            <span className="min-w-0">
              <span className="block text-sm font-bold">
                {sealed > 0
                  ? `${sealed} sealed ${sealed === 1 ? "case" : "cases"} waiting`
                  : "Today's missions"}
              </span>
              <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-tertiary)]">
                {sealed > 0
                  ? "Open them for a skin, tokens or a trial."
                  : "Five missions a day. Finish one and a case is yours."}
              </span>
            </span>
            <span
              className="shrink-0 text-2xs font-bold tracking-[0.1em]"
              style={{ color: sealed > 0 ? "#FF6B00" : "var(--text-tertiary)" }}
            >
              {sealed > 0 ? "OPEN →" : "VIEW →"}
            </span>
          </a>
        </>
      )}

      {/*
       * Negative margin so the grid reaches the same gutters it has on
       * /rewards. MySkins draws its own `px-4`, and nesting that inside the
       * Closet's `px-5` would leave the cells in a column narrower than every
       * other band on the screen.
       */}
      <div className="-mx-5 mt-2">
        <MySkins base={base} embedded />
      </div>
    </>
  );
}
