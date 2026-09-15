"use client";

import { useEffect, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import { NovusGlass } from "@/lib/native/glass";
import { isNative } from "@/lib/native/platform";

/**
 * Notices the site under the shell has changed, and says so.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * The remote shell (capacitor.config.ts, docs/APP.md) means a web deploy IS an
 * app release — the binary loads `https://www.novuspitch.com` live, and
 * nothing about the app needs to change for a web-only fix to reach every
 * install. That is the whole point of the architecture, and it has a blind
 * spot: a session that was already open when a deploy landed is still running
 * the JS chunks it loaded at launch. Nothing tells it the ground moved, there
 * is no service worker precaching routes (offline play was given up
 * deliberately, docs/APP.md's "What the shells gave up"), and Next does not
 * warn on a stale chunk the way some frameworks do. The player finds out only
 * by force-quitting, or not at all.
 *
 * ── What this does about it ─────────────────────────────────────────────────
 *
 * Polls `GET /api/version` — a dynamic route, so it always answers for
 * whichever build is actually serving traffic — on launch, on every return to
 * the foreground, and every ten minutes the app stays open. The first answer
 * is remembered as "mine"; a later answer that disagrees means a deploy
 * happened while this session was running. When that happens AND the moment
 * is safe, a native Liquid Glass toast says so and the app reloads itself a
 * few seconds later — long enough to read four words, not long enough to
 * forget why the screen changed.
 *
 * "Safe" is deliberately conservative: no reload while a dialog — a decision
 * card, a legal sheet, an activity, the native sheet's DOM fallback, all of
 * which render `[role="dialog"]` — is open, and none while the app is
 * backgrounded (a reload the player cannot see is a blank frame waiting for
 * them the next time they look, which is worse than the wait). An update
 * noticed at an unsafe moment is not lost — `pending` stays set and the next
 * check (the next resume, the next ten-minute tick, or simply the dialog
 * closing and another check landing) tries again.
 *
 * Degrades to nothing everywhere this cannot work: not iOS, the plugin
 * missing, an old binary, a network blip on `/api/version`. The player is
 * never worse off than before this existed — worst case, a long-lived session
 * simply does not learn about a deploy until its next natural navigation,
 * which is exactly today's behaviour.
 */

const CHECK_INTERVAL_MS = 10 * 60 * 1000;
/** Long enough to read "Novus has a new version", short enough that the
 *  reload does not feel like a separate, later interruption. */
const RELOAD_DELAY_MS = 4000;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store" });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    const version = (data as { version?: unknown } | null)?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** No open dialog, and the player is actually looking at the screen. */
function safeToReload(): boolean {
  return !document.hidden && document.querySelector('[role="dialog"]') === null;
}

export function useNativeUpdateCheck(): void {
  useEffect(() => {
    if (!isNative()) return;

    let cancelled = false;
    const seenVersion = { current: null as string | null };
    const pending = { current: false };
    const notified = { current: false };

    const attemptReload = () => {
      if (!pending.current || notified.current || !safeToReload()) return;
      notified.current = true;
      NovusGlass.toast({
        title: "UPDATE",
        text: "Novus has a new version. Reloading…",
        tone: "neutral",
      }).catch(() => {
        /* No toast plugin — the reload below still happens; the player just
         * finds out from the blank frame rather than the notice. */
      });
      window.setTimeout(() => {
        if (!cancelled) window.location.reload();
      }, RELOAD_DELAY_MS);
    };

    const check = async () => {
      const version = await fetchVersion();
      if (cancelled || !version) return;
      if (seenVersion.current === null) {
        seenVersion.current = version;
        return;
      }
      if (version !== seenVersion.current) pending.current = true;
      attemptReload();
    };

    void check();
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);

    let resumeHandle: { remove: () => void } | null = null;
    void CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void check();
    }).then((handle) => {
      if (cancelled) handle.remove();
      else resumeHandle = handle;
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      resumeHandle?.remove();
    };
  }, []);
}
