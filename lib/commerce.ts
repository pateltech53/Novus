"use client";

import { useEffect, useState } from "react";

import { platform, type NativePlatform } from "@/lib/native/platform";

/** Checkout stays browser-only; existing account entitlements work on every platform.
 * Hooks start unknown to keep purchase controls out of prerendered native pages.
 * This controls product behavior, not whether Apple grants a policy exception.
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

/** Account support copy, with no invitation to purchase on another platform. */
export const MANAGE_SUBSCRIPTION_NOTE =
  "Your subscription remains attached to your Novus account. Contact support for help changing or cancelling it.";

export const PRO_ON_ACCOUNT_NOTE =
  "Purchases are not available in this app. If your account already has Pro, sign in to use your existing benefits and saved companies.";
