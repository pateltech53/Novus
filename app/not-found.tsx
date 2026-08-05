import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * The 404, on brand.
 *
 * Without this file Next.js serves its own unstyled default — a bare
 * "404 | This page could not be found" in system type on a white ground,
 * which is the one page of the product that would look like nobody made it.
 * A mistyped link should land somewhere that still sounds like the game and
 * offers the two doors that matter: the front page and the desk.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-[max(3rem,var(--nv-safe-top))]">
      <p className="text-2xs font-extrabold tracking-[0.24em] text-[var(--text-tertiary)]">
        NOVUS · 404
      </p>

      <h1 className="mt-4 text-[2rem] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[2.75rem]">
        This page filed for Chapter&nbsp;7.
      </h1>
      <p className="mt-4 max-w-[34rem] text-base leading-relaxed text-[var(--text-secondary)]">
        Whatever was meant to be here is not — the address may be mistyped, or
        the page has been wound up. Your company, if you have one, is fine.
      </p>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/play"
          className="nv-gc flex h-12 items-center justify-center rounded-[var(--radius-pill)] px-8 nv-t-action text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)]"
        >
          BACK TO THE DESK
        </Link>
        <Link
          href="/"
          className="nv-gc flex h-12 items-center justify-center rounded-[var(--radius-pill)] px-8 text-sm font-bold text-[var(--text-primary)]"
        >
          Front page
        </Link>
      </div>
    </main>
  );
}
