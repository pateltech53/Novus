"use client";

import { AccountGate } from "@/components/landing/AccountGate";
import { AppPurchasesDetails } from "@/components/AppPurchases";

export function NativeLanding() {
  return <main className="mx-auto max-w-xl space-y-6 px-6 pt-[max(3rem,var(--nv-safe-top))] pb-[max(2rem,var(--nv-safe-bottom))]">
    <h1 className="text-3xl font-extrabold">Novus</h1>
    <p className="text-lg font-bold">Build a company. Pitch your year. Learn by playing.</p>
    <AppPurchasesDetails />
    <AccountGate />
  </main>;
}
