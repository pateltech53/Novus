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
  caption: string;
  /** Filled ticks in the year meter drawn above the button. */
  progress: number;
  total: number;
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

export type ChromeMode = "full" | "hidden";

export interface NativeChromeState {
  mode: ChromeMode;
  theme: "light" | "dark";
  tabs: NativeTab[];
  activeTab: string | null;
  cta: NativeCta | null;
  controls: NativeControl[];
}

/** Reserved space, in CSS pixels, that the web layout must leave empty. */
export interface ChromeInsets {
  /** Height of the masthead control strip, measured from the top of the page. */
  top: number;
  /** Height of the whole bottom deck: meter, button, caption and tab bar. */
  bottom: number;
  /** Just the tab bar, for surfaces that keep it and drop the rest. */
  tabBar: number;
}

export interface GlassCapabilities {
  /** False on Android, on the web, and if the plugin failed to load. */
  available: boolean;
  /** True only on iOS 26 and later, where the glass is the real material. */
  liquidGlass: boolean;
  /** Major OS version, or 0 when unknown. */
  osVersion: number;
}

export interface NovusGlassPlugin {
  capabilities(): Promise<GlassCapabilities>;
  /** Idempotent. Installs the chrome host over the webview. */
  configure(options: { theme: "light" | "dark"; tint: string }): Promise<ChromeInsets>;
  setChrome(state: NativeChromeState): Promise<ChromeInsets>;
  /** A glass capsule that floats in and out. Used for confirmations only. */
  toast(options: { text: string; tone?: "neutral" | "good" | "bad" }): Promise<void>;

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
}

export const NovusGlass = registerPlugin<NovusGlassPlugin>("NovusGlass");

export const ZERO_INSETS: ChromeInsets = { top: 0, bottom: 0, tabBar: 0 };
