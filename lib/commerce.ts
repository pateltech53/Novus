"use client";

import { useEffect, useState } from "react";

import { Browser } from "@capacitor/browser";

import { WEB_ORIGIN } from "@/lib/native/origin";
import { isNative, platform, type NativePlatform } from "@/lib/native/platform";

/**
 * Where money is allowed to change hands, and how the app gets a player there.
 *
 * ── The rule, and what changed about it ─────────────────────────────────────
 *
 * App Store Review Guideline 3.1.1: digital content used inside an iOS app is
 * sold with In-App Purchase. That has not moved, and it is why nothing in a
 * store build ever opens Stripe Checkout in the webview — `sellsHere()` is
 * false on both shells and every in-app checkout button is gated on it. Google
 * Play's Payments policy says the same about Play Billing.
 *
 * What did move is the other half. 3.1.3(a) used to forbid the app from
 * carrying so much as a link to a purchase mechanism outside it, which left a
 * store build with Restore and nothing else — a screen that told a player Pro
 * existed and then refused to say where. Since the April 2025 US injunction in
 * *Epic v. Apple*, US storefront apps may carry a plain link out to the web,
 * with no entitlement, no commission and no interstitial. So the build offers
 * one: **the purchase link leaves the app.** It opens the pricing section of
 * the website in the player's own browser, the sale happens there against
 * their Novus account, and the app picks it up on the next sync or Restore.
 *
 * Two things keep that honest, and both are load-bearing:
 *
 * · **It genuinely leaves.** `Browser.open` is a Safari view with Safari's
 *   cookies, not an embedded webview wearing a browser costume. A purchase
 *   flow rendered inside the app's own webview is an in-app purchase however
 *   it is framed.
 * · **Restore stays.** It is the path by which a purchase made anywhere
 *   arrives here, and App Review looks for it in any app where something can
 *   be bought. Smaller than the link, because the link is what most people
 *   need and Restore is what some people need.
 *
 * Outside the US storefront this link is the thing to switch off first if a
 * review ever objects: delete the two call sites, and the build is the
 * sells-nothing build it was before, with Restore already in place.
 *
 * ── Why a hook and not a plain call ─────────────────────────────────────────
 *
 * The native build is a static export: its HTML is prerendered on a machine
 * where `Capacitor.getPlatform()` is "web", and the answer only becomes true
 * on the device at hydration. Reading it during render would either desync
 * hydration or paint one frame of a checkout button inside the App Store
 * build. So the hook starts at `null` — "not known yet" — and every pricing
 * surface renders nothing rather than the wrong thing for one frame. That is
 * the same shape app/welcome already used for `billingStatus()`.
 */

export type Storefront = "web" | "app-store" | "play-store";

const STOREFRONTS: Record<NativePlatform, Storefront> = {
  web: "web",
  ios: "app-store",
  android: "play-store",
};

export function storefront(): Storefront {
  return STOREFRONTS[platform()];
}

/**
 * True only in a browser. Every caller that draws a price, a plan chip, a
 * checkout button or a link to one is gated on this.
 */
export function sellsHere(): boolean {
  return storefront() === "web";
}

/**
 * The storefront, once the shell is known. `null` for the first render and for
 * the prerendered HTML — see the file comment.
 */
export function useStorefront(): Storefront | null {
  const [where, setWhere] = useState<Storefront | null>(null);
  useEffect(() => setWhere(storefront()), []);
  return where;
}

/** `null` until known, then whether this build may show a way to pay. */
export function useSellsHere(): boolean | null {
  const where = useStorefront();
  return where === null ? null : where === "web";
}

/**
 * What Settings says under "Manage subscription", per storefront.
 *
 * On the web this is Stripe's customer portal and the row opens it. In a store
 * build there is nothing for the app to open — the subscription was bought in
 * a browser and is cancelled in the same place — so the row states where it
 * lives instead of offering a button that cannot work. Naming the mechanism a
 * player already used is a statement of fact about their own account, not a
 * call to action pointed at a purchase, which is the line 3.1.3(a) draws.
 */
export const MANAGE_SUBSCRIPTION_NOTE =
  "Novus Pro is billed to your Novus account. Sign in on the web to change or cancel it — the change reaches this app the next time it syncs.";

/**
 * Where the purchase link goes.
 *
 * The website's pricing section, by id, so the browser lands on the plans
 * rather than at the top of a marketing page the player then has to scroll.
 * Absolute on purpose — see WEB_ORIGIN.
 */
export const PRO_PURCHASE_URL = `${WEB_ORIGIN}/#pro`;

/**
 * Leaves the app for the pricing page.
 *
 * `Browser.open` on a device: a real Safari view sharing Safari's cookies, so
 * a player already signed in on the web is still signed in when they get
 * there, and the purchase attaches to the account it should. A plain tab on
 * the web, where this is only ever reached by someone who wants the full
 * pricing page rather than the sheet they are standing in.
 */
export async function openProPurchase(): Promise<void> {
  if (isNative()) {
    await Browser.open({ url: PRO_PURCHASE_URL });
    return;
  }
  window.open(PRO_PURCHASE_URL, "_blank", "noopener,noreferrer");
}

/**
 * The line beside the purchase link in a store build.
 *
 * Says where the payment happens and how it gets back, because both halves are
 * surprising: the sale is not on this screen, and the thing that finishes it
 * here is Restore rather than another payment.
 */
export const BUY_IN_BROWSER_NOTE =
  "Pro is bought on the web and attaches to your Novus account, not to this device. The link opens your browser; come back and tap Restore, or it arrives on the next sync.";
