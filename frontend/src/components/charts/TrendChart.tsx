"use client";

import { useId, useState } from "react";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { useMeasure } from "./useMeasure";

export interface TrendPoint {
  label: string; // x-axis label
  title: string; // tooltip heading
  value: number | null;
}

/** Single-series line + area wash with crosshair tooltip. */
export function TrendChart({
  data,
  height = 170,
  domain,
  ticks,
  format = (v: number) => v.toFixed(1),
  seriesLabel,
  color = "var(--accent)",
}: {
  data: TrendPoint[];
  height?: number;
  domain?: [number, number];
  ticks?: number[];
  format?: (v: number) => string;
  seriesLabel: string;
  color?: string;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const values = data.map((d) => d.value).filter((v): v is number => v != null);
  const pad = { top: 10, right: 34, bottom: 24, left: 6 };
  const [lo, hi] = domain ?? niceDomain(values);
  const yTicks = ticks ?? [lo, lo + (hi - lo) / 2, hi];
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (innerW * i) / (data.length - 1));
  const y = (v: number) => pad.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  const defined = data.map((d, i) => (d.value == null ? null : ([x(i), y(d.value)] as const)));
  const line = defined.filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p![0]},${p![1]}`).join(" ");
  const first = defined.find(Boolean);
  const last = [...defined].reverse().find(Boolean);
  const area = first && last ? `${line} L${last[0]},${pad.top + innerH} L${first[0]},${pad.top + innerH} Z` : "";
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 70))));

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${seriesLabel} trend`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            if (!data.length) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left - pad.left;
            setHover(Math.max(0, Math.min(data.length - 1, Math.round((px / (innerW || 1)) * (data.length - 1)))));
          }}>
          <defs>
            <linearGradient id={`area-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={width - 2} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted)" className="tnum">
                {format(t)}
              </text>
            </g>
          ))}
          {area && <path d={area} fill={`url(#area-${uid})`} />}
          {line && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {last && <circle cx={last[0]} cy={last[1]} r={4} fill={color} stroke="var(--panel)" strokeWidth={2} />}
          {data.map((d, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--muted)">
                {d.label}
              </text>
            ) : null,
          )}
          {hover !== null && defined[hover] && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="var(--border-strong)" strokeWidth={1} />
              <circle cx={defined[hover]![0]} cy={defined[hover]![1]} r={5} fill={color} stroke="var(--panel)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {hover !== null && data[hover] && width > 0 && (
        <ChartTooltip x={x(hover)} y={data[hover].value == null ? pad.top : y(data[hover].value!)} width={width}>
          <div className="mb-1 max-w-[220px] truncate font-medium text-text">{data[hover].title}</div>
          <TooltipRow color={color} label={seriesLabel} value={data[hover].value == null ? "—" : format(data[hover].value!)} />
        </ChartTooltip>
      )}
    </div>
  );
}

function niceDomain(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.1 || 1;
  return [Math.max(0, Math.floor((min - span * 0.6) * 10) / 10), Math.ceil((max + span * 0.6) * 10) / 10];
}

/** Tiny inline trend line for stat tiles. */
export function Sparkline({ values, color = "var(--accent)", height = 36 }: { values: number[]; color?: string; height?: number }) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  if (values.length < 2) return <div ref={ref} style={{ height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => 2 + ((width - 6) * i) / (values.length - 1);
  const y = (v: number) => 4 + (height - 8) * (1 - (v - lo) / (hi - lo || 1));
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <div ref={ref} style={{ height }} aria-hidden>
      {width > 0 && (
        <svg width={width} height={height}>
          <defs>
            <linearGradient id={`spark-${uid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${line} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={`url(#spark-${uid})`} />
          <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" />
          <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3} fill={color} />
        </svg>
      )}
    </div>
  );
}
