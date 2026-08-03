"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { MONTH_NAMES } from "@/lib/engine/format";
import { Glass, GlassScrim } from "@/components/ui/Glass";
import { BeeMail, inboxFor } from "@/components/phone/BeeMail";
import { LockScreen } from "@/components/phone/LockScreen";
import { ColdCall } from "@/components/phone/ColdCall";

export type PhoneApp = "robinghood" | "beemail" | "linkedout" | "coldcall";
/**
 * `lock` is where every session starts. See the note on `screen` below — the
 * phone used to open on whichever app had a notification, which turned it into a
 * menu rather than a device.
 */
type Screen = "lock" | "home" | PhoneApp;

/**
 * The in-fiction app brands sit deliberately outside the Novus palette: none of
 * these tiles may read as a Novus call to action, so none of them may be
 * --color-action. Greens and reds are the darkened-on-white variants the brand
 * rules require for legibility against a white glyph.
 */
const APPS: {
  id: PhoneApp;
  name: string;
  tint: string;
  glyph: React.ReactNode;
}[] = [
  {
    id: "robinghood",
    name: "RobinGhood",
    tint: "var(--solvency)",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" fill="none">
        <path
          d="M3 17.5 8.5 11l3.8 3.6L20 6"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 6h5v5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "beemail",
    name: "BeeMail",
    tint: "var(--app-beemail)",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" fill="none">
        <rect
          x="2.5"
          y="5"
          width="19"
          height="14"
          rx="3"
          stroke="currentColor"
          strokeWidth="2.1"
        />
        <path
          d="m4 8 7.1 4.8a1.6 1.6 0 0 0 1.8 0L20 8"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "coldcall",
    name: "The Room",
    tint: "var(--color-navy)",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" fill="none">
        <path
          d="M6.6 3.5c.9 0 1.7.6 1.9 1.5l.6 2.3c.2.8-.1 1.6-.8 2l-1 .7a10.6 10.6 0 0 0 4.7 4.7l.7-1c.4-.7 1.2-1 2-.8l2.3.6c.9.2 1.5 1 1.5 1.9v2.1c0 1.2-1 2.1-2.2 2C10.1 19 5 13.9 4.5 5.7c-.1-1.2.8-2.2 2-2.2h.1Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "linkedout",
    name: "LinkedOut",
    tint: "var(--app-linkedout)",
    glyph: (
      <svg viewBox="0 0 24 24" className="h-7 w-7" aria-hidden="true" fill="none">
        <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="2.1" />
        <path
          d="M3.5 19.2c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
        <path
          d="M16.2 5.4a3 3 0 0 1 0 5.5M17.4 14.8c2 .5 3.3 2 3.8 4.4"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export function Phone({
  open,
  initialApp,
  onClose,
  robinghood,
  linkedout,
}: {
  open: boolean;
  initialApp?: PhoneApp;
  onClose: () => void;
  robinghood: React.ReactNode;
  linkedout: React.ReactNode;
}) {
  const { run, markMailRead } = useGame();
  /**
   * Always starts locked.
   *
   * `initialApp` used to be the opening screen, so tapping a mail notification
   * dropped you straight into the inbox and the phone read as a submenu of the
   * game. Now the deep link is remembered and honoured AFTER the unlock, which
   * keeps the notification useful without giving up the sense that you picked up
   * a device.
   */
  const [screen, setScreen] = useState<Screen>("lock");
  const pendingApp = useRef<PhoneApp | null>(null);
  /** null until mounted — the clock is real, so it cannot be server-rendered. */
  const [now, setNow] = useState<Date | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Every open re-locks. Never resumes wherever it was last left.
  useEffect(() => {
    if (!open) return;
    pendingApp.current = initialApp ?? null;
    setScreen("lock");
  }, [open, initialApp]);

  // A real clock, sampled twice a minute — enough for a status bar, cheap
  // enough to leave running while the phone is up.
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Each app starts at its own top rather than inheriting the last scroll.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [screen]);

  const unread = useMemo(
    () => (run ? inboxFor(run).filter((m) => m.unread).length : 0),
    [run],
  );

  if (!open) return null;

  const clock = now
    ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "--:--";
  // The founder battery is the phone battery. Same tank, one glyph.
  const battery = run ? Math.max(0, Math.min(100, Math.round(run.stats.energy))) : 100;

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <GlassScrim label="Put the phone down" onClose={onClose} />

      <motion.div
        className="relative w-full max-w-sm px-3 py-3"
        initial={{ y: 18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* The one control that is not part of the phone. It floats over the
            frosted game rather than over anything of its own, which is the one
            place on this screen where glass has something to refract. */}
        <div className="flex justify-end pb-2">
          <Glass className="overflow-hidden rounded-full">
            <button
              type="button"
              onClick={onClose}
              className="nv-gc nv-flat rounded-[var(--radius-pill)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-primary)]"
            >
              PUT IT DOWN
            </button>
          </Glass>
        </div>

        <section
          role="dialog"
          aria-modal="true"
          aria-label="Phone"
          className="flex h-[min(72dvh,36rem)] flex-col overflow-hidden rounded-[2.25rem] bg-[var(--sheet)] shadow-[var(--e3)] ring-8 ring-[var(--color-navy)]/90"
        >
          {/* ── Status bar ─────────────────────────────────────────────── */}
          {/* Hidden while locked: the lock screen carries its own clock, and two
              clocks on one screen reads as a bug rather than as a phone. */}
          <div
            className={`flex shrink-0 items-center justify-between px-6 pt-2.5 pb-1.5 ${
              screen === "lock" ? "hidden" : ""
            }`}
          >
            <span className="tnum text-2xs font-bold text-[var(--text)]">
              {clock}
            </span>
            <span
              role="img"
              className="flex items-center gap-1.5"
              aria-label={`Battery ${battery} percent`}
            >
              <span className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
                {battery}
              </span>
              <BatteryGlyph level={battery} />
            </span>
          </div>

          {/* ── Body ───────────────────────────────────────────────────── */}
          <div
            ref={bodyRef}
            className={`min-h-0 flex-1 ${screen === "lock" ? "overflow-hidden" : "overflow-y-auto"}`}
          >
            {screen === "lock" && (
              <LockScreen
                onUnlock={() => {
                  const target = pendingApp.current;
                  pendingApp.current = null;
                  setScreen(target ?? "home");
                }}
              />
            )}
            {screen === "home" && (
              <HomeScreen
                unread={unread}
                stamp={run ? `${run.companyName} · FY${run.year} · ${MONTH_NAMES[run.month - 1]}` : null}
                onOpen={setScreen}
              />
            )}
            {screen === "beemail" && <BeeMail onRead={markMailRead} />}
            {screen === "robinghood" && robinghood}
            {screen === "linkedout" && linkedout}
            {screen === "coldcall" && <ColdCall />}
          </div>

          {/* ── Home affordance ────────────────────────────────────────── */}
          {/* Suppressed while locked — LockScreen owns the swipe target there,
              and two stacked pills competing for the same gesture is worse than
              none. */}
          <div className={`shrink-0 px-6 pt-1 pb-2 ${screen === "lock" ? "hidden" : ""}`}>
            <button
              type="button"
              onClick={() => (screen === "home" ? onClose() : setScreen("home"))}
              aria-label={screen === "home" ? "Put the phone down" : "Back to home screen"}
              className="mx-auto flex h-8 w-full max-w-[10rem] items-center justify-center rounded-full transition-transform duration-150 active:scale-[0.97]"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-28 rounded-full bg-[var(--color-navy)]/25"
              />
            </button>
          </div>
        </section>
      </motion.div>
    </motion.div>
  );
}

/**
 * The home screen.
 *
 * Wallpapered, because a phone home screen with a themed flat background is a
 * settings page. The artwork is the same shark that fronts the app, standing on a
 * cliff — its top two thirds are open sky, which is where the icons go, and that
 * is why this particular image works as a wallpaper rather than as decoration.
 *
 * ── Reading iOS honestly ───────────────────────────────────────────────────
 *
 * Four icons a row, squircle tiles, labels in white with a shadow rather than a
 * plate behind them, and a frosted dock pinned to the bottom. What is NOT copied
 * is the icon count: there are four apps, so there is one row and a dock, and
 * padding the grid with dead tiles to look more like a real phone would be a lie
 * about what the game contains.
 *
 * The company stamp replaces the widget row. It is the one piece of Novus chrome
 * allowed on this screen, because a founder's phone showing the fiscal month is
 * in-fiction — and it keeps the player oriented after a lock-screen detour.
 */
function HomeScreen({
  unread,
  stamp,
  onOpen,
}: {
  unread: number;
  stamp: string | null;
  onOpen: (app: PhoneApp) => void;
}) {
  const dock = APPS.filter((a) => a.id === "beemail" || a.id === "coldcall");
  const grid = APPS.filter((a) => !dock.includes(a));

  return (
    <motion.div
      className="relative flex h-full min-h-full flex-col bg-cover bg-center"
      style={{ backgroundImage: "url(/phone/home-wallpaper.png)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22 }}
    >
      {/* Keeps white labels legible over the bright sky at the top of the art. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/20 to-transparent"
      />

      <div className="relative px-5 pt-4">
        {stamp && (
          <p
            className="mb-5 truncate text-center text-2xs font-bold tracking-[0.14em] text-white/90"
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.45)" }}
          >
            {stamp.toUpperCase()}
          </p>
        )}

        <ul className="grid grid-cols-4 gap-x-3 gap-y-5">
          {grid.map((app) => (
            <AppIcon key={app.id} app={app} badge={0} onOpen={onOpen} />
          ))}
        </ul>
      </div>

      {/* The dock. Mail and The Room are the two apps you reach for, so they get
          the thumb-reachable row. */}
      <div className="relative mt-auto px-4 pb-3">
        {/*
          One of the five surfaces design.md names, and the last place in the
          app still hand-rolling a `backdrop-blur`. Routed through the one
          component now — with the dock's own white tint kept, because this is
          another company's OS inside the game world and its glass should not
          re-point with our theme.
        */}
        <Glass
          className="rounded-[1.6rem] px-3 py-3 [--glass-ring:oklch(1_0_0_/_0.18)] [--glass-specular:oklch(1_0_0_/_0.5)] [--glass-tint:oklch(1_0_0_/_0.22)] [--glass-underside:oklch(0_0_0_/_0.12)]"
        >
          <ul className="grid grid-cols-4 gap-x-3">
            {dock.map((app) => (
              <AppIcon
                key={app.id}
                app={app}
                badge={app.id === "beemail" ? unread : 0}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </Glass>
      </div>
    </motion.div>
  );
}

function AppIcon({
  app,
  badge,
  onOpen,
}: {
  app: (typeof APPS)[number];
  badge: number;
  onOpen: (app: PhoneApp) => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(app.id)}
        aria-label={badge > 0 ? `${app.name}, ${badge} unread` : app.name}
        className="flex w-full min-w-0 flex-col items-center gap-1.5"
      >
        <span className="relative block w-full">
          <span
            // iOS uses a squircle, not a rounded rect. 28% of the tile is the
            // closest a single border-radius gets to that curve.
            className="flex aspect-square w-full items-center justify-center rounded-[28%] text-white shadow-[0_2px_10px_rgba(0,0,0,0.28)] transition-transform duration-150 active:scale-[0.9]"
            style={{ background: app.tint }}
          >
            {app.glyph}
          </span>
          {badge > 0 && (
            <span
              aria-hidden="true"
              className="tnum absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-2xs font-extrabold text-white ring-2 ring-white/70"
              style={{ background: "var(--alert)" }}
            >
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </span>
        <span
          className="block w-full truncate text-center text-2xs font-semibold text-white"
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.55)" }}
        >
          {app.name}
        </span>
      </button>
    </li>
  );
}

function BatteryGlyph({ level }: { level: number }) {
  const width = Math.max(1.5, (level / 100) * 16);
  return (
    <svg viewBox="0 0 26 13" className="h-3 w-[26px]" aria-hidden="true" fill="none">
      <rect
        x="0.9"
        y="0.9"
        width="20.2"
        height="11.2"
        rx="3.2"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.2"
        className="text-[var(--text)]"
      />
      <rect
        x="3"
        y="3"
        width={width}
        height="7"
        rx="1.6"
        fill={level < 20 ? "var(--alert)" : "var(--text)"}
      />
      <path
        d="M23.4 4.6v3.8a2 2 0 0 0 0-3.8Z"
        fill="currentColor"
        fillOpacity="0.35"
        className="text-[var(--text)]"
      />
    </svg>
  );
}
