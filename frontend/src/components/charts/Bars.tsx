"use client";

import { useState } from "react";
import type { Span, Trace } from "@/lib/api";
import { ms } from "@/lib/format";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { useMeasure } from "./useMeasure";

/**
 * Mirrored "signal" feed of recent query latencies (newest on the right). Bar height is
 * latency; failed queries are drawn in the critical color.
 */
export function TraceFeed({ traces, height = 110 }: { traces: Trace[]; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const items = [...traces].reverse();
  const max = Math.max(...items.map((t) => t.duration_ms), 1);
  const gap = 2;
  const barW = items.length ? Math.max(2, Math.min(8, (width - gap * items.length) / items.length)) : 0;
  const total = items.length * (barW + gap);
  const offset = Math.max(0, (width - total) / 2);
  const mid = height / 2;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Recent query latency feed">
          <line x1={0} x2={width} y1={mid} y2={mid} stroke="var(--grid)" />
          {items.map((t, i) => {
            const h = Math.max(3, (t.duration_ms / max) * (height - 12));
            const xPos = offset + i * (barW + gap);
            const color = t.status === "error" ? "var(--critical)" : i === items.length - 1 ? "var(--accent)" : "rgba(34,211,238,0.55)";
            return (
              <g key={t.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={xPos - 1} y={0} width={barW + gap} height={height} fill="transparent" />
                <rect x={xPos} y={mid - h / 2} width={barW} height={h} rx={Math.min(2, barW / 2)} fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.45} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && items[hover] && (
        <ChartTooltip x={offset + hover * (barW + gap)} y={8} width={width}>
          <div className="mb-1 max-w-[240px] truncate font-medium text-text">{items[hover].question}</div>
          <TooltipRow label="Latency" value={ms(items[hover].duration_ms)} />
          <TooltipRow label="Status" value={items[hover].status} />
          <TooltipRow label="Source" value={items[hover].source} />
        </ChartTooltip>
      )}
    </div>
  );
}

/** Column path with a 4px rounded data-end and a square baseline. */
function roundedTop(x: number, base: number, w: number, h: number) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + w - r} Q${x + w},${base - h} ${x + w},${base - h + r} V${base} Z`;
}

/** Latency histogram (one series, bucketed). */
export function Histogram({
  buckets,
  height = 200,
}: {
  buckets: { from_ms: number; to_ms: number | null; count: number }[];
  height?: number;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { top: 18, bottom: 22 };
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const slot = buckets.length ? width / buckets.length : 0;
  const barW = Math.min(24, slot - 6);
  const innerH = height - pad.top - pad.bottom;
  const label = (b: { from_ms: number; to_ms: number | null }) => (b.to_ms == null ? `≥${ms(b.from_ms)}` : `<${ms(b.to_ms)}`);

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Latency distribution">
          <line x1={0} x2={width} y1={pad.top + innerH} y2={pad.top + innerH} stroke="var(--grid)" />
          {buckets.map((b, i) => {
            const h = (b.count / max) * innerH;
            const xPos = i * slot + (slot - barW) / 2;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
                {b.count > 0 && (
                  <path
                    d={roundedTop(xPos, pad.top + innerH, barW, Math.max(h, 2))}
                    fill="var(--accent)" opacity={hover === null || hover === i ? 0.85 : 0.4}
                  />
                )}
                {b.count > 0 && h > 0 && (
                  <text x={xPos + barW / 2} y={pad.top + innerH - h - 5} textAnchor="middle" fontSize={10} fill="var(--text-2)" className="tnum">
                    {b.count}
                  </text>
                )}
                {(i % 2 === 0 || slot > 60) && (
                  <text x={i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize={9.5} fill="var(--muted)">
                    {label(b)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && buckets[hover] && (
        <ChartTooltip x={hover * slot + slot / 2} y={pad.top} width={width}>
          <div className="mb-1 font-medium text-text">
            {ms(buckets[hover].from_ms)} – {buckets[hover].to_ms == null ? "∞" : ms(buckets[hover].to_ms)}
          </div>
          <TooltipRow label="Queries" value={String(buckets[hover].count)} />
        </ChartTooltip>
      )}
    </div>
  );
}

const SPAN_COLORS: Record<string, string> = {
  retrieval: "var(--series-1)",
  rerank: "var(--series-2)",
  generation: "var(--series-3)",
  evaluation: "var(--series-4)",
};

/** Span waterfall for one trace: each span is offset by its start time. */
export function TraceWaterfall({ spans, total }: { spans: Span[]; total: number }) {
  const scale = Math.max(total, ...spans.map((s) => s.start_ms + s.duration_ms), 0.001);
  return (
    <div className="space-y-2">
      {spans.map((s, i) => (
        <div key={i} className="grid grid-cols-[96px_1fr_70px] items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-text-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: SPAN_COLORS[s.name] ?? "var(--accent)" }} />
            {s.name}
          </span>
          <div className="relative h-3 rounded bg-white/[0.03]">
            <div
              className="absolute top-0 h-3 rounded"
              title={s.error ?? undefined}
              style={{
                left: `${(s.start_ms / scale) * 100}%`,
                width: `max(3px, ${(s.duration_ms / scale) * 100}%)`,
                background: s.status === "error" ? "var(--critical)" : SPAN_COLORS[s.name] ?? "var(--accent)",
              }}
            />
          </div>
          <span className="tnum text-right text-text">{ms(s.duration_ms)}</span>
        </div>
      ))}
    </div>
  );
}
