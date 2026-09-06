"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence } from "framer-motion";
import { play } from "@/lib/sound";
import { isPro, loadEntitlements } from "@/lib/monetization";
import { gateFor, type Gate, type GateId } from "@/lib/upgrade";
import { warm, type Preloadable } from "@/lib/warm";

/*
 * Both of these render behind a gate that most sessions never trip, and this
 * provider is mounted by the ROOT LAYOUT — so they were in the first load of
 * every page in the app, including /privacy, /terms, /download and /join,
 * none of which can open an upgrade sheet at all. Between them they also drag
 * lib/legal/documents.tsx and were one of the things anchoring framer-motion's
 * DOM feature bundle into those routes.
 *
 * `loading: () => null` because the AnimatePresence below already owns how
 * these arrive; a spinner in the doorway would be a second answer to the same
 * question.
 */
const UpgradeNotice = warm(() =>
  import("@/components/upgrade/UpgradeNotice").then((m) => m.UpgradeNotice),
);
const UpgradeScreen = warm(() =>
  import("@/components/upgrade/UpgradeScreen").then((m) => m.UpgradeScreen),
);

/**
 * These two, for a screen that can actually trip a gate to warm — see
 * lib/warm.tsx. Both render nothing until their module is in hand, so the
 * first refusal in a session used to arrive a beat after the tap that earned
 * it — which reads as the tap having failed.
 *
 * Exported rather than warmed here, and that is the whole point of it being a
 * list instead of an effect: this provider is mounted by the ROOT LAYOUT, so
 * warming from inside it would pull the upgrade chunks into /privacy, /terms,
 * /download and /join — the pages the comment above split them out of. A
 * screen with gates opts in; a legal page never does.
 */
export const UPGRADE_WARM: Preloadable[] = [
  UpgradeNotice.preload,
  UpgradeScreen.preload,
];

/**
 * One place that answers "you cannot do that, here is why, here is Pro".
 *
 * Before this, every gate in the app was a dead end with a sentence beside it:
 * a locked industry printed a line of grey 13px text, a locked asset disabled
 * its own button, and The Room rendered an explanation with nothing to press.
 * The player was told the limit and then left holding it. Six screens each
 * needed a route to the same pricing surface, and none of them had one.
 *
 * The shape here is two layers, deliberately:
 *
 *   `notify(gate)` — the soft answer. A notification arrives, says which limit
 *   was hit, and offers the screen. It interrupts nothing: the tap that hit the
 *   gate keeps whatever it was doing, and ignoring the banner costs nothing.
 *
 *   `open(gate?)` — the hard answer, for a control that already says "See Pro".
 *   Straight to the screen, no banner in between.
 *
 * A gate is a refusal, not a nag, and the difference is enforced here rather
 * than trusted to six call sites:
 *
 *   · **Pro players never see it.** Read from the store on every call, not
 *     captured at mount, so the notification cannot appear one tap after the
 *     purchase that made it wrong.
 *   · **Once per gate per session.** Tapping four locked industries in a row is
 *     one player learning one thing, not four notifications.
 *   · **It leaves on its own.** Ten seconds, cleared on replace and on unmount.
 *
 * Mounted in the root layout because the gates are spread across /found, /play
 * and the in-game phone, and a provider per route is three copies of the same
 * dedupe state that each forget what the others already said.
 */

interface UpgradeContextValue {
  /** A free player just hit a limit. Shows the notification. No-op for Pro. */
  notify(id: GateId): void;
  /** Open the upgrade screen now. `id` decides what it leads with. */
  open(id?: GateId): void;
}

const UpgradeContext = createContext<UpgradeContextValue | null>(null);

/**
 * Optional by design, like `useImpact`. A component rendered outside the
 * provider — a test, a Storybook page, the marketing site — gets a no-op rather
 * than a crash, because a gate failing to offer an upsell is a smaller problem
 * than a screen that will not render.
 */
export function useUpgrade(): UpgradeContextValue {
  return useContext(UpgradeContext) ?? NO_OP;
}

const NO_OP: UpgradeContextValue = { notify: () => {}, open: () => {} };

/** How long the banner stays before it withdraws itself. */
const NOTICE_MS = 10_000;

export function UpgradeProvider({ children }: { children: React.ReactNode }) {
  const [notice, setNotice] = useState<Gate | null>(null);
  const [screen, setScreen] = useState<{ gate: Gate | null } | null>(null);

  /*
   * ── Neither surface survives a route change ────────────────────────────────
   *
   * This provider is mounted in the root layout (app/layout.tsx), which is the
   * whole point of it — any screen can raise a gate without owning the sheet.
   * But a layout does not unmount on a client-side navigation, so the sheet
   * did not either: open the upgrade screen from the islands picker, follow a
   * link out of it, and the pricing sheet was still there over the new page,
   * at z-[98], with a close button belonging to a screen nobody was looking at
   * any more. Same for the banner, which has a 10s timer and no reason to
   * outlive the page that earned it.
   *
   * The pathname is the signal, and it changes on exactly the transitions this
   * has to answer.
   */
  const pathname = usePathname();
  useEffect(() => {
    setScreen(null);
    setNotice(null);
  }, [pathname]);

  /** Gates already announced this session. Not state — nothing renders it. */
  const announced = useRef<Set<GateId>>(new Set());
  const timer = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const notify = useCallback(
    (id: GateId) => {
      if (isPro(loadEntitlements())) return;
      if (announced.current.has(id)) return;
      announced.current.add(id);

      clearTimer();
      setNotice(gateFor(id));
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setNotice(null);
      }, NOTICE_MS);
    },
    [clearTimer],
  );

  const open = useCallback(
    (id?: GateId) => {
      clearTimer();
      setNotice(null);
      play("activity");
      setScreen({ gate: id ? gateFor(id) : null });
    },
    [clearTimer],
  );

  const dismiss = useCallback(() => {
    clearTimer();
    setNotice(null);
  }, [clearTimer]);

  const value = useMemo<UpgradeContextValue>(
    () => ({ notify, open }),
    [notify, open],
  );

  return (
    <UpgradeContext.Provider value={value}>
      {children}

      <AnimatePresence>
        {notice && !screen && (
          <UpgradeNotice
            key={notice.id}
            gate={notice}
            onOpen={() => open(notice.id)}
            onDismiss={dismiss}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {screen && (
          <UpgradeScreen gate={screen.gate} onClose={() => setScreen(null)} />
        )}
      </AnimatePresence>
    </UpgradeContext.Provider>
  );
}
