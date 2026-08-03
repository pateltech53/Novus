"use client";

import { useEffect, useRef } from "react";
import type { LogLine } from "@/lib/engine/types";

/**
 * The life log — the game's memory and the thing users screenshot.
 * Chronological, oldest at top, auto-scrolled to the latest. Decisions and
 * consequences sit on raised rows (the prototype's sheet language); narration
 * stays as plain type so the feed still reads as a story, not a table.
 */
export function LifeLog({ lines }: { lines: LogLine[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = useRef(lines.length);

  useEffect(() => {
    if (lines.length !== count.current) {
      count.current = lines.length;
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [lines.length]);

  return (
    <div className="mx-auto w-full max-w-2xl px-3 pt-3">
      <ol className="space-y-2">
        {lines.map((line) => (
          <li key={line.id}>
            <LogEntry line={line} />
          </li>
        ))}
      </ol>
      <div ref={endRef} className="h-2" />
    </div>
  );
}

function LogEntry({ line }: { line: LogLine }) {
  if (line.kind === "month-rule") {
    return (
      <p className="flex items-center gap-2.5 pt-4 pb-0.5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)] first:pt-0">
        <span>{line.text}</span>
        <span className="h-px flex-1 bg-[var(--hairline)]" aria-hidden="true" />
      </p>
    );
  }

  if (line.kind === "year-open") {
    return (
      <p className="nv-gc nv-flat rounded-[var(--radius-row)] px-3.5 py-3 text-[0.9375rem] font-bold leading-snug text-[var(--text)]">
        {line.text}
      </p>
    );
  }

  /*
   * Why the log's glass is `nv-flat` and the ledger's is not.
   *
   * A blur only buys you something when there is structure behind it to bend.
   * The ledger sits over the masthead's edge and the page's own ground, so it
   * genuinely lenses. The log is a column of cards over one flat fill, where a
   * backdrop pass would resolve to the same colour it started as — and there
   * are dozens of them, scrolling, each one re-rasterising its own patch of
   * background on every frame.
   *
   * So these take the lens without its own backdrop pass: the tint, the crest,
   * the sheen, the rim. Visually identical over a flat ground, and a scroll
   * that stays at sixty.
   */
  // Decisions and their consequences are the record — they get a surface.
  const raised = line.kind === "decision" || line.kind === "consequence" || line.kind === "perform";

  if (raised) {
    return (
      <div className="nv-gc nv-flat rounded-[var(--radius-row)] px-3.5 py-3">
        <p
          className={`text-[0.9375rem] leading-snug ${
            line.kind === "decision"
              ? "font-bold text-[var(--text)]"
              : "text-[var(--text-secondary)]"
          }`}
        >
          {line.kind === "decision" && (
            <span className="mr-1.5 text-[var(--text-tertiary)]" aria-hidden="true">
              ▸
            </span>
          )}
          {line.text}
        </p>
        {line.deltas && line.deltas.length > 0 && <Deltas deltas={line.deltas} />}
      </div>
    );
  }

  const tone =
    line.kind === "milestone"
      ? "text-[var(--color-prestige)] font-bold"
      : line.kind === "system"
        ? "text-[var(--text-tertiary)] italic"
        : "text-[var(--text-secondary)]";

  return (
    <div className="px-1">
      <p className={`text-[0.9375rem] leading-[1.5] ${tone}`}>{line.text}</p>
      {line.deltas && line.deltas.length > 0 && <Deltas deltas={line.deltas} />}
    </div>
  );
}

function Deltas({ deltas }: { deltas: NonNullable<LogLine["deltas"]> }) {
  return (
    <p className="mt-1.5 flex flex-wrap gap-1.5">
      {deltas.map((d, i) => (
        <span
          key={`${d.label}-${i}`}
          className="tnum rounded-md px-1.5 py-0.5 text-2xs font-bold"
          style={
            d.tone === "up"
              ? // Solvency green needs darkening to stay legible on white.
                { background: "color-mix(in oklch, var(--solvency) 18%, transparent)", color: "var(--solvency)" }
              : d.tone === "down"
                ? { background: "color-mix(in oklch, var(--alert) 14%, transparent)", color: "var(--alert)" }
                : { background: "var(--chip)", color: "var(--text-tertiary)" }
          }
        >
          {d.label}
        </span>
      ))}
    </p>
  );
}
