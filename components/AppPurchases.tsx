"use client";

import { useState } from "react";
import { useNativeGlassClose } from "@/components/native/useNativeOverlay";
import { useBackHandler } from "@/lib/native/back";
import { APP_PURCHASE_NOTE, EXISTING_SUBSCRIPTION_NOTE } from "@/lib/native/purchases";
import { ownedLine, standingLine, usePlan } from "@/lib/plan";
import { restorePurchases } from "@/lib/cloud/billing";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/app-info";

export function AppPurchasesDetails() {
  const plan = usePlan();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const owned = plan ? ownedLine(plan.entitlements) : null;
  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await restorePurchases();
      setMessage(result.ok ? "Your account access is up to date."
        : result.reason === "signed-out" ? "Sign in to your existing Novus account, then refresh account access."
        : "Could not refresh account access. Your saved account information has not changed. Try again when connected.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 text-sm leading-relaxed text-[var(--text-secondary)]">
      {plan ? <div>
        <p className="font-bold text-[var(--text)]">{plan.standing.badge}</p>
        <p>{standingLine(plan.entitlements)}</p>
        {owned && <p>{owned}</p>}
      </div> : <p role="status">Loading account access…</p>}
      <p>{APP_PURCHASE_NOTE}</p>
      {plan?.standing.pro && <p>Your existing Pro benefits and saved companies are available in this app.</p>}
      {plan?.entitlements.pro && <p>{EXISTING_SUBSCRIPTION_NOTE}</p>}
      <button type="button" disabled={busy} onClick={() => void refresh()}
        className="nv-gc min-h-11 w-full rounded-[var(--radius-card)] px-4 py-2 text-xs font-bold disabled:opacity-60">
        {busy ? "REFRESHING…" : "REFRESH ACCOUNT ACCESS"}
      </button>
      {message && <p role="status">{message}</p>}
      <a className="inline-flex min-h-11 items-center underline underline-offset-4"
        href={supportMailto("Novus account access")}>Contact support · {SUPPORT_EMAIL}</a>
      <nav className="flex gap-5 text-xs underline"><a href="/terms">TERMS OF USE</a><a href="/privacy">PRIVACY</a></nav>
    </div>
  );
}

export function AppPurchasesSheet({ onClose }: { onClose: () => void }) {
  useNativeGlassClose("Close account access", onClose);
  useBackHandler(true, onClose);
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6">
      <button aria-label="Close account access" onClick={onClose} className="absolute inset-0 bg-[var(--scrim)]" />
      <section role="dialog" aria-modal="true" aria-labelledby="account-access-title"
        className="relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] p-6 pb-[max(1.5rem,var(--nv-safe-bottom))] sm:rounded-[var(--radius-sheet)]">
        <h2 id="account-access-title" className="mb-3 text-xl font-extrabold">Account access</h2>
        <AppPurchasesDetails />
        <button onClick={onClose} className="nv-gc mt-5 min-h-12 w-full rounded-[var(--radius-card)] nv-t-action font-bold">CONTINUE PLAYING</button>
      </section>
    </div>
  );
}
