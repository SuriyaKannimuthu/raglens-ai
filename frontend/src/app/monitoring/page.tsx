"use client";

import clsx from "clsx";
import { Fragment, useState } from "react";
import { Histogram, TraceFeed, TraceWaterfall } from "@/components/charts/Bars";
import { TrendChart } from "@/components/charts/TrendChart";
import { Badge, ErrorState, Loading, PageHeader, Panel, PanelHeader, Segmented, Table, Td, Th } from "@/components/ui";
import type { MonitoringSummary, Trace } from "@/lib/api";
import { compact, ms, pct, relativeTime, usd } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const STAGE_COLORS: Record<string, string> = {
  retrieval: "var(--series-1)",
  rerank: "var(--series-2)",
  generation: "var(--series-3)",
  evaluation: "var(--series-4)",
};

type TraceFilter = "all" | "error" | "playground";

export default function MonitoringPage() {
  const { data, error } = useApi<MonitoringSummary>("/monitoring/summary", { refreshInterval: 5000 });
  const [filter, setFilter] = useState<TraceFilter>("all");
  const traceQuery = filter === "error" ? "/traces?limit=100&status=error" : filter === "playground" ? "/traces?limit=100&source=playground" : "/traces?limit=100";
  const { data: traces } = useApi<Trace[]>(traceQuery, { refreshInterval: 5000 });
  const [open, setOpen] = useState<string | null>(null);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading label="Loading monitoring data…" />;

  const stageMax = Math.max(...Object.values(data.stages).map((s) => s.avg_ms), 0.001);
  const projected = data.runs.reduce((sum, r) => sum + (r.projected_cost_total_usd ?? 0), 0);

  return (
    <>
      <PageHeader title="Performance Monitoring" subtitle={`Operational metrics over the last ${data.window} traced queries, refreshed every 5 seconds.`} />

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Latency p50" value={ms(data.latency_ms.p50)} />
        <Kpi label="Latency p95" value={ms(data.latency_ms.p95)} accent />
        <Kpi label="Latency p99" value={ms(data.latency_ms.p99)} />
        <Kpi label="Failure rate" value={pct(data.failure_rate)} sub={`${data.errors} failed`} tone={data.errors ? "critical" : "good"} />
        <Kpi label="Tokens" value={compact(data.tokens.input + data.tokens.output)} sub={`${compact(data.tokens.input)} in · ${compact(data.tokens.output)} out`} />
        <Kpi label="LLM cost" value={usd(data.cost_usd)} sub={projected ? `${usd(projected)} projected` : undefined} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-5">
          <PanelHeader title="Latency Distribution" info="End-to-end query latency (retrieval + rerank + generation + scoring), bucketed." />
          <Histogram buckets={trimBuckets(data.latency_histogram)} height={220} />
        </Panel>
        <Panel className="lg:col-span-3">
          <PanelHeader title="Stage Breakdown" info="Average time spent in each pipeline stage." />
          <ul className="space-y-4">
            {Object.entries(data.stages).map(([name, s]) => (
              <li key={name}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 capitalize text-text">
                    <span className="h-2 w-2 rounded-sm" style={{ background: STAGE_COLORS[name] ?? "var(--accent)" }} />
                    {name}
                  </span>
                  <span className="tnum text-text-2">
                    {ms(s.avg_ms)} avg · {ms(s.p95_ms)} p95
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5">
                  <div className="h-full rounded-full" style={{ width: `${(s.avg_ms / stageMax) * 100}%`, background: STAGE_COLORS[name] ?? "var(--accent)" }} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="lg:col-span-4">
          <PanelHeader title="API Health" info="In-process counters since the API started; also exported in Prometheus format at /metrics." />
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Item label="Uptime" value={formatUptime(data.live.uptime_seconds)} />
            <Item label="HTTP requests" value={compact(data.live.http.requests_total)} />
            <Item label="HTTP p95" value={ms(data.live.http.latency_ms.p95)} />
            <Item label="5xx errors" value={String(data.live.http.server_errors_total)} />
            <Item label="Pipeline queries" value={compact(data.live.pipeline.queries_total)} />
            <Item label="Pipeline failures" value={pct(data.live.pipeline.failure_rate)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {Object.entries(data.run_status_counts).map(([status, count]) => (
              <Badge key={status} tone={status === "completed" ? "good" : status === "failed" ? "critical" : "accent"}>
                {count} {status}
              </Badge>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="p95 Latency by Run" subtitle="Completed evaluation runs, oldest to newest" />
          <TrendChart
            seriesLabel="p95 latency"
            data={data.runs.map((r, i) => ({ label: `#${i + 1}`, title: r.name, value: r.latency_p95_ms }))}
            format={(v) => ms(v)}
            height={180}
          />
        </Panel>
        <Panel>
          <PanelHeader title="Recent Query Signal" subtitle="Latency per traced query, newest on the right" />
          <TraceFeed traces={(traces ?? []).slice(0, 90)} height={180} />
        </Panel>
      </div>

      <Panel className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <PanelHeader title="Traces" subtitle="Click a trace to see its span waterfall" className="mb-0" />
          <div className="w-full max-w-sm">
            <Segmented<TraceFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "error", label: "Errors" },
                { value: "playground", label: "Playground" },
              ]}
            />
          </div>
        </div>
        {!traces ? (
          <Loading />
        ) : traces.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-2">No traces match this filter.</p>
        ) : (
          <Table minWidth="min-w-[760px]">
            <thead>
              <tr>
                <Th>Question</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th className="text-right">Duration</Th>
                <Th className="text-right">Tokens</Th>
                <Th className="text-right">When</Th>
              </tr>
            </thead>
            <tbody>
              {traces.slice(0, 40).map((t) => (
                <Fragment key={t.id}>
                  <tr className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setOpen(open === t.id ? null : t.id)}>
                    <Td className="max-w-[420px]">
                      <div className="truncate" title={t.question}>
                        {t.question}
                      </div>
                    </Td>
                    <Td className="text-xs text-text-2">{t.source}</Td>
                    <Td>
                      <Badge tone={t.status === "ok" ? "good" : "critical"}>{t.status}</Badge>
                    </Td>
                    <Td className="tnum text-right">{ms(t.duration_ms)}</Td>
                    <Td className="tnum text-right text-text-2">{t.input_tokens + t.output_tokens}</Td>
                    <Td className="whitespace-nowrap text-right text-xs text-text-2">{relativeTime(t.created_at)}</Td>
                  </tr>
                  {open === t.id && (
                    <tr>
                      <td colSpan={6} className="border-b border-border bg-bg-elevated/60 px-5 py-4">
                        {t.error && <p className="mb-3 text-xs text-critical">{t.error}</p>}
                        <TraceWaterfall spans={t.spans} total={t.duration_ms} />
                        <p className="mt-3 text-[11px] text-muted">
                          trace {t.id}
                          {t.run_id && ` · run ${t.run_id.slice(0, 8)}`}
                          {t.attributes.generator_model ? ` · ${String(t.attributes.generator_model)}` : ""}
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}

/** Drop empty buckets at the high end so the histogram uses its width. */
function trimBuckets(buckets: MonitoringSummary["latency_histogram"]) {
  let end = buckets.length;
  while (end > 1 && buckets[end - 1].count === 0) end--;
  let start = 0;
  while (start < end - 1 && buckets[start].count === 0) start++;
  return buckets.slice(start, Math.min(buckets.length, end + 1));
}

function formatUptime(seconds: number) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d`;
}

function Kpi({ label, value, sub, accent, tone }: { label: string; value: string; sub?: string; accent?: boolean; tone?: "good" | "critical" }) {
  return (
    <Panel className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-text-2">{label}</div>
      <div
        className={clsx(
          "mt-1.5 text-2xl font-semibold",
          accent ? "glow-text text-accent" : tone === "critical" ? "text-critical" : tone === "good" ? "text-good" : "text-text",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Panel>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum font-medium text-text">{value}</dd>
    </div>
  );
}
