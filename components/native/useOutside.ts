"use client";

import { useEffect, useRef } from "react";
import type { RunState } from "@/lib/engine/types";
import type { IslandSummary } from "@/lib/engine/save";
import { buildSnapshot, type OutsideSnapshot } from "@/lib/outside/snapshot";
import {
  flushOutside,
  liveActivitiesEnabled,
  probeOutside,
  publishOutside,
  watchOutsideResume,
} from "@/lib/outside/publish";

/**
 * Keeps the phone's idea of the company level with the game's.
 *
 * Called once, from `GameProvider`, because that is the only place that holds
 * both the run and the archipelago — and because every screen that can change
 * either of them is already inside it. Putting it on the play screen instead
 * would leave a company founded on `/found` invisible until its first tap.
 *
 * Nothing here can fail in a way the player sees. `publishOutside` swallows
 * everything, and on Android and the web the whole hook costs one `isNative()`
 * check and does not run again.
 */
export function useOutside(run: RunState | null, slot: number, islands: IslandSummary[]) {
  /*
   * The snapshot the resume listener rebuilds from.
   *
   * It is registered once for the life of the provider and has to see the
   * CURRENT run when it fires, which may be an hour and four months later. A
   * ref rather than a dependency, because re-registering an app-state listener
   * on every tap is a real listener leak on a bridge that does not dedupe.
   */
  const latest = useRef<OutsideSnapshot | null>(null);

  useEffect(() => {
    const snapshot = buildSnapshot({
      run,
      slot,
      islands,
      liveActivities: liveActivitiesEnabled(),
    });
    latest.current = snapshot;
    publishOutside(snapshot);
  }, [run, slot, islands]);

  useEffect(() => {
    void probeOutside();
    const stop = watchOutsideResume(() => latest.current);

    /*
     * The last moment this document gets.
     *
     * Signing out, deleting an account and the door out of Settings all
     * navigate the document rather than push a route, and a snapshot still
     * sitting in the publisher's coalescing window when that happens is a lock
     * screen a month behind the board. `flushOutside` sends it now.
     */
    const leaving = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      flushOutside();
    };
    window.addEventListener("pagehide", leaving);

    return () => {
      window.removeEventListener("pagehide", leaving);
      stop();
    };
  }, []);
}
