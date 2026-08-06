import { registerPlugin } from "@capacitor/core";
import type { OutsideSnapshot } from "@/lib/outside/snapshot";

/**
 * The typed half of everything the app draws outside itself.
 *
 * The implementation lives in ios/App/App/Outside/ and ios/App/NovusWidgets/.
 * Nothing in this file draws anything: it hands over one snapshot and native
 * decides what that means for a home screen widget, a lock screen accessory,
 * a StandBy panel and up to two Live Activities.
 *
 * ── One method, declarative, idempotent ────────────────────────────────────
 *
 * `publish` is the same contract `setChrome` has, and for the same reason. The
 * web layer pushes the WHOLE of what it wants shown whenever any of it
 * changes, and native works out the difference — start an activity, update
 * one, end one, reload a timeline, or do nothing at all. A start/update/end
 * protocol across a bridge is a second source of truth about what is on the
 * lock screen, and the two of them disagree the first time a publish is
 * dropped, replayed or reordered.
 *
 * Android and the web get `available: false` and nothing happens. There is no
 * state in which a failed publish costs the player anything: a stale widget is
 * a widget showing the last true thing it was told.
 */

export interface OutsideCapabilities {
  /** False on Android, on the web, and if the plugin failed to load. */
  available: boolean;
  /** WidgetKit is present — iOS 17 and later, which is the extension's floor. */
  widgets: boolean;
  /** ActivityKit is present AND the player has not switched Live Activities off in Settings. */
  liveActivities: boolean;
  /** Major OS version, or 0 when unknown. */
  osVersion: number;
}

/** What a publish actually did, so the app can say so out loud in a log line. */
export interface OutsideResult {
  /** False when the snapshot was refused — a version native does not know. */
  accepted: boolean;
  /** The shared container was written and the widget timelines reloaded. */
  widgetsReloaded: boolean;
  /** The fiscal-year activity is on the lock screen after this call. */
  fiscalYearLive: boolean;
  /** The RobinGhood activity is on the lock screen after this call. */
  marketLive: boolean;
}

export interface NovusOutsidePlugin {
  capabilities(): Promise<OutsideCapabilities>;
  /**
   * The whole of what the phone should show. Safe to call as often as the run
   * changes; native coalesces and native decides.
   *
   * The snapshot rides as a JSON string rather than as a plain object on
   * purpose. Capacitor's bridge flattens a JS object into a `JSObject` of
   * `Any`, and every number in it arrives as an `NSNumber` whose Swift type
   * depends on how it was written — a cash figure that happens to be whole
   * decodes as `Int`, the same figure a month later decodes as `Double`, and
   * a `Codable` struct refuses the second one. A string has one shape, and
   * `JSONDecoder` is the only thing that reads it.
   */
  publish(options: { snapshot: string }): Promise<OutsideResult>;
  /**
   * Take everything down now — the player turned Live Activities off, or
   * buried the company. Resolves either way: "there was nothing to end" is a
   * correct outcome, not an error.
   */
  endActivities(): Promise<void>;
}

export const NovusOutside = registerPlugin<NovusOutsidePlugin>("NovusOutside");

export const NO_OUTSIDE: OutsideCapabilities = {
  available: false,
  widgets: false,
  liveActivities: false,
  osVersion: 0,
};

/** The wire form. One place, so both sides can be pointed at the same line. */
export const encodeSnapshot = (snapshot: OutsideSnapshot): { snapshot: string } => ({
  snapshot: JSON.stringify(snapshot),
});
