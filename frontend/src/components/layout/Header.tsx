"use client";

import { Bell, Maximize2, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Overview } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";

const TITLES: Record<string, [string, string]> = {
  "/": ["Overview", "Real-time RAG Quality Intelligence"],
  "/evaluations": ["Evaluations", "Evaluation runs and per-question results"],
  "/experiments": ["Experiments", "Configuration comparison and regression gates"],
  "/monitoring": ["Monitoring", "Latency, failures, tokens and cost"],
  "/playground": ["Playground", "Trace a single query through a pipeline"],
  "/datasets": ["Datasets", "Evaluation corpora and labelled questions"],
  "/settings": ["Settings", "Providers, integrations and metric definitions"],
};

export function Header({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname();
  const key = Object.keys(TITLES).find((k) => (k === "/" ? pathname === "/" : pathname.startsWith(k))) ?? "/";
  const [title, subtitle] = TITLES[key];
  const now = useNow();
  const { data } = useApi<Overview>("/dashboard/overview", { refreshInterval: 15000 });
  const alertCount = data?.alerts.length ?? 0;

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  };

  return (
    <header className="panel flex items-center justify-between gap-4 px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        <button className="rounded-lg p-1.5 text-text-2 hover:bg-white/5 lg:hidden" onClick={onMenu} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <div className="panel-title">{title}</div>
          <div className="mt-1 flex items-center gap-2 truncate text-xs text-text-2">
            {subtitle}
            <span className="flex items-center gap-1.5 text-good">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-good" />
              Live
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="hidden text-right text-[11px] leading-tight text-text-2 sm:block" suppressHydrationWarning>
          {now && (
            <>
              <div>{now.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</div>
              <div className="tnum">{now.toLocaleTimeString("en-GB", { timeZone: "UTC" })} UTC</div>
            </>
          )}
        </div>
        <Link
          href="/evaluations"
          className="relative rounded-lg border border-border-strong bg-panel-2 p-2 text-text-2 hover:text-text"
          aria-label={`${alertCount} alerts`}
        >
          <Bell size={15} />
          {alertCount > 0 && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-critical" />}
        </Link>
        <button
          onClick={toggleFullscreen}
          className="hidden rounded-lg border border-border-strong bg-panel-2 p-2 text-text-2 hover:text-text sm:block"
          aria-label="Toggle fullscreen"
        >
          <Maximize2 size={15} />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent-strong to-baseline text-xs font-semibold text-white">
          S
        </div>
      </div>
    </header>
  );
}
