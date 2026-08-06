import Link from "next/link";

import { SUPPORT_EMAIL } from "@/lib/app-info";
import type { LegalDocument } from "@/lib/legal/documents";

/**
 * A legal document as a public page.
 *
 * Two routes render this — /privacy and /terms — because App Store Connect
 * asks for both as URLs and a reviewer follows them. It is a server component
 * with no client JavaScript: these pages must render for someone with a slow
 * connection, a locked-down school network or a reader mode, and there is
 * nothing on them that needs a runtime.
 *
 * The measure is `max-w-2xl` rather than the app's `max-w-lg`: this is prose,
 * read on a laptop as often as on a phone, and 45–75 characters a line is what
 * long text wants. The same document inside the app is a sheet — see
 * components/LegalSheet.tsx.
 */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-[max(2.5rem,var(--nv-safe-top))] pb-[max(3rem,var(--nv-safe-bottom))]">
      <Link
        href="/"
        className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
      >
        ‹ NOVUS
      </Link>
      <h1 className="mt-3 text-[2rem] font-extrabold leading-tight tracking-[-0.02em]">
        {doc.title}
      </h1>
      <p className="tnum mt-1 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        LAST UPDATED {doc.lastUpdated.toUpperCase()}
      </p>

      {doc.sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-base font-extrabold tracking-[-0.01em]">
            {s.heading}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            {s.body}
          </p>
        </section>
      ))}

      {/* The sibling document, because a reviewer landing on one of these two
          looks for the other, and because App Store Connect wants both. */}
      <nav className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--hairline)] pt-5 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {doc.id === "privacy" ? (
          <Link className="underline underline-offset-4" href="/terms">
            TERMS OF USE
          </Link>
        ) : (
          <Link className="underline underline-offset-4" href="/privacy">
            PRIVACY
          </Link>
        )}
        <Link className="underline underline-offset-4" href="/download">
          GET THE APP
        </Link>
      </nav>

      <p className="mt-5 text-2xs leading-relaxed text-[var(--text-tertiary)]">
        Novus · built at LaunchX Flagship, San Diego 2026 ·{" "}
        <a
          className="underline underline-offset-4"
          href={`mailto:${SUPPORT_EMAIL}`}
        >
          {SUPPORT_EMAIL}
        </a>
      </p>
    </main>
  );
}
