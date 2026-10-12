"use client";

import clsx from "clsx";
import {
  Activity,
  Database,
  FlaskConical,
  GitCompareArrows,
  LayoutDashboard,
  MessageSquareText,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/evaluations", label: "Evaluations", icon: FlaskConical },
  { href: "/experiments", label: "Experiments", icon: GitCompareArrows },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/playground", label: "Playground", icon: MessageSquareText },
  { href: "/datasets", label: "Datasets", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Logo() {
  return (
    <Link href="/" className="block px-2">
      <div className="brand-gradient text-[26px] font-semibold leading-none tracking-[0.12em]">RAGLENS</div>
      <div className="mt-1.5 text-[9px] font-medium tracking-[0.32em] text-text-2">EVALUATION INTELLIGENCE</div>
    </Link>
  );
}

function SystemStatus() {
  const { data, error } = useApi<{ status: string; active_runs: number }>("/health", { refreshInterval: 10000 });
  const ok = !error && data?.status === "ok";
  return (
    <div className="panel mx-1 p-3.5">
      <div className="flex items-center gap-2 text-xs font-medium text-text">
        <span className={clsx("h-2 w-2 rounded-full", ok ? "live-dot bg-good" : "bg-critical")} />
        System Status
      </div>
      <div className={clsx("mt-1.5 text-sm font-semibold", ok ? "text-good" : "text-critical")}>
        {error ? "API offline" : data ? (ok ? "Optimal" : "Degraded") : "Checking…"}
      </div>
      <div className="mt-0.5 text-[11px] text-text-2">
        {error
          ? "Start the FastAPI backend"
          : data && data.active_runs > 0
            ? `${data.active_runs} evaluation${data.active_runs > 1 ? "s" : ""} running`
            : "All systems operational"}
      </div>
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-8 py-6">
      <Logo />
      <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors",
                active
                  ? "border-accent/30 bg-accent/10 text-accent shadow-[0_0_24px_-10px_rgba(34,211,238,0.9)]"
                  : "border-transparent text-text-2 hover:bg-white/[0.03] hover:text-text",
              )}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
            </Link>
          );
        })}
      </nav>
      <SystemStatus />
    </div>
  );
}
