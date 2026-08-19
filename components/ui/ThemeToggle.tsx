"use client";

import { useEffect, useState } from "react";

import { loadTheme, saveTheme, type ThemeChoice } from "@/lib/theme";

/**
 * The theme switch, outside Settings.
 *
 * Settings has owned the three-way picker since the theme shipped, and that is
 * still the place a player sets the app up. But Settings is inside the game,
 * behind an account — which leaves the two surfaces a person meets BEFORE they
 * are a player, or while they are working rather than playing, with no way to
 * change the light in the room: the front page and the operator's console.
 * This is that switch, and it writes the same `novus:theme:v1` key the picker
 * in Settings does, so a choice made on either is the choice everywhere.
 *
 * ── Why the state is read in an effect ──────────────────────────────────────
 *
 * The stored choice lives in localStorage, which the server cannot see. Reading
 * it during render would make the first client render disagree with the HTML
 * that arrived and React would throw the whole subtree away. So the control
 * mounts on `system` and corrects itself immediately after — invisible, because
 * the blocking script in <head> has already painted the right theme (the
 * ATTRIBUTE is correct from the first frame; only this control's own highlight
 * arrives a tick later).
 */

const OPTIONS: { id: ThemeChoice; label: string; hint: string }[] = [
  { id: "system", label: "AUTO", hint: "Follow the system" },
  { id: "light", label: "LIGHT", hint: "Always light" },
  { id: "dark", label: "DARK", hint: "Always dark" },
];

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(loadTheme());
    setMounted(true);
  }, []);

  /*
   * `system` is a promise to keep following, not a snapshot of what the OS said
   * once. Without this listener a visitor sitting on the page at sunset — when
   * both macOS and iOS flip themselves — keeps the theme they arrived in until
   * they reload, which is the one moment the automatic setting exists for.
   */
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => saveTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const pick = (next: ThemeChoice) => {
    setTheme(next);
    saveTheme(next);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex items-center gap-0.5 rounded-[var(--radius-pill)] border border-[var(--hairline)] p-0.5 ${className}`}
    >
      {OPTIONS.map((opt) => {
        // Before the effect runs nothing is selected rather than the wrong
        // thing being selected: a highlight that jumps on hydration is worse
        // than one that arrives.
        const on = mounted && theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={opt.hint}
            onClick={() => pick(opt.id)}
            className={`rounded-[var(--radius-pill)] px-2.5 py-1 text-2xs font-bold tracking-[0.1em] transition-colors ${
              on
                ? "bg-[var(--text-primary)] text-[var(--n-1)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
