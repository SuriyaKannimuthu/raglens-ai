import type { ReactNode } from "react";

/** Absolutely-positioned chart tooltip; x/y are in the chart container's pixel space. */
export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width - 180;
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-[140px] rounded-lg border border-border-strong bg-[#08101b]/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
      style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(0, y - 16) }}
    >
      {children}
    </div>
  );
}

export function TooltipRow({ color, label, value, dashed }: { color?: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5 text-text-2">
        {color && (
          <span
            className="inline-block h-0 w-3"
            style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }}
            aria-hidden
          />
        )}
        {label}
      </span>
      <span className="tnum font-medium text-text">{value}</span>
    </div>
  );
}
