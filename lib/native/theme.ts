"use client";

import { useSyncExternalStore } from "react";

/**
 * The theme, as an actual value rather than a CSS cascade.
 *
 * UIKit cannot read `data-theme`, so the native chrome has to be told which
 * world it is drawing into. `lib/theme.ts` already writes that attribute on
 * <html> as the single source of truth; this just makes React able to watch it.
 */

type Resolved = "light" | "dark";

function read(): Resolved {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribe(fn: () => void): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const obs = new MutationObserver(fn);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

/** Server snapshot is dark: the blocking script in <head> has already run by
 *  the time this matters on the client, and dark is what an unstyled first
 *  frame should be rather than a white flash. */
const serverSnapshot = (): Resolved => "dark";

export function useResolvedTheme(): Resolved {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}
