"use client";

import { useEffect, useState } from "react";

import { Browser } from "@capacitor/browser";

import { API_CREDENTIALS, WEB_ORIGIN, apiUrl } from "@/lib/native/origin";
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
 * WHICH ACCOUNT THE APP IS SIGNED IN AS, stated on the way out.
 *
 * `Browser.open` is a real Safari view sharing Safari's cookies — the thing
 * that keeps this link legal, and the thing that makes the browser a different
 * session from the app. Different session, different account: a player signed
 * into the app as one address and into the web as an older one used to pay
 * there and get Pro on an account that never opens the app. Restore cannot
 * mend that, because Restore correctly reports that the app's account owns
 * nothing.
 *
 * `?h=` is a signed claim and not a credential — it cannot sign anybody in,
 * and the only thing it can do is make the checkout refuse
 * (lib/billing/handoff.ts). Best effort in every sense: no server, no session,
 * no answer, and the link opens exactly as it did before, unchecked.
 */
interface Handoff {
  token: string | null;
  /** The app's account, masked. Null when the server would not say. */
  account: string | null;
}

const NO_HANDOFF: Handoff = { token: null, account: null };

/*
 * Held for ten minutes, well inside the token's own half hour.
 *
 * The pricing surface asks for the account on mount and the button asks for a
 * token on tap, and those are the same question — a player who reads the line
 * and then presses the button should not cost two round trips. Short enough
 * that signing out and back in as somebody else inside the app is reflected
 * before the cached answer could send them to the wrong account.
 */
const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; value: Handoff } | null = null;

async function handoff(): Promise<Handoff> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value = NO_HANDOFF;
  try {
    const res = await fetch(apiUrl("/api/billing/handoff"), {
      method: "POST",
      credentials: API_CREDENTIALS,
    });
    if (res.ok) {
      const body = (await res.json()) as { token?: string; account?: string | null };
      value = { token: body.token ?? null, account: body.account ?? null };
    }
  } catch {
    // Offline, or no server behind this build. The link still opens; it just
    // opens the way it did before any of this existed.
  }
  cached = { at: Date.now(), value };
  return value;
}

/** Forget the cached claim — sign-out inside the app must not keep naming it. */
export function forgetPurchaseAccount(): void {
  cached = null;
}

/**
 * Which account the purchase will attach to, masked, or null when the app
 * cannot say. Shown beside the link so the answer arrives before the browser
 * does rather than as a correction from it.
 */
export async function purchaseAccount(): Promise<string | null> {
  return (await handoff()).account;
}

/** The pricing page, carrying the claim when there is one to carry. */
async function purchaseUrl(): Promise<string> {
  const { token } = await handoff();
  if (!token) return PRO_PURCHASE_URL;
  // Query before fragment: `/#pro?h=…` would make the whole thing part of the
  // fragment and the page would never see a search parameter.
  return `${WEB_ORIGIN}/?h=${encodeURIComponent(token)}#pro`;
}

/**
 * Leaves the app for the pricing page.
 *
 * `Browser.open` on a device: a real Safari view sharing Safari's cookies. A
 * plain tab on the web, where this is only ever reached by someone who wants
 * the full pricing page rather than the sheet they are standing in.
 *
 * The trip is recorded before it starts, so that whatever happens next — a
 * `novus://purchase` hop home, or the player simply switching back — ends with
 * the app re-reading its receipt rather than sitting on the paywall they just
 * paid to remove. See lib/cloud/purchase-return.ts.
 */
export async function openProPurchase(): Promise<void> {
  const url = isNative() ? await purchaseUrl() : PRO_PURCHASE_URL;

  if (isNative()) {
    const { purchaseStarted } = await import("@/lib/cloud/purchase-return");
    purchaseStarted();
    try {
      await Browser.open({ url });
      return;
    } catch {
      // A binary that predates the Browser plugin being linked, or a native
      // throw. Capacitor routes a window.open at a host that is not the app's
      // own out to the system browser, so the link still leaves — and a
      // rejection here would otherwise be an unhandled one, thrown from a tap
      // handler that has no way to catch it.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The line beside the purchase link in a store build.
 *
 * Says where the payment happens and how it gets back, because both halves are
 * surprising: the sale is not on this screen, and the thing that finishes it
 * here is Restore rather than another payment.
 *
 * ── And that the browser will ask who they are ──────────────────────────────
 *
 * The third surprise, and the one that was left out. `Browser.open` is a real
 * Safari view with Safari's cookies — which is exactly what keeps this link
 * legal, and exactly why it is a different session from the app's. Signing in
 * inside the app does nothing for it. So everyone taking this link arrives at
 * the prices signed out, and until they are told that, being refused at the
 * moment they press a plan reads as the purchase being broken.
 */
export const BUY_IN_BROWSER_NOTE =
  "Pro is bought on the web and attaches to your Novus account, not to this device. The link opens your browser, which will ask you to sign in to that same account first — being signed in here does not sign you in there. Paying brings you back and Pro is on when you land; Restore is there if anything goes wrong on the way.";
