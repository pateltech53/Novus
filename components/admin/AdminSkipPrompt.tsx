"use client";

import { useCallback, useEffect, useState } from "react";

import {
  registerAdminSkipPrompt,
  skipPurchase,
  type AdminChoice,
  type AdminSkipRequest,
} from "@/lib/cloud/admin-skip";
import { restorePurchases, type CheckoutSku } from "@/lib/cloud/billing";
import { appPath } from "@/lib/native/href";
import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import { play } from "@/lib/sound";

/**
 * The choice an operator gets where everyone else gets Stripe.
 *
 * Mounted once in the root layout and invisible to every player: it renders
 * nothing until goToCheckout finds an admin session and asks through
 * lib/cloud/admin-skip.ts. Then it offers the fork — run the REAL checkout to
 * test the money path, or skip payment and take the grant now, server-side,
 * as if the webhook had fired.
 *
 * It re-checks /api/admin/me when it opens (not the tab-cached answer), so a
 * demotion mid-session degrades to the ordinary checkout instead of trusting
 * a stale yes. And it restores entitlements BEFORE resolving "skipped", so
 * the surface that asked sees the purchase the moment the promise settles.
 */

const LABELS: Record<CheckoutSku, string> = {
  pro_monthly: "Pro — monthly",
  pro_yearly: "Pro — yearly",
  industry_pack: "Industry pack",
  extra_island: "Extra island",
  chapter_35: "Chapter — 35 seats",
  chapter_100: "Chapter — 100 seats",
  chapter_custom: "Chapter — custom size",
};

type Phase = "choose" | "working" | "done" | "error";

interface Open {
  req: AdminSkipRequest;
  resolve: (choice: AdminChoice) => void;
  phase: Phase;
  /** The admin's current testing view, for the free-view hint after a skip. */
  view: "free" | "pro" | "all";
  error: string | null;
  viewSwitched: boolean;
}

export function AdminSkipPrompt() {
  const [open, setOpen] = useState<Open | null>(null);

  useEffect(
    () =>
      registerAdminSkipPrompt(
        (req) =>
          new Promise<AdminChoice>((resolve) => {
            void fetch(apiUrl("/api/admin/me"), { credentials: API_CREDENTIALS })
              .then(async (res) => {
                if (!res.ok) {
                  // Not an admin any more. Not this component's business —
                  // the ordinary checkout takes over.
                  resolve("stripe");
                  return;
                }
                const body = (await res.json()) as { view?: Open["view"] };
                setOpen({
                  req,
                  resolve,
                  phase: "choose",
                  view: body.view ?? "all",
                  error: null,
                  viewSwitched: false,
                });
              })
              .catch(() => resolve("stripe"));
          }),
      ),
    [],
  );

  const finish = useCallback(
    (choice: AdminChoice) => {
      open?.resolve(choice);
      setOpen(null);
    },
    [open],
  );

  // Escape cancels, but only while the choice is still open — once a grant
  // has landed, the only way out is DONE, so the resolution cannot be lost.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open.phase === "choose") finish("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open) return null;

  const { req, phase, view, error } = open;
  const label =
    req.sku === "industry_pack" && req.industry
      ? `${LABELS[req.sku]} — ${req.industry}`
      : req.sku === "chapter_custom" && req.seats
        ? `Chapter — ${req.seats} seats (custom)`
        : LABELS[req.sku];
  const isChapter =
    req.sku === "chapter_35" || req.sku === "chapter_100" || req.sku === "chapter_custom";

  const doSkip = async () => {
    setOpen((o) => (o ? { ...o, phase: "working", error: null } : o));
    const result = await skipPurchase(req.sku, req.industry, req.seats);
    if (!result.ok) {
      setOpen((o) => (o ? { ...o, phase: "error", error: result.error } : o));
      return;
    }
    // Adopt the fresh entitlements NOW, so the screen behind this card has
    // the purchase by the time the promise resolves.
    await restorePurchases();
    play("success");
    setOpen((o) => (o ? { ...o, phase: "done" } : o));
  };

  const switchToProView = async () => {
    try {
      await fetch(apiUrl("/api/admin/view"), {
        method: "POST",
        credentials: API_CREDENTIALS,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ view: "pro" }),
      });
      await restorePurchases();
      setOpen((o) => (o ? { ...o, viewSwitched: true } : o));
    } catch {
      /* the hint stays; switching by hand in /admin still works */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 p-4 sm:items-center"
      onClick={() => {
        if (phase === "choose") finish("cancel");
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Admin: paid item"
        className="w-full max-w-sm rounded-[var(--radius-card)] bg-[var(--n-3)] p-5 shadow-[var(--e3)] ring-1 ring-[var(--hairline)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--color-prestige)]">
          ADMIN · PAID ITEM
        </p>
        <h2 className="mt-1.5 text-lg font-extrabold leading-tight tracking-[-0.01em]">{label}</h2>

        {phase === "choose" && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              This button normally opens Stripe. Test the real checkout, or
              skip payment and grant it to this account now — as if it had
              been paid, audit-logged, no card either way until Stripe says
              so.
            </p>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => finish("stripe")}
                className="nv-gc h-12 w-full rounded-[var(--radius-card)] nv-t-action text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)]"
              >
                TEST THE REAL CHECKOUT
              </button>
              <button
                type="button"
                onClick={() => void doSkip()}
                className="h-12 w-full rounded-[var(--radius-card)] bg-[var(--text-primary)] text-sm font-extrabold tracking-[0.04em] text-[var(--n-1)]"
              >
                SKIP PAYMENT — GRANT NOW
              </button>
              <button
                type="button"
                onClick={() => finish("cancel")}
                className="h-10 w-full rounded-[var(--radius-card)] text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]"
              >
                CANCEL
              </button>
            </div>
          </>
        )}

        {phase === "working" && (
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">Granting…</p>
        )}

        {phase === "error" && (
          <>
            <p role="alert" className="mt-2 text-sm leading-relaxed text-[var(--alert)]">
              {error}
            </p>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => void doSkip()}
                className="h-12 w-full rounded-[var(--radius-card)] bg-[var(--text-primary)] text-sm font-extrabold tracking-[0.04em] text-[var(--n-1)]"
              >
                TRY AGAIN
              </button>
              <button
                type="button"
                onClick={() => finish("cancel")}
                className="h-10 w-full rounded-[var(--radius-card)] text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]"
              >
                CANCEL
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Granted. Nothing was charged, and the skip is in the audit log.
              {isChapter && " The seat console is live at /chapter."}
            </p>
            {view === "free" && !open.viewSwitched && (
              <p className="mt-2 text-2xs leading-relaxed text-[var(--text-tertiary)]">
                You are in the FREE view, which hides even owned things by
                design — switch to PRO or ALL to see this take effect.
              </p>
            )}
            {open.viewSwitched && (
              <p className="mt-2 text-2xs leading-relaxed text-[var(--text-tertiary)]">
                View switched to PRO.
              </p>
            )}
            <div className="mt-4 grid gap-2">
              {isChapter && (
                <button
                  type="button"
                  // By filename, for the shell's router — an extensionless
                  // document navigation in the app resolves to the bundle
                  // root, not to /chapter (lib/native/href.ts).
                  onClick={() => window.location.assign(appPath("/chapter"))}
                  className="nv-gc h-12 w-full rounded-[var(--radius-card)] nv-t-action text-sm font-extrabold tracking-[0.04em] shadow-[var(--e2)]"
                >
                  OPEN THE SEAT CONSOLE
                </button>
              )}
              {view === "free" && !open.viewSwitched && (
                <button
                  type="button"
                  onClick={() => void switchToProView()}
                  className="nv-gc h-12 w-full rounded-[var(--radius-card)] text-sm font-extrabold tracking-[0.04em]"
                >
                  SWITCH TO PRO VIEW
                </button>
              )}
              <button
                type="button"
                onClick={() => finish("skipped")}
                className="h-12 w-full rounded-[var(--radius-card)] bg-[var(--text-primary)] text-sm font-extrabold tracking-[0.04em] text-[var(--n-1)]"
              >
                DONE
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
