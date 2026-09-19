"use client";

import { useEffect, useState } from "react";

import { platform, type NativePlatform } from "@/lib/native/platform";

/** Store checkout remains browser-only. iOS ships the basic game until StoreKit
 * is implemented: raw account purchases stay stored but do not unlock iOS content.
 * Hooks start unknown to keep purchase controls out of prerendered native pages.
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

/** Paid-content UI is absent from the basic iOS edition, including on first paint. */
export function usePaidContent(): boolean {
  const where = useStorefront();
  return where !== null && where !== "app-store";
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
 * on the describing side.
 *
 * It deliberately does not name Restore: three of the four surfaces render
 * RestoreButton right beside this note, where the control explains itself,
 * and the fourth — the onboarding plans step — has no Restore at all, so a
 * sentence saying "tap Restore" would be an instruction pointing at a
 * control that is not on the screen giving it.
 */
export const PRO_ON_ACCOUNT_NOTE =
  "Novus Pro attaches to a Novus account, not to this device. If your account has Pro, sign in and it arrives with your saves.";
