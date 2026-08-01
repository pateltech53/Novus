"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { SoundToggle } from "@/components/ui/SoundToggle";
import { loadTheme, saveTheme, type ThemeChoice } from "@/lib/theme";

/**
 * Settings.
 *
 * Everything here is about how the player wants to be spoken to, or about their
 * own identity — never about the company's numbers. Nothing in this screen can
 * change an outcome, and the one destructive action is behind a confirm.
 */
export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const game = useGame();
  const { run, profile } = game;

  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [founder, setFounder] = useState(profile?.founderName ?? "");
  const [company, setCompany] = useState(run?.companyName ?? "");
  const [confirmEnd, setConfirmEnd] = useState(false);

  useEffect(() => setTheme(loadTheme()), []);

  const pickTheme = (next: ThemeChoice) => {
    setTheme(next);
    saveTheme(next);
  };

  return (
    <motion.div
      className="fixed inset-0 z-40 overflow-y-auto bg-[var(--bg)]"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      {/* Centred column on desktop rather than a stretched sheet. */}
      <div className="mx-auto w-full max-w-lg px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-extrabold tracking-[-0.01em]">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            className="nv-press h-10 rounded-[var(--radius-pill)] px-4 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
          >
            DONE
          </button>
        </div>

        {/* ── Appearance ─────────────────────────────────────────────────── */}
        <Section label="APPEARANCE">
          <div
            role="radiogroup"
            aria-label="Theme"
            className="grid grid-cols-3 gap-2"
          >
            {(
              [
                { id: "system", label: "System" },
                { id: "light", label: "Light" },
                { id: "dark", label: "Dark" },
              ] as { id: ThemeChoice; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={theme === opt.id}
                onClick={() => pickTheme(opt.id)}
                className={`nv-press rounded-[var(--radius-row)] py-3 text-sm font-bold ${
                  theme === opt.id
                    ? "bg-[var(--surface-elevated)] text-[var(--text-primary)] shadow-[var(--e2)]"
                    : "bg-[var(--surface)] text-[var(--text-tertiary)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-2xs leading-snug text-[var(--text-tertiary)]">
            System follows your phone. Both themes are built and shipped — dark
            is not a debug mode.
          </p>
        </Section>

        {/* ── Sound ──────────────────────────────────────────────────────── */}
        <Section label="SOUND">
          <SoundToggle />
        </Section>

        {/* ── Identity ───────────────────────────────────────────────────── */}
        <Section label="YOU">
          <Field
            id="founder"
            label="Your name"
            value={founder}
            onChange={setFounder}
            placeholder="Founder"
            onCommit={() => game.setFounderName(founder.trim() || "Founder")}
          />
          {run && (
            <div className="mt-2">
              <Field
                id="company"
                label="Company name"
                value={company}
                onChange={setCompany}
                placeholder={run.companyName}
                onCommit={() => game.setCompanyName(company.trim() || run.companyName)}
              />
            </div>
          )}
        </Section>

        {/* ── The one destructive thing on the screen ─────────────────────── */}
        {run && (
          <Section label="THIS RUN">
            <div className="rounded-[var(--radius-row)] bg-[var(--surface)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                End {run.companyName}
              </p>
              <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">
                Closes the company for good and starts a new Founder Run. Your
                legacy — best year, badges, shark respect — carries over. This
                run does not.
              </p>

              {!confirmEnd ? (
                <button
                  type="button"
                  onClick={() => setConfirmEnd(true)}
                  className="nv-press mt-3 h-12 w-full rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-sm font-bold text-[var(--alert)]"
                >
                  End this business
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-2xs font-bold tracking-[0.1em] text-[var(--alert)]">
                    THIS CANNOT BE UNDONE.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      game.endRun();
                      onClose();
                    }}
                    className="nv-press h-12 w-full rounded-[var(--radius-pill)] bg-[var(--alert)] text-sm font-extrabold tracking-[0.04em] text-[var(--on-action)]"
                  >
                    Yes, end {run.companyName}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmEnd(false)}
                    className="nv-press h-11 w-full rounded-[var(--radius-pill)] text-sm font-bold text-[var(--text-secondary)]"
                  >
                    Keep going
                  </button>
                </div>
              )}
            </div>
          </Section>
        )}
      </div>
    </motion.div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
        {label}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onCommit: () => void;
}) {
  return (
    <label
      htmlFor={id}
      className="block rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3"
    >
      <span className="block text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {label.toUpperCase()}
      </span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 28))}
        onBlur={onCommit}
        placeholder={placeholder}
        autoComplete="off"
        className="mt-1 w-full bg-transparent text-base font-semibold text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
      />
    </label>
  );
}
