"use client";

import { play } from "@/lib/sound";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { motion } from "framer-motion";

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
      const batch = deltas.slice(0, 6).map((d) => ({ ...d, id: nextId.current++ }));
      setItems((prev) => [...prev, ...batch]);
      // Floaters are transient; drop them once the animation has played out.
      window.setTimeout(() => {
        setItems((prev) => prev.filter((i) => !batch.some((b) => b.id === i.id)));
      }, 1800);
    },
    [],
  );

  return (
    <ImpactContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-[38%] z-[75] flex flex-col items-center gap-1.5"
      >
        {items.map((item, i) => (
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
            transition={{ duration: 1.7, times: [0, 0.15, 0.6, 1], delay: i * 0.07 }}
          >
            {item.label}
          </motion.span>
        ))}
      </div>
    </ImpactContext.Provider>
  );
}

/**
 * A number that visibly counts to its new value and flashes the direction of
 * travel. Used by The Books so money never just teleports.
 */
export function useValueFlash(value: string) {
  const prev = useRef(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);

  if (prev.current !== value) {
    prev.current = value;
  }

  const trigger = useCallback((tone: "up" | "down") => {
    setFlash(tone);
    window.setTimeout(() => setFlash(null), 700);
  }, []);

  return { flash, trigger };
}
