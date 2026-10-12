"use client";

import { useId, useState } from "react";
import { ChartTooltip, TooltipRow } from "./Tooltip";
import { useMeasure } from "./useMeasure";

export interface RadarSeries {
  name: string;
  color: string;
  values: (number | null)[]; // 0..1, aligned with axes
  dashed?: boolean;
  glow?: boolean;
}

/**
 * Radar chart for 0-1 quality metrics. Rings at 25/50/75/100, one polygon per series,
 * hover a vertex for every series' value on that axis.
 */
export function RadarChart({
  axes,
  series,
  height = 380,
  decorative = false,
  targetBand,
  format = (v: number) => (v * 100).toFixed(1),
}: {
  axes: string[];
  series: RadarSeries[];
  height?: number;
  decorative?: boolean;
  /** Shade the ring between this value and 1.0 (e.g. 0.8 = "healthy" zone). */
  targetBand?: number;
  format?: (v: number) => string;
}) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, "");
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(40, Math.min(width / 2 - 120, height / 2 - 46));
  const n = axes.length;

  const point = (i: number, value: number) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + Math.cos(angle) * radius * value, cy + Math.sin(angle) * radius * value] as const;
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Radar chart of ${axes.join(", ")}`}>
          <defs>
            <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id={`orbit-${uid}`} x1="0" x2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
              <stop offset="45%" stopColor="#22d3ee" stopOpacity="0.9" />
              <stop offset="75%" stopColor="#34d399" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
            <radialGradient id={`core-${uid}`}>
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
          </defs>

          <circle cx={cx} cy={cy} r={radius * 1.05} fill={`url(#core-${uid})`} />

          {decorative && (
            <g className="orbit" style={{ transformOrigin: `${cx}px ${cy}px` }} aria-hidden>
              <ellipse
                cx={cx} cy={cy} rx={radius * 1.32} ry={radius * 0.42}
                transform={`rotate(-24 ${cx} ${cy})`}
                fill="none" stroke={`url(#orbit-${uid})`} strokeWidth={2.5} filter={`url(#glow-${uid})`}
              />
              <ellipse
                cx={cx} cy={cy} rx={radius * 1.22} ry={radius * 0.36}
                transform={`rotate(-24 ${cx} ${cy})`}
                fill="none" stroke="#22d3ee" strokeOpacity={0.18} strokeWidth={1}
              />
            </g>
          )}

          {targetBand != null && (
            <path
              d={`${ringPath(cx, cy, radius)} ${ringPath(cx, cy, radius * targetBand)}`}
              fill="var(--good)" fillOpacity={0.05} fillRule="evenodd"
            />
          )}

          {[0.25, 0.5, 0.75, 1].map((r) => (
            <g key={r}>
              <circle cx={cx} cy={cy} r={radius * r} fill="none" stroke="var(--grid)" strokeWidth={1} />
              <text x={cx + 4} y={cy - radius * r + 11} fontSize={9} fill="var(--muted)">
                {r * 100}
              </text>
            </g>
          ))}

          {axes.map((label, i) => {
            const [x, y] = point(i, 1);
            const [lx, ly] = point(i, 1.16);
            const anchor = Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end";
            return (
              <g key={label}>
                <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--grid)" strokeWidth={1} />
                <text
                  x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={11}
                  fill={hover === i ? "var(--text)" : "var(--text-2)"}
                >
                  {label}
                </text>
              </g>
            );
          })}

          {series.map((s) => {
            const pts = s.values.map((v, i) => point(i, v ?? 0));
            const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ") + "Z";
            return (
              <g key={s.name}>
                <path d={path} fill={s.color} fillOpacity={0.08} stroke="none" />
                <path
                  d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  filter={s.glow ? `url(#glow-${uid})` : undefined}
                />
                {!s.dashed &&
                  pts.map(([x, y], i) => (
                    <circle key={i} cx={x} cy={y} r={hover === i ? 5.5 : 4} fill={s.color} stroke="var(--panel)" strokeWidth={2}
                      filter={s.glow ? `url(#glow-${uid})` : undefined} />
                  ))}
              </g>
            );
          })}

          {axes.map((label, i) => {
            const [x, y] = point(i, Math.max(...series.map((s) => s.values[i] ?? 0), 0.15));
            return (
              <circle
                key={`hit-${label}`} cx={x} cy={y} r={16} fill="transparent" tabIndex={0}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                aria-label={`${label}: ${series.map((s) => `${s.name} ${s.values[i] == null ? "n/a" : format(s.values[i]!)}`).join(", ")}`}
              />
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <ChartTooltip x={point(hover, 1)[0]} y={point(hover, 0.9)[1]} width={width}>
          <div className="mb-1 font-medium text-text">{axes[hover]}</div>
          {series.map((s) => (
            <TooltipRow key={s.name} color={s.color} dashed={s.dashed} label={s.name}
              value={s.values[hover] == null ? "—" : format(s.values[hover]!)} />
          ))}
        </ChartTooltip>
      )}
    </div>
  );
}

function ringPath(cx: number, cy: number, r: number) {
  return `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;
}
