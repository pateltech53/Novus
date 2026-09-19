"use client";

import { useNativeGlassClose } from "@/components/native/useNativeOverlay";
import { useBackHandler } from "@/lib/native/back";
import { IOS_EDITION_NOTE, IOS_EXISTING_SUBSCRIPTION_NOTE } from "@/lib/native/edition";
import { FREE_LIMITS } from "@/lib/monetization";
import { useEntitlements } from "@/lib/plan";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/app-info";
import type { GateId } from "@/lib/upgrade";

export function FreeEditionDetails() {
  const account = useEntitlements();
  const hasPurchases = !!account && (account.pro || !!account.chapter ||
    account.extraIslands > 0 || account.extraYearCloses > 0 || account.industryPacks.length > 0 || account.cosmeticBundles.length > 0);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
      <p>{IOS_EDITION_NOTE}</p>
      <p>{FREE_LIMITS.industries} industries, up to {FREE_LIMITS.islands} active companies,
        {" "}{FREE_LIMITS.runsPerDay} new company and {FREE_LIMITS.yearClosesPerDay} fiscal-year close per day.
        The year-end pitch and leaderboard are included.</p>
      {hasPurchases && <p>{IOS_EXISTING_SUBSCRIPTION_NOTE}</p>}
      <a className="inline-flex min-h-11 items-center underline underline-offset-4"
        href={supportMailto("Novus iOS edition")}>Contact support · {SUPPORT_EMAIL}</a>
      <nav className="flex gap-5 text-xs underline"><a href="/terms">TERMS OF USE</a><a href="/privacy">PRIVACY</a></nav>
    </div>
  );
}

const LIMIT_MESSAGES: Partial<Record<GateId, { title: string; body: string }>> = {
  run_slots: { title: "Today's company is already started", body: "You can start one company per day. Continue a saved company, or start another tomorrow." },
  year_pace: { title: "Today's books are closed", body: "You can close one fiscal year per day. Your progress is saved; the next year-close is available tomorrow." },
  islands: { title: "Two active companies", body: "This edition supports two active companies. Your existing saved companies are kept unchanged." },
};

export function FreeEditionSheet({ onClose, gate, notice }: { onClose: () => void; gate?: GateId | null; notice?: string }) {
  const native = useNativeGlassClose("Close edition details", onClose);
  useBackHandler(true, onClose);
  const message = gate ? LIMIT_MESSAGES[gate] : null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6">
      <button aria-label="Close edition details" onClick={onClose} className="absolute inset-0 bg-[var(--scrim)]" />
      <section role="dialog" aria-modal="true" aria-labelledby="edition-title"
        className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] p-6 pb-[max(1.5rem,var(--nv-safe-bottom))] sm:rounded-[var(--radius-sheet)]">
        <h2 id="edition-title" className="mb-3 text-xl font-extrabold">{message?.title ?? "Novus · Basic edition"}</h2>
        {message && <p className="mb-4 text-sm leading-relaxed">{message.body}</p>}
        {notice && <p className="mb-4 text-sm leading-relaxed">{notice}</p>}
        <FreeEditionDetails />
        <button onClick={onClose} className="nv-gc mt-5 min-h-12 w-full rounded-[var(--radius-card)] nv-t-action font-bold">
          {native ? "BACK TO THE GAME" : "CONTINUE"}
        </button>
      </section>
    </div>
  );
}
