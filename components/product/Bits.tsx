"use client";

import Link from "next/link";

/**
 * The small shared furniture of the /product story pages: the wordmark row a
 * story opens under, and the legal row it closes over. Kept deliberately
 * tiny — each story owns its own scenes; what they share is the frame.
 */

export function Wordbar({
  other,
}: {
  /** The other door, one step away from anywhere. */
  other?: { label: string; href: string };
}) {
  return (
    <div className="flex items-baseline justify-between pt-[max(1.5rem,var(--nv-safe-top))]">
      <Link
        href="/"
        className="text-sm font-extrabold tracking-[0.24em] text-[var(--text-primary)]"
      >
        NOVUS
      </Link>
      {other ? (
        <Link
          href={other.href}
          className="text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)] underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:text-[var(--text-secondary)]"
        >
          {other.label}
        </Link>
      ) : null}
    </div>
  );
}

export function StoryFooter() {
  return (
    /* sm:flex-wrap: the four children total ~720px of natural width, and a
       forced single row between 640px and ~780px shrank the tagline and the
       legal links into misaligned multi-line fragments. */
    <div className="mt-14 flex flex-col gap-3 border-t border-[var(--hairline)] pt-5 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between">
      <p className="text-2xs font-extrabold tracking-[0.24em] text-[var(--text-tertiary)]">
        NOVUS
      </p>
      <a
        href="mailto:team@novuspitch.com"
        className="tnum text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
      >
        team@novuspitch.com
      </a>
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
  );
}
