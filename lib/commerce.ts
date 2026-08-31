"use client";

import { useEffect, useState } from "react";

import { platform, type NativePlatform } from "@/lib/native/platform";

/**
 * Where money is allowed to change hands: a browser, and only a browser.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * App Store Review Guideline 3.1.1: digital content used inside an iOS app is
 * sold with In-App Purchase. Nothing in a store build opens Stripe Checkout,
 * names a price, or links toward either — `sellsHere()` is false on both
 * shells and every pricing surface is gated on it. Google Play's Payments
 * policy says the same about Play Billing, so Android is gated with iOS.
 *
 * ── The experiment this file used to carry, and how it ended ────────────────
 *
 * For one submission this file offered a store build a purchase link out to
 * the website's pricing section, with both plan prices beside it, on the
 * strength of the April 2025 US *Epic v. Apple* injunction and a premise
 * stated here as "it genuinely leaves — `Browser.open` is a Safari view, not
 * an embedded webview." App Review rejected build 1.0(3) over it, and the
 * premise was the flaw: on iOS `Browser.open` presents SFSafariViewController
 * — a sheet inside the app, dismissed by a Done button back into it — showing
 * a page where the plans were purchasable through Stripe. "The plans can be
 * purchased in the app using payment mechanisms other than In-App Purchase"
 * is the rejection, and it is a fair description of what the reviewer saw.
 * The app also carries no `com.apple.developer.storekit.external-purchase-link`
 * entitlement, so there was no grant to argue under either.
 *
 * So the experiment is over, deliberately, and this build is the
 * sells-nothing build again: no checkout, no price, no link. Pro attaches to
 * a Novus account rather than a device, a subscription bought in any browser
 * reaches the app the moment that account signs in, and **Restore stays** —
 * it is the only way Pro appears in a store build, and App Review looks for
 * it. If a way to sell inside the app is ever wanted, it is StoreKit 2 and
 * real products (docs/APP-STORE.md §7), not a link wearing a costume.
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
 * What a store build says where a checkout would be.
 *
 * A statement of fact about where Pro lives, in the same register as
 * MANAGE_SUBSCRIPTION_NOTE: it names no price, offers no link and issues no
 * instruction to go buy anything — the 3.1.3(a) line is between describing a
 * player's own account and pointing them at a till, and this sentence stays
 * on the describing side. Restore beside it is the action.
 */
export const PRO_ON_ACCOUNT_NOTE =
  "Novus Pro attaches to a Novus account, not to this device. If your account has Pro, sign in and it arrives on the next sync — or tap Restore to check now.";
