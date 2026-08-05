import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * The typed half of the native Liquid Glass chrome.
 *
 * The implementation lives in ios/App/App/Native/. On iOS 26 every surface
 * described here is a real UIKit glass view — `UIGlassEffect`, a system
 * `UITabBar`, `UIButton.Configuration.prominentGlass()` — composited by the
 * OS over the webview. Nothing in this file draws anything; it only describes
 * what the app wants drawn and receives the exact geometry back.
 *
 * The geometry is the point. The web layer never guesses how tall the tab bar
 * is: native measures it after layout and reports it, and the play screen
 * reserves precisely that. Guessing is how a tab bar ends up sitting on top of
 * the button underneath it.
 *
 * Android and the web get `available: false` and keep the CSS chrome.
 */

/** One tab in the native tab bar. `symbol` is an SF Symbol name. */
export interface NativeTab {
  id: string;
  title: string;
  symbol: string;
}

/** The primary call to action — the only control that moves time. */
export interface NativeCta {
  title: string;
  /**
   * The glass capsule beside the button: where the year is and where the tap
   * takes it — "M4 → M5". It replaced a tick meter above the button and a
   * caption below it, which said the same thing twice in two materials that
   * were not the app's.
   */
  badge: string;
  /** What that capsule reads as out loud. */
  badgeLabel: string;
  /** `action` is the orange month button; `prestige` is the gold year gate. */
  style: "action" | "prestige";
  enabled: boolean;
  /** Draws a padlock ahead of the title. The year gate, and nothing else. */
  locked: boolean;
}

/** A floating glass control in the masthead. */
export interface NativeControl {
  id: string;
  /** SF Symbol name. Ignored when `text` is set. */
  symbol?: string;
  /** Short label rendered instead of a symbol — the PRO / FREE badge. */
  text?: string;
  /** Accessibility label. Always required; a symbol is not a name. */
  label: string;
  style?: "plain" | "prestige";
  /** Left cluster instead of the right one. */
  leading?: boolean;
}

/**
 * `coach` is `full` with one surface singled out.
 *
 * The guided first play dims the screen and cuts a hole around one control.
 * That works for anything the web layer drew and cannot work for a UIKit view
 * — native composites above the webview, so a web scrim cannot dim it and a
 * web hole cannot expose it. In this mode the chrome dims and disables itself
 * and leaves exactly one surface lit, which is the same teaching gesture drawn
 * by the only renderer that can draw it.
 */
export type ChromeMode = "full" | "hidden" | "coach";

export interface NativeChromeState {
  mode: ChromeMode;
  theme: "light" | "dark";
  tabs: NativeTab[];
  activeTab: string | null;
  cta: NativeCta | null;
  controls: NativeControl[];
  /**
   * Which surface the tutorial is teaching, in `coach` mode. `"advance"`,
   * `"tabs"`, or a control id. Null when the step is teaching something the
   * web layer drew, in which case every native surface dims and none respond.
   */
  coach?: string | null;
}

/** A box in CSS pixels, page coordinates. */
export interface NativeRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Reserved space, in CSS pixels, that the web layout must leave empty. */
export interface ChromeInsets {
  /** Height of the masthead control strip, measured from the top of the page. */
  top: number;
  /** Height of the whole bottom deck: the capsules and the tab bar. */
  bottom: number;
  /** Just the tab bar, for surfaces that keep it and drop the rest. */
  tabBar: number;
  /**
   * Where the spotlit control is, when one is.
   *
   * There is no element to call `getBoundingClientRect` on, so the coachmark
   * card gets the box from the renderer that owns it — on the same layout pass
   * that produces the insets, and by the same route, so the two can never
   * describe different frames.
   */
  coach?: NativeRect | null;
}

/* ── The overlay chrome ────────────────────────────────────────────────────
 *
 * Everything that is not the play screen.
 *
 * `NativeChromeState` above describes the play screen and only ever the play
 * screen, and every other screen in this app is a full-screen web overlay that
 * made it go away. Which meant the deeper a player went, the less Liquid Glass
 * there was: settings, the closet, the six activity screens, the phone, the
 * panel and onboarding were all CSS approximations of a material sitting one
 * view away in the same binary.
 *
 * This is the other half of the contract. A screen declares the chrome it
 * wants — a way out, a title, a filter, the thing it is asking you to do — and
 * UIKit draws it in the real material and reports what it took.
 */

/** One control in an overlay's chrome. */
export interface NativeOverlayButton {
  /** Comes back on `overlayAction`. Unique within the screen. */
  id: string;
  /** Shown where there is room for words. A dock button always has one. */
  title?: string;
  /** SF Symbol. The whole content of a top-cluster circle. */
  symbol?: string;
  /** What it reads as out loud. A glyph is not a name. */
  label: string;
  /**
   * `plain` unless it is the thing the screen exists to ask.
   *
   * At most one `prominent` per screen — three prominent buttons is a screen
   * with no call to action at all. `destructive` is the confirmed half of a
   * two-tap delete, never the first tap.
   */
  style?: "plain" | "prominent" | "prestige" | "destructive";
  enabled?: boolean;
}

export interface NativeOverlaySegment {
  id: string;
  title: string;
}

export interface NativeOverlayState {
  /** `hidden` withdraws the whole thing and reserves nothing. */
  mode: "shown" | "hidden";
  theme: "light" | "dark";
  /** The screen's name, on a glass plate between the two clusters. */
  title?: string | null;
  /** A small line above it. */
  eyebrow?: string | null;
  /** Top-left cluster. The way out lives here. */
  leading?: NativeOverlayButton[];
  /** Top-right cluster. */
  trailing?: NativeOverlayButton[];
  /** A glass segmented control under the toolbar. */
  segments?: NativeOverlaySegment[];
  activeSegment?: string | null;
  /** The floating dock at the bottom. */
  actions?: NativeOverlayButton[];
}

/** What an overlay's chrome reserves, in CSS pixels. */
export interface OverlayInsets {
  top: number;
  bottom: number;
}

export const ZERO_OVERLAY_INSETS: OverlayInsets = { top: 0, bottom: 0 };

export interface GlassCapabilities {
  /** False on Android, on the web, and if the plugin failed to load. */
  available: boolean;
  /** True only on iOS 26 and later, where the glass is the real material. */
  liquidGlass: boolean;
  /** Major OS version, or 0 when unknown. */
  osVersion: number;
}

/** One option on a decision, as UIKit needs it. */
export interface NativeSheetChoice {
  label: string;
  /** The known half of the tradeoff. A financial figure, so never on glass. */
  cost?: string;
  /** This option opens the camera rather than resolving on the spot. */
  camera?: boolean;
}

export interface NativeSheetNote {
  term: string;
  text: string;
}

/**
 * A decision, described for a native sheet.
 *
 * `id` is the event id and comes back with every answer, so a reply that
 * arrives after the card has moved on is discarded rather than applied to
 * whatever is open now.
 */
export interface NativeSheetSpec {
  id: string;
  eyebrow: string;
  eyebrowStyle?: "plain" | "market";
  eyebrowDetail?: string;
  title: string;
  body: string;
  notes?: NativeSheetNote[];
  hintTitle?: string;
  hintText?: string;
  choices: NativeSheetChoice[];
  /** Shown instead of choices when an event has none — the camera gate. */
  actionLabel?: string;
  actionCamera?: boolean;
  dismissible?: boolean;
  theme: "light" | "dark";
}

export interface NovusGlassPlugin {
  capabilities(): Promise<GlassCapabilities>;
  /** Idempotent. Installs the chrome host over the webview. */
  configure(options: { theme: "light" | "dark"; tint: string }): Promise<ChromeInsets>;
  setChrome(state: NativeChromeState): Promise<ChromeInsets>;
  /**
   * The chrome for a screen that is not the play screen.
   *
   * Declarative and idempotent, like `setChrome`: a screen pushes its whole
   * chrome whenever any of it changes, and native works out what that means.
   * A diffing protocol across a bridge is a second source of truth about what
   * is on screen, and the two of them disagree eventually.
   */
  setOverlay(state: NativeOverlayState): Promise<OverlayInsets>;
  /**
   * A glass note floated in from the top. Chrome, not content — it explains
   * the board rather than being part of it, which is what makes it one of the
   * surfaces design.md allows glass on. Presenting a second one replaces the
   * first rather than stacking.
   */
  toast(options: {
    title?: string;
    text: string;
    tone?: "neutral" | "good" | "bad";
  }): Promise<void>;

  /** Puts a decision on screen. Replaces whatever sheet was already up. */
  presentSheet(spec: NativeSheetSpec): Promise<void>;
  /** Closes it because the game says so, rather than because the player did. */
  dismissSheet(): Promise<void>;

  addListener(
    event: "tabSelected",
    fn: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: "primaryAction", fn: () => void): Promise<PluginListenerHandle>;
  addListener(
    event: "controlSelected",
    fn: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "insetsChanged",
    fn: (data: ChromeInsets) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "overlayAction",
    fn: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "overlaySegment",
    fn: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "overlayInsets",
    fn: (data: OverlayInsets) => void,
  ): Promise<PluginListenerHandle>;
  /**
   * The sheet is on screen — sent from the controller's own `viewDidAppear`.
   *
   * The web layer needs this because `presentSheet` resolving means only that
   * the bridge took the call. UIKit refuses to present onto a controller that
   * is already presenting, and it refuses SILENTLY: no throw, no completion,
   * one line in the console. The card then exists in the engine and nowhere
   * else — the play chrome has withdrawn because a decision is open, and the
   * DOM sheet is not rendered behind a native one, so the screen is the
   * background and nothing at all to press.
   *
   * So presentation is confirmed rather than assumed. No confirmation inside
   * `PRESENT_TIMEOUT_MS` and the web draws the card itself, which is also what
   * makes an app running an older native binary — one that never sends this —
   * fall back cleanly instead of dead-ending.
   */
  addListener(
    event: "sheetPresented",
    fn: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "sheetChoice",
    fn: (data: { id: string; index: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "sheetAction",
    fn: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "sheetDismissed",
    fn: (data: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const NovusGlass = registerPlugin<NovusGlassPlugin>("NovusGlass");

export const ZERO_INSETS: ChromeInsets = { top: 0, bottom: 0, tabBar: 0, coach: null };
