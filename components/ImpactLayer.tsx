"use client";

import { play } from "@/lib/sound";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { IMPACT_MS, STAGGER } from "@/components/ui/Motion";

/**
 * Decision impact, made legible.
 *
 * Every stat change floats up from where it happened and lands as a coloured
 * chip, so a choice never silently edits a number you weren't looking at. The
 * rings and Books flash at the same moment (they watch their own values), and
 * this layer supplies the motion on top.
 */

export interface Impact {
  id: number;
  label: string;
  tone: "up" | "down" | "flat";
  /**
   * This chip's own place in the batch it arrived with, in seconds.
   *
   * Not derivable at render time, which is what it used to be: the delay read
   * the index in the FLAT `items` array, so a second decision answered while
   * the first batch was still on screen gave its chips delays of 0.24s, 0.30s,
   * 0.36s instead of 0, 0.06, 0.12 — while their removal timer, measured from
   * their own push and sized to their own batch, expired on the original
   * schedule. Chips were being unmounted before or during the animation they
   * were still waiting to start. Carried on the item, the two agree.
   */
  delay: number;
}

interface ImpactContextValue {
  /** Fire a batch of floaters — one per stat the decision moved. */
  push(deltas: { label: string; tone: "up" | "down" | "flat" }[]): void;
}

const ImpactContext = createContext<ImpactContextValue | null>(null);

export function useImpact() {
  const ctx = useContext(ImpactContext);
  // Optional by design: components can render outside the layer in tests.
  return ctx ?? { push: () => {} };
}

export function ImpactProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Impact[]>([]);
  const nextId = useRef(0);

  const push = useCallback(
    (deltas: { label: string; tone: "up" | "down" | "flat" }[]) => {
      if (deltas.length === 0) return;
      const batch = deltas
        .slice(0, 6)
        .map((d, k) => ({ ...d, id: nextId.current++, delay: k * STAGGER }));
      setItems((prev) => [...prev, ...batch]);
      /*
       * Floaters are transient; drop them once the animation has played out.
       *
       * The lifetime is keyed to IMPACT_MS like the rings and The Books, rather
       * than being a third independent number. It is TWICE the unit and not
       * one, deliberately: an outline only has to be seen, and a ring only has
       * to arrive, but a chip carries a word and a figure that have to be READ
       * — and up to six of them arrive staggered. Same clock, two beats of it,
       * plus the tail for the last chip's stagger.
       */
      window.setTimeout(
        () => setItems((prev) => prev.filter((i) => !batch.some((b) => b.id === i.id))),
        IMPACT_MS * 2 + batch.length * STAGGER * 1000,
      );
    },
    [],
  );

  /*
   * The value has to be memoised, not just `push`.
   *
   * `push` was already a `useCallback`, but it was being wrapped in a fresh
   * object literal on every render — and this provider re-renders on every
   * decision and again 1.8 s later when the floaters are dropped. A new context
   * value re-renders every `useImpact()` consumer both times, and this provider
   * is mounted around the whole of `/play` (`app/play/page.tsx:46`).
   *
   * The sibling providers already do this correctly (`UpgradeProvider.tsx:124`,
   * `GameProvider.tsx:1230`), so this was an outlier rather than a pattern.
   */
  const value = useMemo(() => ({ push }), [push]);

  return (
    <ImpactContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[38%] z-[75] flex flex-col items-center gap-1.5"
      >
        {items.map((item) => (
          <motion.span
            key={item.id}
            className="tnum rounded-full px-3 py-1.5 text-sm font-extrabold shadow-[var(--e2)]"
            style={
              item.tone === "up"
                ? { background: "var(--solvency)", color: "var(--on-action)" }
                : item.tone === "down"
                  ? { background: "var(--alert)", color: "var(--on-action)" }
                  : { background: "var(--color-navy)", color: "var(--on-action)" }
            }
            initial={{ opacity: 0, y: 18, scale: 0.85 }}
            animate={{ opacity: [0, 1, 1, 0], y: [18, 0, -10, -46], scale: [0.85, 1.06, 1, 1] }}
            transition={{
              duration: (IMPACT_MS * 2) / 1000,
              times: [0, 0.15, 0.6, 1],
              delay: item.delay,
            }}
          >
            {item.label}
          </motion.span>
        ))}
      </div>
    </ImpactContext.Provider>
  );
}

/*
 * `useValueFlash` was removed here.
 *
 * It documented itself as "a number that visibly counts to its new value" and
 * did not count: the body compared the previous value to the current one and
 * then only assigned, so the comparison had no effect, and the flash it did
 * expose had to be fired by hand. Nothing imported it. The Books — the one
 * consumer the docstring named — has always run its own 700 ms outline toggle
 * in `TheBooks.tsx`.
 *
 * The behaviour it described is worth having, and it belongs on one clock
 * shared with the rings and the floaters above rather than in a third
 * implementation. That is the decision beat, not a hook nobody called.
 */
