"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Loader2, Minus } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx("panel p-5", className)}>{children}</section>;
}

export function PanelHeader({
  title,
  subtitle,
  info,
  right,
  className,
}: {
  title: string;
  subtitle?: ReactNode;
  info?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("mb-4 flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="panel-title">{title}</h2>
          {info && (
            <span title={info} className="text-muted hover:text-text-2" aria-label={info}>
              <Info size={12} />
            </span>
          )}
        </div>
        {subtitle && <p className="mt-1 text-xs text-text-2">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

type Tone = "good" | "warning" | "critical" | "serious" | "accent" | "muted" | "baseline";

const TONE_CLASSES: Record<Tone, string> = {
  good: "bg-good/10 text-good border-good/25",
  warning: "bg-warning/10 text-warning border-warning/25",
  serious: "bg-serious/10 text-serious border-serious/25",
  critical: "bg-critical/10 text-critical border-critical/25",
  accent: "bg-accent/10 text-accent border-accent/25",
  baseline: "bg-baseline/15 text-[#c4b5fd] border-baseline/30",
  muted: "bg-white/5 text-text-2 border-white/10",
};

export function Badge({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "completed" ? "good" : status === "failed" ? "critical" : status === "running" ? "accent" : "muted";
  return (
    <Badge tone={tone}>
      {status === "running" && <Loader2 size={11} className="animate-spin" />}
      {status}
    </Badge>
  );
}

export function Delta({
  value,
  digits = 2,
  suffix = "",
  invert = false,
  label,
}: {
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
  invert?: boolean;
  label?: string;
}) {
  if (value == null) return <span className="text-xs text-muted">no prior run</span>;
  const flat = Math.abs(value) < 10 ** -digits / 2;
  const good = flat ? null : invert ? value < 0 : value > 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        good == null ? "text-text-2" : good ? "text-good" : "text-critical",
      )}
    >
      <Icon size={13} aria-hidden />
      {Math.abs(value).toFixed(digits)}
      {suffix}
      {label && <span className="ml-1 font-normal text-muted">{label}</span>}
    </span>
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" &&
          "border-accent/40 bg-accent/15 text-accent shadow-[0_0_20px_-6px_rgba(34,211,238,0.6)] hover:bg-accent/25",
        variant === "secondary" && "border-border-strong bg-panel-2 text-text hover:bg-panel-hover",
        variant === "ghost" && "border-transparent text-text-2 hover:bg-white/5 hover:text-text",
        variant === "danger" && "border-critical/30 bg-critical/10 text-critical hover:bg-critical/20",
        className,
      )}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
        variant === "primary"
          ? "border-accent/40 bg-accent/15 text-accent shadow-[0_0_20px_-6px_rgba(34,211,238,0.6)] hover:bg-accent/25"
          : "border-border-strong bg-panel-2 text-text hover:bg-panel-hover",
      )}
    >
      {children}
    </Link>
  );
}

export function ProgressBar({ value, tone = "accent" }: { value: number; tone?: "accent" | "good" | "warning" | "critical" }) {
  const color = { accent: "bg-accent", good: "bg-good", warning: "bg-warning", critical: "bg-critical" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className={clsx("h-full rounded-full transition-[width] duration-500", color)}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

/** Horizontal metric meter: label, bar, value. Bars carry color; text stays in text tokens. */
export function MetricBar({ label, value, color = "var(--accent)", hint }: { label: string; value: number | null; color?: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-text-2">{label}</span>
        <span className="tnum font-medium text-text">{value == null ? "—" : value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full"
          style={{ width: `${(value ?? 0) * 100}%`, background: color, boxShadow: `0 0 10px -2px ${color}` }}
        />
      </div>
    </div>
  );
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center justify-center gap-2 py-10 text-sm text-text-2", className)}>
      <Loader2 size={16} className="animate-spin text-accent" /> {label}
    </div>
  );
}

export function ErrorState({ error, className }: { error: unknown; className?: string }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className={clsx("flex items-start gap-2 rounded-lg border border-critical/30 bg-critical/10 p-3 text-sm text-critical", className)}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">Could not load data</p>
        <p className="text-critical/80">{message}</p>
        <p className="mt-1 text-xs text-text-2">Is the API running on the configured BACKEND_URL (default http://localhost:8000)?</p>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong py-10 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {children && <div className="text-xs text-text-2">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-muted focus:border-accent/60 focus:ring-2 focus:ring-accent/15";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex w-full rounded-lg border border-border-strong bg-bg-elevated p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            value === o.value ? "bg-accent/15 text-accent shadow-[inset_0_0_0_1px_rgba(34,211,238,0.35)]" : "text-text-2 hover:text-text",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-sm text-text disabled:opacity-40"
    >
      <span
        className={clsx(
          "relative h-5 w-9 rounded-full border transition-colors",
          checked ? "border-accent/50 bg-accent/30" : "border-border-strong bg-bg-elevated",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all",
            checked ? "left-[18px] bg-accent shadow-[0_0_8px_rgba(34,211,238,0.8)]" : "left-0.5 bg-muted",
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function Table({ children, className, minWidth = "min-w-max" }: { children: ReactNode; className?: string; minWidth?: string }) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <table className={clsx("w-full border-collapse text-sm", minWidth)}>{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={clsx("border-b border-border px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("border-b border-border/60 px-3 py-2.5 text-text", className)}>{children}</td>;
}
