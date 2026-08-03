"use client";

import { motion } from "framer-motion";

/**
 * Shared onboarding shell. The prototype keeps the splash and mic moments on
 * full brand navy and only lets the surfaces go light once you're inside the
 * company — so these screens stay dark on purpose, whatever the theme.
 * One idea per screen, one call to action, no progress chrome.
 */
export function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.section
      /*
       * max-w-md was the only width this shell knew, which made onboarding on a
       * desktop look like a phone screen taped to a monitor. The column now
       * breathes with the viewport — still one idea per screen, just set like a
       * page instead of a strip — and the stage ground runs full-bleed behind it
       * so the margins are scenery rather than dead space.
       */
      className="nv-stage flex min-h-dvh w-full flex-col text-[var(--text-primary)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] lg:max-w-xl lg:pt-[max(3.5rem,env(safe-area-inset-top))]">
        {children}
      </div>
    </motion.section>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="nv-gc h-14 w-full rounded-[var(--radius-pill)] nv-t-action text-[1.0625rem] font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:cursor-not-allowed disabled:opacity-35"
    >
      {children}
    </button>
  );
}
