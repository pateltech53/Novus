"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Warms the next screen while the player is still reading this one.
 *
 * This app has exactly one path through it — welcome, found, play — and each
 * step ends in a button press that has to feel instantaneous. Next only
 * prefetches automatically for `<Link>`, and every one of these transitions is
 * a `router.push` from a handler, so the chunk for the next route is not
 * requested until the moment it is needed.
 *
 * In the shipped app the bundle is already on disk, so this costs one local
 * read and buys a transition with no parse gap in it at all.
 */
export function usePrefetch(...paths: string[]): void {
  const router = useRouter();
  const key = paths.join("|");

  useEffect(() => {
    // Idle, not immediate: the screen the player is looking at gets the main
    // thread first. Falling back to a timeout keeps Safari, which shipped
    // requestIdleCallback late, on the same path rather than no path.
    const warm = () => key.split("|").forEach((path) => path && router.prefetch(path));
    const idle = window.requestIdleCallback;
    if (idle) {
      const id = idle(warm, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(warm, 400);
    return () => window.clearTimeout(id);
  }, [key, router]);
}
