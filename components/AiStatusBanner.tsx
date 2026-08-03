"use client";

import { useSyncExternalStore, useState } from "react";

import {
  aiSnapshot,
  keyOf,
  LABEL,
  remedyFor,
  routeOf,
  subscribeAi,
  type AiReport,
} from "@/lib/ai/report";

/**
 * The AI tier, on screen, when it is not working.
 *
 * ── Why this is visible and not a console line ─────────────────────────────
 *
 * Every AI feature here falls back to a complete local one — the browser voice,
 * the browser recogniser, the offline resolver. That is deliberate and it
 * stays. Its cost is that a deploy with no keys, a deploy with a rejected key
 * and a deploy that works perfectly are three states with ONE appearance, and
 * the app has now been shipped twice believing the wrong one. A console line
 * does not fix that on a phone: the Android build sets
 * `webContentsDebuggingEnabled: false`, so there is no console to read.
 *
 * So it goes on the glass.
 *
 * ── The rules it follows ───────────────────────────────────────────────────
 *
 * · It appears ONLY when a feature has actually fallen back. A healthy deploy
 *   renders nothing at all, so this is invisible in the good case rather than
 *   being one more thing to look at.
 * · It never interrupts. Pinned low, above the safe area and the native chrome
 *   rather than over them, and dismissible for the session.
 * · It says what to DO, not what broke. "voice → HTTP 401" is a symptom;
 *   "ELEVENLABS_API_KEY was rejected, ask GET /api/tts why" is a next step.
 *
 * ── Turning it off ─────────────────────────────────────────────────────────
 *
 * `NEXT_PUBLIC_AI_DEBUG=0` removes it from the bundle. Set that before putting
 * this in front of players: they are twelve, the fallback is a real feature,
 * and an amber warning about someone else's API key is not their problem. It
 * is on by default because the failure it catches is one an operator cannot
 * see any other way, and a diagnostic nobody remembers to switch on is the
 * same as no diagnostic.
 */
export function AiStatusBanner() {
  const reports = useSyncExternalStore(subscribeAi, aiSnapshot, aiSnapshot);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  // Compiled out entirely when the flag is off — `process.env.NEXT_PUBLIC_*` is
  // inlined at build time, so this is dead code elimination and not a runtime
  // check that ships the component to players anyway.
  if (process.env.NEXT_PUBLIC_AI_DEBUG === "0") return null;
  if (dismissed) return null;

  // "not attempted yet" is not a fault. Nothing shows until a feature has been
  // asked for and answered — otherwise this would accuse a healthy deploy of
  // being broken for the whole of the main menu.
  const broken = reports.filter((r) => r.using === "local" && r.status !== undefined);
  if (broken.length === 0) return null;

  return (
    <div
      // Above the home indicator and the native tab bar, both of which report
      // their height as CSS variables the rest of the app already uses.
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3"
      style={{ bottom: "calc(var(--nv-chrome-bottom, 0px) + env(safe-area-inset-bottom, 0px) + 12px)" }}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-amber-400/30 bg-[#241f16]/95 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left"
          aria-expanded={open}
        >
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
          <span className="flex-1 text-[13px] font-medium text-amber-100">
            {broken.length === 1
              ? `${LABEL[broken[0].feature]} is using the local fallback`
              : `${broken.length} AI features are using local fallbacks`}
          </span>
          <span aria-hidden className="text-[11px] text-amber-200/60">
            {open ? "hide" : "why"}
          </span>
        </button>

        {open && (
          <div className="space-y-2 border-t border-amber-400/15 px-3 py-2">
            {broken.map((report) => (
              <Row key={report.feature} report={report} />
            ))}
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="w-full rounded-lg bg-white/5 py-1.5 text-[11px] text-amber-200/70"
            >
              Hide for this session
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ report }: { report: AiReport }) {
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="font-medium text-amber-100">
        {LABEL[report.feature]}
        <span className="ml-1.5 font-normal text-amber-200/50">
          {report.status ? `HTTP ${report.status}` : "unreachable"} · {routeOf(report.feature)}
        </span>
      </div>
      <p className="text-amber-200/70">{remedyFor(report)}</p>
      <p className="text-amber-200/40">{keyOf(report.feature)}</p>
    </div>
  );
}
