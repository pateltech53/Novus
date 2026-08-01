"use client";

import { useEffect, useState } from "react";

import { platform, type NativePlatform } from "@/lib/native/platform";

/**
 * Where money is allowed to change hands, and where it is not.
 *
 * ── The rejection this file exists to stop ──────────────────────────────────
 *
 * App Store Review Guideline 3.1.1: digital content used inside an iOS app
 * must be sold with In-App Purchase. A subscription button that opens Stripe
 * Checkout — which is exactly what `goToCheckout()` does — is the single most
 * reliably rejected thing an app can ship. Guideline 3.1.3(a) closes the other
 * door: the app may not carry buttons, links or calls to action pointing at a
 * purchase mechanism outside the app either, so "buy it on our website" is not
 * the fix. Google Play's Payments policy says the same thing about Play
 * Billing, which is why this returns false for both shells rather than only
 * for iOS.
 *
 * So the rule is one line: **a store build sells nothing.** Pro is bought on
 * the web, it attaches to a Novus account (never to a device), and the app
 * turns it on when that account signs in. Everything the player needs for that
 * — status, restore, cancel — exists inside the app, which is what keeps the
 * removal of the buttons from being a dead end.
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
 * The one line a store build shows where prices used to be.
 *
 * States a fact about the app and stops. No URL, no "visit", no instruction to
 * go anywhere: an App Store build that tells a player where else to buy is the
 * 3.1.3(a) rejection wearing a different coat.
 */
export const NOT_SOLD_HERE_NOTE =
  "Nothing is sold inside this app. If your Novus account already has Pro, it switches on when you sign in.";
