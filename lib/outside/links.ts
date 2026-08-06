"use client";

import { setActiveIsland } from "@/lib/engine/save";
import { appPath } from "@/lib/native/href";

/**
 * Where a tap on a widget lands.
 *
 * Every surface outside the app is a link, and a link that merely opens the
 * app is a wasted one: `native/boot.html` already decides which screen a cold
 * start belongs on, so "open Novus" is what the icon does. A widget is worth
 * having only if tapping the runway ring puts you in front of the runway.
 *
 * The scheme is `novus://` and the whole vocabulary is four destinations. It
 * is deliberately small — a URL space is a public API the moment one ships in
 * a binary, and a widget on someone's home screen outlives the version of the
 * app that drew it. Anything unrecognised falls through to the play screen
 * rather than failing, so an old widget and a new app can never dead-end.
 *
 *     novus://play             the board
 *     novus://gate             the board, with the year gate as the reason
 *     novus://island/3         that company, then the board
 *     novus://islands          the picker
 *     novus://market           the board, with RobinGhood open on the phone
 */

export const OUTSIDE_SCHEME = "novus";

export interface OutsideLink {
  /** The document to be on. */
  route: "/play" | "/islands";
  /** Switch to this company first. Null when the link does not name one. */
  island: number | null;
  /** An app on the in-fiction phone to open once the board is up. */
  open: "market" | null;
}

const PLAY: OutsideLink = { route: "/play", island: null, open: null };

/**
 * Read a `novus://` URL. Pure, and total: anything at all resolves to a
 * destination, because the alternative is a tap that does nothing.
 *
 * Returns null only for a URL that is not ours, which is how the listener
 * tells a widget tap from an OAuth callback arriving on the same channel.
 */
export function parseOutsideLink(raw: string): OutsideLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${OUTSIDE_SCHEME}:`) return null;

  // `novus://island/3` parses as host "island", pathname "/3". `novus://play`
  // parses as host "play" with an empty pathname. Both shapes are read off the
  // host, which is the only part every form of this URL actually has.
  const head = url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0] || "";
  const tail = url.pathname.replace(/^\/+/, "").split("/").filter(Boolean);

  switch (head) {
    case "islands":
      return { route: "/islands", island: null, open: null };
    case "island": {
      const slot = Number(tail[0]);
      return Number.isInteger(slot) && slot >= 0
        ? { route: "/play", island: slot, open: null }
        : { route: "/islands", island: null, open: null };
    }
    case "market":
      return { route: "/play", island: null, open: "market" };
    // "play", "gate", and anything a future widget invents.
    default:
      return PLAY;
  }
}

// ── The pending "open this once you get there" ──────────────────────────────

/**
 * `novus://market` has to survive a document navigation, and a module variable
 * does not: the app is a separate document per route, so following the link
 * from the islands screen destroys the JS that read it. Session storage is the
 * only thing that lives in the gap, and it is scoped to the tab, so nothing
 * here outlives the launch that asked for it.
 */
const OPEN_KEY = "novus:outside:open";

const openListeners = new Set<() => void>();

function stashOpen(open: OutsideLink["open"]): void {
  if (!open) return;
  try {
    window.sessionStorage?.setItem(OPEN_KEY, open);
  } catch {
    /* No session storage: the screen still opens, just without the app on it. */
  }
  openListeners.forEach((fn) => fn());
}

/**
 * What the widget asked to have open, once. Reading it clears it — a link
 * followed twice because a screen remounted is a phone that will not close.
 */
export function consumeOutsideOpen(): OutsideLink["open"] {
  try {
    const value = window.sessionStorage?.getItem(OPEN_KEY);
    if (value !== "market") return null;
    window.sessionStorage.removeItem(OPEN_KEY);
    return "market";
  } catch {
    return null;
  }
}

/** Fires when a link arrives at a document that is already the right one. */
export function subscribeOutsideOpen(fn: () => void): () => void {
  openListeners.add(fn);
  return () => openListeners.delete(fn);
}

// ── Following one ───────────────────────────────────────────────────────────

/**
 * Act on a link. Safe to call from anywhere, including before React has
 * mounted anything.
 *
 * A document navigation rather than a router push, and deliberately: the link
 * may arrive on any screen in the app, including one mounted outside the
 * router that owns `/play`. `appPath` is what makes it resolve inside the
 * shell — see lib/native/href.ts for the four lines of Capacitor that make a
 * trailing slash load the wrong document.
 */
export function followOutsideLink(link: OutsideLink): void {
  if (typeof window === "undefined") return;

  if (link.island !== null) {
    try {
      setActiveIsland(link.island);
    } catch {
      // An empty slot, or storage refused. The picker is a better answer than
      // a board with nothing on it.
      link = { route: "/islands", island: null, open: null };
    }
  }

  stashOpen(link.open);

  const here = window.location.pathname.replace(/\/(index\.html)?$/, "");
  const there = link.route;
  // Already here: the subscription above is what puts the phone on screen.
  // Navigating anyway would reload the board for no reason and lose the
  // decision card that may be open on it.
  if (here === there && link.island === null) return;

  window.location.assign(appPath(there));
}
