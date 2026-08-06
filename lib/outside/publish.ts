"use client";

import { useSyncExternalStore } from "react";
import { App as CapApp } from "@capacitor/app";
import { isNative } from "@/lib/native/platform";
import {
  encodeSnapshot,
  NovusOutside,
  NO_OUTSIDE,
  type OutsideCapabilities,
} from "@/lib/outside/plugin";
import { sameSnapshot, type OutsideSnapshot } from "@/lib/outside/snapshot";

/**
 * Getting the snapshot out of the app and onto the phone.
 *
 * Three rules, and the first two are the same ones the native chrome runs on:
 *
 * · **Ask once.** `probeOutside()` runs at most one capability check per
 *   launch; every later caller awaits the same promise.
 * · **Degrade to nothing.** Not iOS, plugin missing, old binary, native threw
 *   — every one of them leaves the game exactly as it is. A widget that was
 *   never updated shows the last true thing it was told, which is the correct
 *   failure and the reason nothing here is allowed to raise.
 * · **Publish the same thing at most once.** A run object is rebuilt on every
 *   render; a snapshot built from it is usually identical to the one before.
 *   Writing a shared container and reloading every widget timeline for a
 *   keystroke in the company namer is a real cost paid for no pixels.
 */

// ── The player's switch ─────────────────────────────────────────────────────

const PREF_KEY = "novus:outside:live:v1";

/**
 * Whether the company may put itself on the lock screen.
 *
 * Default on. A Live Activity here only ever exists while a company is open,
 * it carries no notification, and it is swipe-dismissable — and a game about a
 * company that keeps burning money while you are not looking is exactly the
 * kind of thing the lock screen was added for. Widgets are not governed by
 * this: a widget is on the home screen because the player put it there.
 */
export function liveActivitiesEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage?.getItem(PREF_KEY) !== "off";
  } catch {
    // Private mode. Defaulting to on matches the stated default; the choice
    // just does not persist, which is the same deal every other preference
    // here gets.
    return true;
  }
}

export function setLiveActivitiesEnabled(on: boolean): void {
  try {
    window.localStorage?.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    /* the choice applies to this session and does not persist */
  }
  prefListeners.forEach((fn) => fn());
  // Turning it off has to be immediate. The next publish would do it too, and
  // the next publish is the next tap that moves time, which may be tomorrow.
  if (!on) void endOutsideActivities();
}

const prefListeners = new Set<() => void>();

/** The Settings row's own subscription, so the switch tracks the value. */
export function useLiveActivitiesEnabled(): boolean {
  return useSyncExternalStore(
    (fn) => {
      prefListeners.add(fn);
      return () => prefListeners.delete(fn);
    },
    liveActivitiesEnabled,
    () => false,
  );
}

// ── Capabilities ────────────────────────────────────────────────────────────

let caps: OutsideCapabilities = NO_OUTSIDE;
let probing: Promise<OutsideCapabilities> | null = null;
const capListeners = new Set<() => void>();

/**
 * Asks the plugin whether it is there, at most once per launch.
 *
 * The answer also goes on the root element, for the same reason
 * `lib/native/chrome.ts` writes the material there: the two ways to end up
 * with no Live Activity — an OS below the extension's floor, or the player
 * having switched them off in iOS Settings ▸ Face ID & Passcode ▸ Live
 * Activities — are indistinguishable from "it is broken" without somewhere to
 * read the answer.
 *
 *     document.documentElement.dataset.outside      // "true" — the plugin answered
 *     document.documentElement.dataset.outsideLive  // "true" — ActivityKit will take a request
 */
export function probeOutside(): Promise<OutsideCapabilities> {
  if (probing) return probing;
  if (!isNative()) {
    probing = Promise.resolve(NO_OUTSIDE);
    return probing;
  }

  probing = NovusOutside.capabilities()
    .then((answer) => {
      caps = answer;
      record(answer);
      capListeners.forEach((fn) => fn());
      return answer;
    })
    .catch(() => {
      // No plugin in this binary, or it threw. Both mean the same thing here.
      caps = NO_OUTSIDE;
      record(NO_OUTSIDE);
      return NO_OUTSIDE;
    });
  return probing;
}

function record(answer: OutsideCapabilities): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.outside = String(answer.available);
  root.dataset.outsideLive = String(answer.liveActivities);
  console.info(
    `[novus] outside ${answer.available ? "on" : "off"} · ` +
      `widgets ${answer.widgets ? "yes" : "no"} · ` +
      `live activities ${answer.liveActivities ? "yes" : "no"} · ` +
      `iOS ${answer.osVersion}`,
  );
}

/** What the Settings screen needs to know before offering a switch. */
export function useOutsideCapabilities(): OutsideCapabilities {
  return useSyncExternalStore(
    (fn) => {
      capListeners.add(fn);
      return () => capListeners.delete(fn);
    },
    () => caps,
    () => NO_OUTSIDE,
  );
}

// ── Publishing ──────────────────────────────────────────────────────────────

/**
 * Long enough that a burst of renders becomes one write, short enough that the
 * lock screen is right by the time a player has finished putting the phone
 * down. `lib/engine/save.ts` coalesces its own writes on the same reasoning.
 */
const COALESCE_MS = 400;

let queued: OutsideSnapshot | null = null;
let timer: number | null = null;
let lastSent: OutsideSnapshot | null = null;
let inFlight = false;

/**
 * Hand a snapshot to the phone. Never throws, never blocks a render.
 *
 * Coalesced and de-duplicated: the last snapshot within the window wins, and a
 * snapshot that would draw the same lock screen as the last one actually sent
 * is dropped without a bridge call at all.
 */
export function publishOutside(snapshot: OutsideSnapshot): void {
  if (!isNative()) return;
  queued = snapshot;
  if (timer !== null) return;
  timer = window.setTimeout(flush, COALESCE_MS);
}

/**
 * Send whatever is queued right now.
 *
 * Called on the way out of the app, where the coalescing window is time the
 * document may not get: a snapshot still sitting in the timer when the app is
 * suspended is a lock screen a month behind the game.
 */
export function flushOutside(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  void flush();
}

async function flush(): Promise<void> {
  timer = null;
  const snapshot = queued;
  queued = null;
  if (!snapshot) return;

  const answer = await probeOutside();
  if (!answer.available) return;
  if (sameSnapshot(lastSent, snapshot)) return;

  /*
   * One publish at a time.
   *
   * `Activity.request` and `Activity.update` are async on the native side and
   * two overlapping publishes can complete out of order — which is a lock
   * screen showing the older of two months, permanently, until something else
   * happens to move time. The queue is one deep on purpose: if a publish
   * lands while one is in flight, the newer snapshot simply waits for the next
   * window and the intermediate one is never worth sending.
   */
  if (inFlight) {
    queued = snapshot;
    if (timer === null) timer = window.setTimeout(flush, COALESCE_MS);
    return;
  }

  inFlight = true;
  try {
    const result = await NovusOutside.publish(encodeSnapshot(snapshot));
    // Only a publish native ACCEPTED counts as sent. A refused one (a wire
    // version this binary does not know) must not suppress the next attempt,
    // or an app updated ahead of its extension goes quiet for good.
    if (result?.accepted) lastSent = snapshot;
  } catch {
    /* The widget keeps showing the last true thing it was told. */
  } finally {
    inFlight = false;
  }
}

/** Take every activity down now. Used by the switch and by burying a company. */
export async function endOutsideActivities(): Promise<void> {
  if (!isNative()) return;
  const answer = await probeOutside();
  if (!answer.available) return;
  try {
    await NovusOutside.endActivities();
  } catch {
    /* Nothing to end is a correct outcome. */
  }
  // The next publish must not be dropped as a duplicate of the one that put
  // the activity up: the lock screen is empty now and the snapshot is not.
  lastSent = null;
}

// ── The app coming back ─────────────────────────────────────────────────────

let resumeHandle: { remove: () => void } | null = null;

/**
 * Re-publishes when the app returns to the foreground.
 *
 * A Live Activity carries a stale date and iOS dims it once that passes, which
 * is correct — a figure from four days ago should not read as live. Coming
 * back is the moment the app can say so, and it costs one bridge call that
 * usually de-duplicates to nothing.
 */
export function watchOutsideResume(rebuild: () => OutsideSnapshot | null): () => void {
  if (!isNative()) return () => {};
  void CapApp.addListener("appStateChange", ({ isActive }) => {
    const snapshot = rebuild();
    if (!snapshot) return;
    if (isActive) publishOutside(snapshot);
    else {
      // Going away is the last moment this document is certain to get.
      queued = snapshot;
      flushOutside();
    }
  }).then((handle) => {
    resumeHandle = handle;
  });

  return () => {
    resumeHandle?.remove();
    resumeHandle = null;
  };
}
