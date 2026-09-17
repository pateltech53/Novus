"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { signOut } from "@/lib/cloud/auth";
import { whenRestored } from "@/lib/cloud/sync";
import { entryRoute } from "@/lib/entry";
import { useNativeOverlay, useNativeOverlayOwned } from "@/components/native/useNativeOverlay";
import { readHomeAccess, type HomeAccess } from "@/lib/home";
import { appPath } from "@/lib/native/href";
import { useResolvedTheme } from "@/lib/native/theme";

/**
 * A teacher or operator opens a workspace before opening a company. Ordinary
 * members retain their existing game entry. Roles come from a fresh, uncached
 * own-session read, including after returning from another app or a console.
 * UIKit owns the two actions on iOS; solid DOM controls remain available when
 * the native bridge is absent. Neither path adds a store purchase surface.
 */
export default function HomePage() {
  const [access, setAccess] = useState<HomeAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const native = useNativeOverlayOwned();
  const theme = useResolvedTheme();
  const hasConsole = !!access?.signedIn && (access.admin || !!access.chapter);
  const consolePath = access?.admin ? "/admin" : "/chapter";
  const navigate = useCallback((path: string) => window.location.assign(appPath(path)), []);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setReload((n) => n + 1); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) refresh(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", restore);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", restore);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const timer = window.setTimeout(() => controller.abort(), 10000);
    setAccess(null);
    setError(null);
    void (async () => {
      try {
        const next = await readHomeAccess(controller.signal);
        if (!alive) return;
        if (next.configured && !next.signedIn) {
          window.location.replace(`${appPath("/")}#account`);
          return;
        }
        if (!next.admin && !next.chapter) {
          await whenRestored();
          if (alive) window.location.replace(appPath(entryRoute()));
          return;
        }
        setAccess(next);
      } catch {
        if (alive) setError("Could not load your workspaces. Check your connection and try again.");
      } finally { window.clearTimeout(timer); }
    })();
    return () => { alive = false; controller.abort(); window.clearTimeout(timer); };
  }, [reload]);

  const openIsland = async () => {
    if (leaving) return;
    setLeaving(true);
    try { await whenRestored(); navigate(entryRoute()); }
    catch { setLeaving(false); setError("Could not open your islands. Try again."); }
  };
  const leaveAccount = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await signOut();
      navigate("/welcome");
    } catch { setLeaving(false); setError("Could not sign out. Try again."); }
  };

  useNativeOverlay(useMemo(() => ({
    mode: "shown" as const,
    theme,
    title: "Novus",
    trailing: hasConsole ? [{ id: "signout", symbol: "rectangle.portrait.and.arrow.right", label: "Sign out", style: "plain" as const, enabled: !leaving }] : [],
    actions: hasConsole ? [
      { id: "console", title: "CONSOLE", label: access?.admin ? "Open admin console" : "Open enterprise console", style: "prominent" as const, enabled: !leaving },
      { id: "island", title: "ISLAND", label: "Open your islands", style: "plain" as const, enabled: !leaving },
    ] : [],
  }), [theme, hasConsole, access?.admin, leaving]), { onAction: (id) => {
    if (id === "console") navigate(consolePath);
    else if (id === "island") void openIsland();
    else if (id === "signout") void leaveAccount();
  } });

  return <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-6 pt-[max(3rem,var(--nv-safe-top),calc(var(--nv-overlay-top)+1.5rem))] pb-[max(2rem,calc(var(--nv-overlay-bottom)+1.5rem))]">
    {!native && hasConsole && <button type="button" disabled={leaving} onClick={() => void leaveAccount()} className="min-h-11 self-end text-xs font-bold text-[var(--text-secondary)] disabled:opacity-35">SIGN OUT</button>}
    <div className="flex flex-1 flex-col justify-center py-8">
      <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">YOUR WORKSPACE</p>
      <h1 className="mt-3 break-words text-[1.75rem] font-extrabold leading-tight">{access?.displayName ? `Welcome back, ${access.displayName}.` : "Welcome to Novus."}</h1>
      {hasConsole ? <>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">Manage your workspace or step into your islands.</p>
        <div className="mt-8 divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          <section className="py-5">
            <h2 className="text-sm font-extrabold tracking-[0.08em]">CONSOLE</h2>
            <p className="mt-2 break-words text-sm leading-relaxed text-[var(--text-secondary)]">{access?.admin ? "Manage accounts, enterprises and leaderboard moderation." : `Manage ${access?.chapter?.name || "your enterprise"}, invite members and update its details.`}</p>
            {access?.chapter?.status === "lapsed" && !access.admin && <p className="mt-2 text-xs text-[var(--text-secondary)]">Your enterprise licence is inactive. Its console is still available.</p>}
          </section>
          <section className="py-5">
            <h2 className="text-sm font-extrabold tracking-[0.08em]">ISLAND</h2>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">Continue your companies or start your first island.</p>
          </section>
        </div>
        {access?.admin && access.chapter && <a href={appPath("/chapter")} className="mt-4 inline-flex min-h-11 items-center text-xs font-bold underline underline-offset-4">MY ENTERPRISE</a>}
        {!native && <div className="mt-6 grid grid-cols-2 gap-3">
          <a href={appPath(consolePath)} className="nv-gc flex min-h-14 items-center justify-center rounded-[var(--radius-card)] nv-t-action px-4 text-sm font-extrabold">CONSOLE</a>
          <button type="button" disabled={leaving} onClick={() => void openIsland()} className="nv-gc min-h-14 rounded-[var(--radius-card)] px-4 text-sm font-extrabold disabled:opacity-35">ISLAND</button>
        </div>}
      </> : !error && <p role="status" className="mt-4 text-sm text-[var(--text-secondary)]">Loading your workspaces…</p>}
      {error && <div className="mt-5">
        <p role="alert" className="text-sm leading-relaxed text-[var(--alert)]">{error}</p>
        {!hasConsole && <button type="button" onClick={() => setReload((n) => n + 1)} className="nv-gc mt-4 min-h-12 rounded-[var(--radius-card)] px-5 text-sm font-bold">TRY AGAIN</button>}
      </div>}
    </div>
  </main>;
}
