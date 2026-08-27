"use client";

import { useCallback, useRef, useState } from "react";

/**
 * The admin console's charts. Hand-rolled SVG — no chart library, because the
 * bundle has none and four small forms do not justify one.
 *
 * The rules these follow (the dataviz method, applied):
 *   · colors come from --viz-* in globals.css, validated per theme against
 *     the card surface each mode renders on; series identity never rides on
 *     color alone — every multi-series chart has a legend AND end labels,
 *     every chart has an AS-A-TABLE view (which is also the relief for the
 *     light magenta's sub-3:1 contrast);
 *   · thin marks, value-end-only 2px rounding anchored to the baseline, 2px
 *     lines, ≥8px hover markers with a 2px surface ring, one axis, recessive
 *     hairline grid, text in ink tokens with tabular figures on ticks;
 *   · hover/touch is not optional: bars and lines carry a full-height hit
 *     lane per x position and a shared tooltip.
 *
 * Sizing: SVGs are drawn at the container's measured pixel width (a
 * ResizeObserver, not viewBox scaling) so ticks and labels stay crisp at
 * 320px and at desktop widths alike.
 */

// ── Measurement ─────────────────────────────────────────────────────────────

/**
 * A callback ref, not useRef + useEffect: several charts render an empty
 * state until their data arrives, so the measured div may not exist on
 * mount. An effect with [] deps would run against null and never attach;
 * a callback ref attaches the observer whenever the node actually appears
 * and detaches when it goes.
 */
function useMeasuredWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(node);
    roRef.current = ro;
  }, []);
  return [attach, width];
}

// ── Scales and ticks ────────────────────────────────────────────────────────

/** 0 → a "nice" ceiling: 1/2/5 × 10^k, so the top gridline is a round number. */
function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * pow) return m * pow;
  }
  return 10 * pow;
}

const shortDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

// ── Tooltip ─────────────────────────────────────────────────────────────────

interface Tip {
  x: number;
  y: number;
  title: string;
  lines: Array<{ swatch?: string; text: string }>;
}

/** The one tooltip, positioned inside the chart's relative wrapper and
 *  clamped so it never leaves it. */
function TipBox({ tip, width }: { tip: Tip; width: number }) {
  const boxW = 148;
  const left = Math.max(4, Math.min(tip.x + 10, width - boxW - 4));
  /* Clamped vertically too: hovering a value near the baseline would
     otherwise push the box past the 168px plot and over the AS A TABLE
     control below it. Height derived from the line count — a flat clamp
     over-lifts the one-line tips. */
  const boxH = 26 + 18 * tip.lines.length;
  const top = Math.min(Math.max(2, tip.y - 8), PLOT_H - boxH);
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 rounded-[var(--radius-row)] bg-[var(--n-3)] px-2.5 py-1.5 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
      style={{ left, top, width: boxW }}
    >
      <p className="text-2xs font-bold text-[var(--text-primary)]">{tip.title}</p>
      {tip.lines.map((l, i) => (
        <p key={i} className="tnum flex items-center gap-1.5 text-2xs text-[var(--text-secondary)]">
          {l.swatch && (
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: l.swatch }}
            />
          )}
          {l.text}
        </p>
      ))}
    </div>
  );
}

// ── Shell: title, legend, plot, table view ──────────────────────────────────

export function ChartShell({
  title,
  note,
  legend,
  table,
  children,
}: {
  title: string;
  note?: string;
  legend?: Array<{ swatch: string; label: string }>;
  table: { head: string[]; rows: Array<Array<string | number>> };
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-2xs font-extrabold tracking-[0.1em]">{title}</h3>
        {legend && legend.length > 1 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 text-2xs text-[var(--text-secondary)]">
                <span aria-hidden className="inline-block h-2 w-2 rounded-[2px]" style={{ background: l.swatch }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {note && <p className="mt-1 text-2xs leading-relaxed text-[var(--text-tertiary)]">{note}</p>}
      <div className="mt-2">{children}</div>
      <details className="mt-2">
        <summary className="cursor-pointer text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          AS A TABLE
        </summary>
        <div className="mt-1 max-h-48 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-2xs">
            <thead>
              <tr>
                {/* Column 0 is the label; every other column is a figure and
                    right-aligns so the tabular digits share an edge. */}
                {table.head.map((h, j) => (
                  <th
                    key={h}
                    className={`border-b border-[var(--hairline)] py-1 pr-3 font-bold text-[var(--text-tertiary)]${j > 0 ? " text-right" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td
                      key={j}
                      className={`tnum border-b border-[var(--hairline)] py-1 pr-3 text-[var(--text-secondary)]${j > 0 ? " text-right" : ""}`}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex h-[168px] items-center justify-center px-4 text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
      {children}
    </p>
  );
}

// ── Daily bars — one series over days ───────────────────────────────────────

const M = { top: 14, right: 8, bottom: 18, left: 30 };
const PLOT_H = 168;

export function DailyBars({
  data,
  color = "var(--viz-1)",
  unit = "",
}: {
  data: Array<{ day: string; value: number }>;
  color?: string;
  unit?: string;
}) {
  const [ref, width] = useMeasuredWidth();
  const [tip, setTip] = useState<Tip | null>(null);

  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = PLOT_H - M.top - M.bottom;
  const n = data.length;
  const slot = n > 0 ? innerW / n : 0;
  const gap = slot > 4 ? 2 : 1;
  const barW = Math.max(1, slot - gap);
  const y = (v: number) => M.top + innerH - (v / max) * innerH;

  const everyNth = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 72))));
  const maxIdx = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const total = data.reduce((s, d) => s + d.value, 0);

  const hover = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (n === 0) return;
      const i = Math.min(n - 1, Math.max(0, Math.floor((clientX - rect.left - M.left) / slot)));
      const d = data[i];
      setTip({
        x: M.left + i * slot + slot / 2,
        y: y(d.value) - 10,
        title: shortDay(d.day),
        lines: [{ swatch: color, text: `${d.value}${unit}` }],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, slot, data, color, unit, max, innerH],
  );

  if (total === 0) return <Empty>Nothing in this window yet.</Empty>;

  return (
    <div ref={ref} className="relative">
      {tip && <TipBox tip={tip} width={width} />}
      <svg
        width={width}
        height={PLOT_H}
        role="img"
        onPointerMove={(e) => hover(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setTip(null)}
      >
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={M.left} x2={width - M.right} y1={y(max * f)} y2={y(max * f)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={M.left - 5} y={y(max * f) + 3} textAnchor="end" className="tnum" fontSize={10} fill="var(--viz-muted)">
              {max * f}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={width - M.right} y1={M.top + innerH} y2={M.top + innerH} stroke="var(--viz-grid)" strokeWidth={1} />

        {data.map((d, i) => {
          if (d.value <= 0) return null;
          const bx = M.left + i * slot + gap / 2;
          const by = y(d.value);
          const r = Math.min(2, barW / 2);
          const path = `M ${bx} ${M.top + innerH} V ${by + r} Q ${bx} ${by} ${bx + r} ${by} H ${bx + barW - r} Q ${bx + barW} ${by} ${bx + barW} ${by + r} V ${M.top + innerH} Z`;
          return <path key={d.day} d={path} fill={color} />;
        })}

        {/* The one direct label: the window's peak. */}
        {data[maxIdx].value > 0 && (
          <text
            x={Math.min(width - M.right - 8, Math.max(M.left + 8, M.left + maxIdx * slot + slot / 2))}
            y={y(data[maxIdx].value) - 4}
            textAnchor="middle"
            className="tnum"
            fontSize={10}
            fontWeight={700}
            fill="var(--text-secondary)"
          >
            {data[maxIdx].value}
          </text>
        )}

        {data.map((d, i) =>
          i % everyNth === 0 ? (
            <text
              key={`t${d.day}`}
              x={M.left + i * slot + slot / 2}
              y={PLOT_H - 4}
              textAnchor="middle"
              fontSize={10}
              fill="var(--viz-muted)"
            >
              {shortDay(d.day)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

// ── Dual lines — two tracked series with gaps ───────────────────────────────

export function DualLines({
  data,
  aLabel,
  bLabel,
}: {
  data: Array<{ day: string; a: number | null; b: number | null }>;
  aLabel: string;
  bLabel: string;
}) {
  const [ref, width] = useMeasuredWidth();
  const [tip, setTip] = useState<Tip | null>(null);

  const tracked = data.filter((d) => d.a != null || d.b != null);
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.a ?? 0, d.b ?? 0))));
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = PLOT_H - M.top - M.bottom;
  const n = data.length;
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + innerH - (v / max) * innerH;

  const segments = (pick: (d: (typeof data)[number]) => number | null): string[] => {
    const out: string[] = [];
    let seg = "";
    data.forEach((d, i) => {
      const v = pick(d);
      if (v == null) {
        if (seg) out.push(seg);
        seg = "";
        return;
      }
      seg += `${seg ? " L" : "M"} ${x(i)} ${y(v)}`;
    });
    if (seg) out.push(seg);
    return out;
  };

  const [hoverI, setHoverI] = useState<number | null>(null);
  const everyNth = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 72))));

  const hover = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (n === 0) return;
      const rel = clientX - rect.left - M.left;
      const i = Math.min(n - 1, Math.max(0, Math.round((rel / Math.max(1, innerW)) * (n - 1))));
      const d = data[i];
      setHoverI(i);
      setTip({
        x: x(i),
        y: Math.min(y(d.a ?? 0), y(d.b ?? 0)) - 12,
        title: shortDay(d.day),
        lines: [
          { swatch: "var(--viz-1)", text: `${aLabel}: ${d.a ?? "not tracked"}` },
          { swatch: "var(--viz-2)", text: `${bLabel}: ${d.b ?? "not tracked"}` },
        ],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, innerW, data, aLabel, bLabel, max],
  );

  if (tracked.length === 0) {
    return (
      <Empty>
        This series builds itself — every console visit records the day&rsquo;s
        active players and run starts. Come back tomorrow and the line begins.
      </Empty>
    );
  }

  const lastA = [...data].reverse().find((d) => d.a != null);
  const lastB = [...data].reverse().find((d) => d.b != null);

  /* The two direct labels are right-anchored at the same x, so when the lines
     end within a text height of each other the fixed −6/+12 offsets collide.
     Clamp each into the plot first, then push B a line away from A — flipping
     above when the bottom bound is hit. */
  const clampLabelY = (v: number) => Math.max(M.top + 8, Math.min(M.top + innerH - 2, v));
  const labelYA = lastA ? clampLabelY(y(lastA.a!) - 6) : 0;
  let labelYB = lastB ? clampLabelY(y(lastB.b!) + 12) : 0;
  if (lastA && lastB && Math.abs(labelYA - labelYB) < 11) {
    labelYB = labelYA + 11;
    if (labelYB > M.top + innerH - 2) labelYB = labelYA - 11;
  }

  return (
    <div ref={ref} className="relative">
      {tip && <TipBox tip={tip} width={width} />}
      <svg
        width={width}
        height={PLOT_H}
        role="img"
        onPointerMove={(e) => hover(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => {
          setTip(null);
          setHoverI(null);
        }}
      >
        {[0.5, 1].map((f) => (
          <g key={f}>
            <line x1={M.left} x2={width - M.right} y1={y(max * f)} y2={y(max * f)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={M.left - 5} y={y(max * f) + 3} textAnchor="end" className="tnum" fontSize={10} fill="var(--viz-muted)">
              {max * f}
            </text>
          </g>
        ))}
        <line x1={M.left} x2={width - M.right} y1={M.top + innerH} y2={M.top + innerH} stroke="var(--viz-grid)" strokeWidth={1} />

        {hoverI != null && (
          <line x1={x(hoverI)} x2={x(hoverI)} y1={M.top} y2={M.top + innerH} stroke="var(--viz-grid)" strokeWidth={1} />
        )}

        {segments((d) => d.a).map((p, i) => (
          <path key={`a${i}`} d={p} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinecap="round" />
        ))}
        {segments((d) => d.b).map((p, i) => (
          <path key={`b${i}`} d={p} fill="none" stroke="var(--viz-2)" strokeWidth={2} strokeLinecap="round" />
        ))}

        {hoverI != null && data[hoverI].a != null && (
          <circle cx={x(hoverI)} cy={y(data[hoverI].a!)} r={4} fill="var(--viz-1)" stroke="var(--n-3)" strokeWidth={2} />
        )}
        {hoverI != null && data[hoverI].b != null && (
          <circle cx={x(hoverI)} cy={y(data[hoverI].b!)} r={4} fill="var(--viz-2)" stroke="var(--n-3)" strokeWidth={2} />
        )}

        {/* Direct labels at each line's last tracked point. */}
        {lastA && (
          <text x={Math.min(x(data.indexOf(lastA)), width - M.right - 2)} y={labelYA} textAnchor="end" fontSize={10} fontWeight={700} fill="var(--text-secondary)">
            {aLabel}
          </text>
        )}
        {lastB && (
          <text x={Math.min(x(data.indexOf(lastB)), width - M.right - 2)} y={labelYB} textAnchor="end" fontSize={10} fontWeight={700} fill="var(--text-secondary)">
            {bLabel}
          </text>
        )}

        {data.map((d, i) =>
          i % everyNth === 0 ? (
            <text key={`t${d.day}`} x={x(i)} y={PLOT_H - 4} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
              {shortDay(d.day)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

// ── Weekly percent bars — cohort retention (2 series) or bounce (1) ─────────

export interface WeeklyBar {
  week: string;
  /** 0–100, or null when the cohort has not lived through the window yet. */
  a: number | null;
  b?: number | null;
  /** Tooltip detail, e.g. "3 of 12". */
  aDetail?: string;
  bDetail?: string;
}

export function WeeklyPercentBars({
  data,
  aLabel,
  bLabel,
}: {
  data: WeeklyBar[];
  aLabel: string;
  bLabel?: string;
}) {
  const [ref, width] = useMeasuredWidth();
  const [tip, setTip] = useState<Tip | null>(null);

  const two = bLabel != null;
  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = PLOT_H - M.top - M.bottom;
  const n = data.length;
  const slot = n > 0 ? innerW / n : 0;
  const y = (v: number) => M.top + innerH - (v / 100) * innerH;

  const hover = useCallback(
    (clientX: number, rect: DOMRect) => {
      if (n === 0) return;
      const i = Math.min(n - 1, Math.max(0, Math.floor((clientX - rect.left - M.left) / slot)));
      const d = data[i];
      const fmt = (v: number | null, detail?: string) =>
        v == null ? "too young for this window" : `${v}%${detail ? ` (${detail})` : ""}`;
      setTip({
        x: M.left + i * slot + slot / 2,
        y: y(Math.max(d.a ?? 0, d.b ?? 0)) - 10,
        title: `week of ${shortDay(d.week)}`,
        lines: two
          ? [
              { swatch: "var(--viz-1)", text: `${aLabel}: ${fmt(d.a, d.aDetail)}` },
              { swatch: "var(--viz-2)", text: `${bLabel!}: ${fmt(d.b ?? null, d.bDetail)}` },
            ]
          : [{ swatch: "var(--viz-1)", text: `${aLabel}: ${fmt(d.a, d.aDetail)}` }],
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, slot, data, aLabel, bLabel, two],
  );

  if (data.every((d) => d.a == null && (d.b ?? null) == null)) {
    return <Empty>No cohort has lived long enough to answer this yet.</Empty>;
  }

  const groupW = Math.max(2, slot - (slot > 8 ? 4 : 2));
  const barW = two ? Math.max(1, (groupW - 2) / 2) : groupW;
  const everyNth = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 76))));

  const bar = (cx: number, v: number, color: string, key: string) => {
    const by = y(v);
    const r = Math.min(2, barW / 2);
    const h = M.top + innerH - by;
    if (h <= 0) {
      // A true zero still deserves a mark — a 2px stub, so "0%" and "no
      // data" never look alike.
      return <rect key={key} x={cx} y={M.top + innerH - 2} width={barW} height={2} fill={color} />;
    }
    return (
      <path
        key={key}
        d={`M ${cx} ${M.top + innerH} V ${by + r} Q ${cx} ${by} ${cx + r} ${by} H ${cx + barW - r} Q ${cx + barW} ${by} ${cx + barW} ${by + r} V ${M.top + innerH} Z`}
        fill={color}
      />
    );
  };

  return (
    <div ref={ref} className="relative">
      {tip && <TipBox tip={tip} width={width} />}
      <svg
        width={width}
        height={PLOT_H}
        role="img"
        onPointerMove={(e) => hover(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setTip(null)}
      >
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={M.left} x2={width - M.right} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" strokeWidth={1} />
            <text x={M.left - 5} y={y(v) + 3} textAnchor="end" className="tnum" fontSize={10} fill="var(--viz-muted)">
              {v}%
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const gx = M.left + i * slot + (slot - groupW) / 2;
          return (
            <g key={d.week}>
              {d.a != null && bar(gx, d.a, "var(--viz-1)", `a${d.week}`)}
              {two && d.b != null && bar(gx + barW + 2, d.b, "var(--viz-2)", `b${d.week}`)}
              {d.a == null && (d.b ?? null) == null && (
                <text x={gx + groupW / 2} y={M.top + innerH - 4} textAnchor="middle" fontSize={10} fill="var(--viz-muted)">
                  ·
                </text>
              )}
            </g>
          );
        })}

        {data.map((d, i) =>
          i % everyNth === 0 ? (
            <text
              key={`t${d.week}`}
              x={M.left + i * slot + slot / 2}
              y={PLOT_H - 4}
              textAnchor="middle"
              fontSize={10}
              fill="var(--viz-muted)"
            >
              {shortDay(d.week)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

// ── Recency bars — the last-seen histogram, ramped ──────────────────────────

export function RecencyBars({
  buckets,
}: {
  buckets: Array<{ label: string; value: number; color: string }>;
}) {
  const [ref, width] = useMeasuredWidth();
  const total = buckets.reduce((s, b) => s + b.value, 0);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const labelW = 88;
  const valueW = 76;
  const barMax = Math.max(0, width - labelW - valueW);
  const rowH = 26;

  if (total === 0) return <Empty>No accounts yet.</Empty>;

  return (
    <div ref={ref}>
      <svg width={width} height={buckets.length * rowH + 4} role="img">
        {buckets.map((b, i) => {
          const w = Math.max(b.value > 0 ? 3 : 0, (b.value / max) * barMax);
          const cy = i * rowH + rowH / 2 + 2;
          const r = 2;
          return (
            <g key={b.label}>
              <text x={0} y={cy + 3} fontSize={10} fontWeight={700} fill="var(--text-secondary)">
                {b.label}
              </text>
              {b.value > 0 && (
                <path
                  d={`M ${labelW} ${cy - 7} H ${labelW + w - r} Q ${labelW + w} ${cy - 7} ${labelW + w} ${cy - 7 + r} V ${cy + 7 - r} Q ${labelW + w} ${cy + 7} ${labelW + w - r} ${cy + 7} H ${labelW} Z`}
                  fill={b.color}
                />
              )}
              {/* Direct labels on every row — this chart's identity channel
                  is position, and its values are the point. */}
              <text x={labelW + w + 6} y={cy + 3} className="tnum" fontSize={10} fill="var(--text-secondary)">
                {b.value} · {Math.round((b.value / total) * 100)}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
