"use client";

import { motion } from "framer-motion";

import { useBackHandler } from "@/lib/native/back";
import type { LegalDocument } from "@/lib/legal/documents";
import { useNativeGlassClose } from "@/components/native/useNativeOverlay";

/**
 * A legal document, read inside the app.
 *
 * The privacy policy and the terms have to be reachable from within the app,
 * not only from the store listing (Guidelines 5.1.1 and 3.1.2). This is that
 * reachability, as a sheet rather than a route: the shipped iOS app draws its
 * tab bar and advance button as UIKit views above the webview, so navigating
 * the webview to /privacy would leave a game's chrome sitting on top of a
 * policy. A sheet opened from Settings inherits the chrome Settings already
 * withdrew.
 *
 * Presentation follows the rest of the app: a bottom sheet on a phone, a
 * centred dialog once there is room for one. Back — Android's button, the iOS
 * edge swipe — closes it and only it, because it registers its own handler
 * above the one Settings pushed.
 */
export function LegalSheet({
  doc,
  onClose,
}: {
  doc: LegalDocument;
  onClose: () => void;
}) {
  // `chevron.backward`: this opens FROM another screen and dismissing
  // returns you to it, which is a different gesture from closing.
  const native = useNativeGlassClose("Back", onClose, "chevron.backward");
  useBackHandler(true, onClose);

  return (
    /* Above everything, including the upgrade screen at z-98 — this sheet is
       opened FROM the surfaces that sit highest, and a policy that renders
       underneath the thing that linked to it is not a functional link. */
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)]"
      />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={doc.title}
        className="relative flex max-h-[min(88dvh,calc(100dvh-var(--nv-overlay-top)-0.75rem))] w-full max-w-2xl flex-col overflow-hidden rounded-t-[1.75rem] bg-[var(--sheet)] shadow-[var(--e3)] sm:max-h-[82dvh] sm:rounded-[var(--radius-card)]"
        initial={{ y: "6%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* The header does not scroll away: on a document this long, the way
            out has to stay where the thumb last saw it. */}
        <header className="flex items-start justify-between gap-4 border-b border-[var(--hairline)] px-5 pt-5 pb-3.5">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold tracking-[-0.01em]">
              {doc.title}
            </h2>
            <p className="tnum mt-0.5 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
              LAST UPDATED {doc.lastUpdated.toUpperCase()}
            </p>
          </div>
          {native ? null : (
            <button
              type="button"
              onClick={onClose}
              className="nv-gc shrink-0 rounded-[var(--radius-pill)] px-3.5 py-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
            >
              CLOSE
            </button>
          )}
        </header>

        <div className="overflow-y-auto overscroll-contain px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {doc.sections.map((s) => (
            <section key={s.heading} className="mb-6 last:mb-0">
              <h3 className="text-sm font-extrabold tracking-[-0.01em]">
                {s.heading}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                {s.body}
              </p>
            </section>
          ))}
        </div>
      </motion.section>
    </div>
  );
}
