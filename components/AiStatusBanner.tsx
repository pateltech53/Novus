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
 * ── When it is in the bundle at all ────────────────────────────────────────
 *
 * Dev builds: on unless `NEXT_PUBLIC_AI_DEBUG=0` — the operator wiring keys up
 * is exactly who needs it. Production builds: OFF unless `NEXT_PUBLIC_AI_DEBUG=1`
 * — the audience there is players (who are twelve, for whom the fallback is a
 * real feature and someone else's API key is not their problem) and demos,
 * where an amber warning is a defect. It used to default ON everywhere so that
 * a misconfigured deploy would confess; that job is done by `GET /api/ai`,
 * which reports the same facts without requiring anyone to remember an env
 * var before a launch. Set `NEXT_PUBLIC_AI_DEBUG=1` on a staging deploy to get
 * the on-glass banner back.
 */
export function AiStatusBanner() {
  const reports = useSyncExternalStore(subscribeAi, aiSnapshot, aiSnapshot);
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  // Compiled out entirely when off — both env vars are inlined at build time,
  // so this is dead code elimination and not a runtime check that ships the
  // component to players anyway.
  const enabled =
    process.env.NEXT_PUBLIC_AI_DEBUG === "1" ||
    (process.env.NEXT_PUBLIC_AI_DEBUG !== "0" && process.env.NODE_ENV === "development");
  if (!enabled) return null;
  if (dismissed) return null;

  // "not attempted yet" is not a fault. Nothing shows until a feature has been
  // asked for and answered — otherwise this would accuse a healthy deploy of
  // being broken for the whole of the main menu.
  const broken = reports.filter((r) => r.using === "local" && r.status !== undefined);
  if (broken.length === 0) return null;

  return (
    <div
      // Pinned TOP. The bottom pin only cleared the NATIVE chrome — on web
      // and Android the DOM dock (ADVANCE MONTH + tab bar) reserves its own
      // in-flow height that no variable reports, so the banner sat directly
      // on the one control that moves time. No route puts chrome at the top.
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3"
      style={{ top: "calc(var(--nv-chrome-top, 0px) + var(--nv-safe-top))" }}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto w-full max-w-md rounded-[var(--radius-card)] border border-amber-400/30 bg-[#241f16]/95 shadow-lg backdrop-blur-sm">
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
              className="w-full rounded-[var(--radius-row)] bg-white/5 py-1.5 text-[11px] text-amber-200/70"
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
