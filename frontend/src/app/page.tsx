"use client";

import clsx from "clsx";
import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  Gauge,
  Layers,
  Lightbulb,
  Minus,
  Scale,
  ShieldCheck,
  Target,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { TraceFeed } from "@/components/charts/Bars";
import { RadarChart } from "@/components/charts/RadarChart";
import { Sparkline, TrendChart } from "@/components/charts/TrendChart";
import { Badge, Delta, EmptyState, ErrorState, LinkButton, Loading, Panel, PanelHeader, inputClass } from "@/components/ui";
import type { Overview, Run, Trace } from "@/lib/api";
import { metricLabel, ms, pct, shortDate, tone, usd } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type RunList = { items: Run[]; total: number };

const METRIC_ICONS: Record<string, typeof Gauge> = {
  context_precision: Target,
  context_recall: Layers,
  mrr: Gauge,
  ndcg: Gauge,
  faithfulness: ShieldCheck,
  answer_relevancy: Scale,
  answer_correctness: ShieldCheck,
};

const TONE_COLOR = { good: "var(--good)", warning: "var(--warning)", critical: "var(--critical)", muted: "var(--muted)" };

export default function DashboardPage() {
  const { data, error, isLoading } = useApi<Overview>("/dashboard/overview", { refreshInterval: 5000 });
  const { data: runs } = useApi<RunList>("/evaluations?status=completed&limit=50");
  const { data: traces } = useApi<Trace[]>("/traces?limit=72", { refreshInterval: 5000 });
  const [focusId, setFocusId] = useState<string>("");

  const focusRun = useMemo(() => runs?.items.find((r) => r.id === focusId), [runs, focusId]);

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Loading label="Loading dashboard…" />;
  if (data.counts.runs === 0)
    return (
      <Panel>
        <EmptyState title="No evaluation runs yet">
          <p className="mb-4">Start an evaluation to see quality, latency and cost metrics here.</p>
          <LinkButton href="/evaluations/new" variant="primary">
            New evaluation
          </LinkButton>
        </EmptyState>
      </Panel>
    );

  const qi = data.kpis.quality_index;
  const recall = data.kpis.recall_at_k;
  const trendValues = data.trend.map((t) => t.quality_index ?? 0);
  const radarMetrics = data.radar.metrics;
  const focus = focusRun
    ? { run_id: focusRun.id, name: focusRun.name, values: focusRun.metrics }
    : data.radar.focus;
  const baseline = data.radar.baseline;
  const firstQi = data.trend[0]?.quality_index ?? null;
  const lastQi = data.trend[data.trend.length - 1]?.quality_index ?? null;
  const overallTrend = firstQi != null && lastQi != null ? lastQi - firstQi : null;
  const weakest = focusRun
    ? radarMetrics
        .map((k) => ({ metric: k, value: focusRun.metrics[k] ?? 0 }))
        .sort((a, b) => a.value - b.value)
        .slice(0, 4)
    : data.weakest_metrics;
  const critical = data.alerts.filter((a) => a.severity === "critical").length;
  const warnings = data.alerts.length - critical;
  const recentOk = (traces ?? []).filter((t) => t.status === "ok").map((t) => t.duration_ms).sort((a, b) => a - b);
  const feedP50 = recentOk.length ? recentOk[Math.floor(recentOk.length / 2)] : null;
  const feedErrors = (traces ?? []).filter((t) => t.status === "error").length;
  const ops = data.operational;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* Left column: KPI tiles */}
      <div className="flex flex-col gap-4 lg:col-span-3">
        <Panel>
          <PanelHeader title="Quality Index" info="Weighted composite of context precision, context recall, MRR, faithfulness, answer relevancy and correctness (0-100)." />
          <div className="flex items-baseline gap-1">
            <span className="glow-text text-5xl font-semibold text-accent">{qi.value?.toFixed(1) ?? "—"}</span>
            <span className="text-sm text-text-2">/100</span>
          </div>
          <div className="mt-3">
            <Sparkline values={trendValues} />
          </div>
          <div className="mt-2">
            <Delta value={qi.delta} label="vs previous run" />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Retrieval Recall" info="Recall@K of the latest run: share of relevant documents found in the top-K chunks." />
          <div className="text-4xl font-semibold text-good">{pct(recall.value)}</div>
          <div className="mt-1 text-xs text-text-2">Relevant documents retrieved @K</div>
          <div className="mt-3 flex h-8 items-end gap-[3px]" aria-hidden>
            {data.trend.slice(-24).map((t) => (
              <div
                key={t.run_id}
                className="flex-1 rounded-t-sm bg-good/70"
                style={{ height: `${Math.max(6, (t.recall_at_k ?? 0) * 100)}%` }}
                title={`${t.name}: Recall@K ${pct(t.recall_at_k)}`}
              />
            ))}
          </div>
          <div className="mt-2">
            <Delta value={recall.delta == null ? null : recall.delta * 100} digits={1} suffix=" pts" label="vs previous run" />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Alerts" info="Failed runs, runs that regressed below the baseline, and runs with failed queries." />
          <div className={clsx("text-4xl font-semibold", data.alerts.length ? "text-warning" : "text-good")}>{data.alerts.length}</div>
          <div className="mt-1 text-xs text-text-2">Active</div>
          <div className="mt-3 flex h-1.5 gap-1 overflow-hidden rounded-full" aria-label={`${critical} critical, ${warnings} warnings`}>
            {data.alerts.length === 0 ? (
              <div className="h-full flex-1 rounded-full bg-good/60" />
            ) : (
              <>
                {critical > 0 && <div className="h-full rounded-full bg-critical" style={{ flex: critical }} />}
                {warnings > 0 && <div className="h-full rounded-full bg-warning" style={{ flex: warnings }} />}
              </>
            )}
          </div>
          <div className="mt-2 flex gap-3 text-[11px] text-text-2">
            <span>{critical} critical</span>
            <span>{warnings} warning</span>
          </div>
          {data.alerts.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {data.alerts.slice(0, 2).map((a, i) => (
                <li key={i} className="truncate text-xs text-text-2" title={a.message}>
                  <span className={a.severity === "critical" ? "text-critical" : "text-warning"}>●</span> {a.message}
                </li>
              ))}
            </ul>
          )}
          <Link href="/evaluations" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            View all runs <ArrowRight size={12} />
          </Link>
        </Panel>
      </div>

      {/* Center: radar */}
      <Panel className="flex flex-col lg:col-span-6">
        <PanelHeader
          title="Quality Radar"
          info="Retrieval and answer metrics of the focus run against the baseline run. Hover a vertex for values."
          subtitle="Retrieval & answer quality mapping"
          right={
            <select
              className={clsx(inputClass, "w-auto max-w-[220px] py-1.5 text-xs")}
              value={focusId}
              onChange={(e) => setFocusId(e.target.value)}
              aria-label="Focus run"
            >
              <option value="">Best run</option>
              {runs?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          }
        />
        <div className="flex-1">
          {focus ? (
            <RadarChart
              axes={radarMetrics.map(metricLabel)}
              decorative
              targetBand={0.8}
              height={430}
              series={[
                ...(baseline && baseline.run_id !== focus.run_id
                  ? [{ name: `Baseline · ${baseline.name}`, color: "var(--baseline)", dashed: true, values: radarMetrics.map((k) => baseline.values[k] ?? null) }]
                  : []),
                { name: focus.name, color: "#22d3ee", glow: true, values: radarMetrics.map((k) => focus.values[k] ?? null) },
              ]}
            />
          ) : (
            <EmptyState title="No completed runs" />
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-text-2">
          <span className="flex items-center gap-2">
            <span className="inline-block w-5 border-t-2 border-accent" /> {focus?.name ?? "Focus run"}
          </span>
          {baseline && baseline.run_id !== focus?.run_id && (
            <span className="flex items-center gap-2">
              <span className="inline-block w-5 border-t-2 border-dashed border-baseline" /> Baseline
            </span>
          )}
          <span className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-good/40" /> Target ≥ 80
          </span>
        </div>
      </Panel>

      {/* Right column */}
      <div className="flex flex-col gap-4 lg:col-span-3">
        <Panel>
          <PanelHeader title="Quality Trend" subtitle={`Last ${data.trend.length} completed runs`} info="Quality index per completed run, oldest to newest." />
          <TrendChart
            seriesLabel="Quality index"
            data={data.trend.map((t, i) => ({ label: `#${i + 1}`, title: `${t.name} · ${shortDate(t.created_at)}`, value: t.quality_index }))}
            domain={[Math.max(0, Math.floor(Math.min(...trendValues) / 10) * 10 - 10), 100]}
            height={150}
          />
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs">
            <span className="text-text-2">Overall trend</span>
            <TrendLabel value={overallTrend} />
          </div>
        </Panel>

        <Panel className="flex-1">
          <PanelHeader title="Weakest Metrics" info="Lowest-scoring metrics of the focus run - where to optimize next." />
          <ul className="space-y-4">
            {weakest.map((w) => {
              const Icon = METRIC_ICONS[w.metric] ?? Gauge;
              const t = tone(w.value);
              return (
                <li key={w.metric} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-panel-2 text-text-2">
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="text-text">{metricLabel(w.metric)}</span>
                      <span className="tnum font-medium text-text">{(w.value * 100).toFixed(0)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full" style={{ width: `${w.value * 100}%`, background: TONE_COLOR[t] }} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {focus && (
            <Link href={`/evaluations/${focus.run_id}`} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              View full analysis <ArrowRight size={12} />
            </Link>
          )}
        </Panel>
      </div>

      {/* Bottom row */}
      <Panel className="lg:col-span-4">
        <PanelHeader title="Run Status" info="Most recent evaluation runs. Trend compares quality index with the previous completed run." />
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="pb-2 font-medium">Run</th>
              <th className="pb-2 font-medium">QI</th>
              <th className="pb-2 font-medium">Quality</th>
              <th className="pb-2 text-right font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.slice(0, 5).map((r) => {
              const level = r.quality_index == null ? null : r.quality_index >= 80 ? "good" : r.quality_index >= 60 ? "warning" : "critical";
              return (
                <tr key={r.run_id} className="border-t border-border/60">
                  <td className="max-w-[150px] py-2.5 pr-2">
                    <Link href={`/evaluations/${r.run_id}`} className="block truncate text-text hover:text-accent" title={r.name}>
                      {r.name}
                    </Link>
                  </td>
                  <td className="tnum py-2.5 text-text">{r.quality_index?.toFixed(1) ?? "—"}</td>
                  <td className="py-2.5">
                    {r.status !== "completed" ? (
                      <Badge tone={r.status === "failed" ? "critical" : "accent"}>{r.status}</Badge>
                    ) : (
                      <Badge tone={level ?? "muted"}>{level === "good" ? "High" : level === "warning" ? "Moderate" : "Low"}</Badge>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <TrendArrow value={r.trend} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel className="lg:col-span-4">
        <PanelHeader title="Live Trace Feed" subtitle="Per-query latency, newest on the right" info="Each bar is one traced query (evaluation or playground); red bars failed." />
        <TraceFeed traces={traces ?? []} />
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
          <MiniStat label="p50 latency" value={ms(feedP50)} />
          <MiniStat label="Errors" value={String(feedErrors)} tone={feedErrors ? "critical" : undefined} />
          <MiniStat
            label={ops.cost_per_query_usd ? "Cost / query" : "Projected / query"}
            value={usd(ops.cost_per_query_usd || ops.projected_cost_per_query_usd)}
            hint={ops.cost_per_query_usd ? undefined : `Local generator is free; projected at ${ops.projected_model} pricing`}
          />
        </div>
      </Panel>

      <Panel className="lg:col-span-4">
        <PanelHeader title="Recommendations" info="Rule-based next steps derived from the focus run's metrics." />
        <ul className="space-y-1">
          {data.recommendations.map((rec) => (
            <li key={rec.title} className="flex items-start gap-3 rounded-lg px-1 py-2 hover:bg-white/[0.02]" title={rec.detail}>
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-panel-2 text-text-2">
                <Lightbulb size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text">{rec.title}</div>
                <div className="line-clamp-1 text-xs text-muted">{rec.detail}</div>
              </div>
              <span className="whitespace-nowrap text-[11px] text-text-2">{rec.impact[0].toUpperCase() + rec.impact.slice(1)} impact</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function MiniStat({ label, value, tone: t, hint }: { label: string; value: string; tone?: "critical"; hint?: string }) {
  return (
    <div title={hint}>
      <div className="text-[11px] text-text-2">{label}</div>
      <div className={clsx("text-lg font-semibold", t === "critical" ? "text-critical" : "text-text")}>{value}</div>
    </div>
  );
}

function TrendArrow({ value }: { value: number | null }) {
  if (value == null) return <Minus size={14} className="ml-auto text-muted" aria-label="no prior run" />;
  if (Math.abs(value) < 0.05) return <Minus size={14} className="ml-auto text-text-2" aria-label="flat" />;
  return value > 0 ? (
    <span className="inline-flex items-center gap-0.5 text-xs text-good">
      <ArrowUpRight size={14} /> {value.toFixed(1)}
    </span>
  ) : (
    <span className="inline-flex items-center gap-0.5 text-xs text-critical">
      <ArrowDownRight size={14} /> {Math.abs(value).toFixed(1)}
    </span>
  );
}

function TrendLabel({ value }: { value: number | null }) {
  if (value == null) return <span className="text-text-2">Not enough runs</span>;
  if (Math.abs(value) < 0.5) return <span className="font-medium text-text-2">Stable</span>;
  return value > 0 ? (
    <span className="inline-flex items-center gap-1 font-medium text-good">
      Improving <ArrowUpRight size={13} />
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-medium text-critical">
      Declining <ArrowDownRight size={13} />
    </span>
  );
}
