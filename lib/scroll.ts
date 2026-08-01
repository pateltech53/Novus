"use client";

import { useEffect, useState } from "react";

/**
 * True while the page is moving under the visitor, false once it has been
 * still for `settleMs`.
 *
 * This exists so that decorative render loops can get out of the way. A
 * scrolling browser is already spending its frame on scroll: hit-testing,
 * compositing, decoding whatever just came into view. Anything running a
 * 60fps loop beside that is competing with the one thing the visitor is
 * actually doing, and on a phone it is the difference between a page that
 * glides and one that stutters.
 *
 * The state flips at most twice per gesture — once when the scroll starts and
 * once after it stops — even though the setter is called on every scroll
 * event: React compares the next value to the current one and bails out
 * without re-rendering when they match. That matters, because a render on
 * every scroll event would land inside exactly the frames this is protecting.
 */
export function useScrolling(settleMs = 180): boolean {
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    let settle = 0;

    const onScroll = () => {
      setScrolling(true);
      window.clearTimeout(settle);
      settle = window.setTimeout(() => setScrolling(false), settleMs);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("scroll", onScroll);
    };
  }, [settleMs]);

  return scrolling;
}
