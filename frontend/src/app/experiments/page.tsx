"use client";

import clsx from "clsx";
import { CheckCircle2, ShieldCheck, Trophy, XCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import useSWR from "swr";
import { RadarChart } from "@/components/charts/RadarChart";
import { Badge, Button, EmptyState, ErrorState, Field, Loading, PageHeader, Panel, PanelHeader, Table, Td, Th, inputClass } from "@/components/ui";
import { api, type Comparison, type RegressionReport, type Run } from "@/lib/api";
import { SERIES_COLORS, configSummary, metricLabel, ms, pct, signed, usd } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const MAX_RUNS = 4;
const RADAR_KEYS = ["context_precision", "context_recall", "mrr", "ndcg", "faithfulness", "answer_relevancy", "answer_correctness"];
const TABLE_KEYS = ["quality_index", "context_precision", "context_recall", "precision_at_k", "recall_at_k", "mrr", "ndcg", "hit_rate", "faithfulness", "answer_relevancy", "answer_correctness"];

export default function ExperimentsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Experiments />
    </Suspense>
  );
}

function Experiments() {
  const params = useSearchParams();
  const { data, error } = useApi<{ items: Run[] }>("/evaluations?status=completed&limit=200");
  const runs = useMemo(() => data?.items ?? [], [data]);

  // Default selection: ?runs=<id> plus the baseline, otherwise the four most recent runs.
  const defaults = useMemo(() => {
    const wanted = params.get("runs")?.split(",").filter((id) => runs.some((r) => r.id === id)) ?? [];
    const baseline = runs.find((r) => r.is_baseline);
    const ids = [...new Set([...(baseline ? [baseline.id] : []), ...wanted, ...runs.map((r) => r.id)])].slice(
      0,
      wanted.length ? Math.max(2, wanted.length + (baseline ? 1 : 0)) : MAX_RUNS,
    );
    return { slots: [0, 1, 2, 3].map((i) => ids[i] ?? null), baseline: baseline?.id ?? ids[0] ?? "" };
  }, [runs, params]);

  // Each selected run keeps its color slot until deselected (color follows the entity).
  const [userSlots, setSlots] = useState<(string | null)[] | null>(null);
  const [userBaseline, setBaselineId] = useState<string | null>(null);
  const slots = userSlots ?? defaults.slots;
  const selected = slots.filter((s): s is string => s !== null);
  const baselineId = userBaseline ?? defaults.baseline;
  const effectiveBaseline = selected.includes(baselineId) ? baselineId : selected[0];

  const {
    data: comparison,
    error: compareError,
    isValidating: loading,
  } = useSWR<Comparison>(
    selected.length >= 2 ? ["compare", selected.join(","), effectiveBaseline] : null,
    () => api.compare(selected, effectiveBaseline),
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  function toggle(id: string) {
    setSlots(() => {
      const current = slots;
      const idx = current.indexOf(id);
      if (idx >= 0) return current.map((s, i) => (i === idx ? null : s));
      const free = current.indexOf(null);
      if (free < 0) return current;
      return current.map((s, i) => (i === free ? id : s));
    });
  }

  const colorOf = (id: string) => SERIES_COLORS[slots.indexOf(id)];
  const nameOf = (id: string) => runs.find((r) => r.id === id)?.name ?? id;

  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHeader title="Experiment Comparison" subtitle="Compare up to four completed runs on the same metrics, then gate a candidate against the baseline." />
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-4">
          <PanelHeader title="Runs" subtitle={`${selected.length}/${MAX_RUNS} selected`} />
          {runs.length === 0 ? (
            <EmptyState title="No completed runs" />
          ) : (
            <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {runs.map((r) => {
                const isSelected = selected.includes(r.id);
                const disabled = !isSelected && selected.length >= MAX_RUNS;
                return (
                  <li key={r.id}>
                    <label
                      className={clsx(
                        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                        isSelected ? "border-border-strong bg-panel-hover" : "border-transparent hover:bg-white/[0.02]",
                        disabled && "cursor-not-allowed opacity-40",
                      )}
                    >
                      <input type="checkbox" className="mt-1 accent-cyan-400" checked={isSelected} disabled={disabled} onChange={() => toggle(r.id)} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm text-text">
                          {isSelected && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(r.id) }} />}
                          <span className="truncate">{r.name}</span>
                        </div>
                        <div className="truncate text-xs text-muted">{configSummary(r.config)}</div>
                      </div>
                      <span className="tnum text-sm font-medium text-text">{r.metrics.quality_index?.toFixed(1)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {selected.length >= 2 && (
            <Field label="Compare against (baseline)">
              <select className={clsx(inputClass, "mt-1")} value={effectiveBaseline} onChange={(e) => setBaselineId(e.target.value)}>
                {selected.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Panel>

        <Panel className="lg:col-span-8">
          <PanelHeader title="Quality Overlay" info="Each polygon is one run; the baseline is dashed. Hover a vertex for values." />
          {selected.length < 2 ? (
            <EmptyState title="Select at least two runs to compare" />
          ) : comparison && selected.length >= 2 ? (
            <>
              <RadarChart
                axes={RADAR_KEYS.map(metricLabel)}
                height={380}
                targetBand={0.8}
                series={comparison.runs.map((r) => ({
                  name: r.name,
                  color: colorOf(r.run_id),
                  dashed: r.is_baseline,
                  values: RADAR_KEYS.map((k) => r.metrics[k]),
                }))}
              />
              <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-text-2">
                {comparison.runs.map((r) => (
                  <span key={r.run_id} className="flex items-center gap-2">
                    <span className="inline-block w-5" style={{ borderTop: `2px ${r.is_baseline ? "dashed" : "solid"} ${colorOf(r.run_id)}` }} />
                    {r.name}
                    {r.is_baseline && <span className="text-muted">(baseline)</span>}
                  </span>
                ))}
              </div>
            </>
          ) : compareError ? (
            <ErrorState error={compareError} />
          ) : (
            <Loading />
          )}
        </Panel>
      </div>

      {comparison && selected.length >= 2 && (
        <>
          <Panel className={clsx("mt-4 p-0 transition-opacity", loading && "opacity-60")}>
            <div className="border-b border-border p-4">
              <PanelHeader
                title="Metric Comparison"
                subtitle="Deltas are relative to the baseline column; the best value per row is marked."
                className="mb-0"
                right={
                  comparison.winner_run_id && (
                    <Badge tone="good">
                      <Trophy size={11} /> {nameOf(comparison.winner_run_id)}
                    </Badge>
                  )
                }
              />
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  {comparison.runs.map((r) => (
                    <Th key={r.run_id} className="text-right">
                      <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                        <span className="h-2 w-2 rounded-full" style={{ background: colorOf(r.run_id) }} />
                        <Link href={`/evaluations/${r.run_id}`} className="max-w-[180px] truncate text-text-2 hover:text-accent">
                          {r.name}
                        </Link>
                      </span>
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABLE_KEYS.map((key) => (
                  <tr key={key}>
                    <Td className="text-text-2">{metricLabel(key)}</Td>
                    {comparison.runs.map((r) => {
                      const v = r.metrics[key];
                      const d = r.deltas[key];
                      const best = comparison.best_by_metric[key] === r.run_id && comparison.runs.some((o) => o.metrics[key] !== v);
                      return (
                        <Td key={r.run_id} className="text-right">
                          <span className={clsx("tnum", best ? "font-semibold text-text" : "text-text")}>
                            {best && <Trophy size={11} className="mr-1 inline text-good" aria-label="best" />}
                            {v == null ? "—" : key === "quality_index" ? v.toFixed(2) : v.toFixed(3)}
                          </span>
                          {!r.is_baseline && d != null && (
                            <span className={clsx("tnum ml-2 text-xs", d > 0.0005 ? "text-good" : d < -0.0005 ? "text-critical" : "text-muted")}>
                              {signed(d, key === "quality_index" ? 2 : 3)}
                            </span>
                          )}
                        </Td>
                      );
                    })}
                  </tr>
                ))}
                {[
                  ["latency_p95_ms", "Latency p95", ms],
                  ["tokens_per_query", "Tokens / query", (v: number | null) => (v == null ? "—" : v.toFixed(0))],
                  ["projected_cost_per_query_usd", "Projected cost / query", usd],
                  ["failure_rate", "Failure rate", (v: number | null) => pct(v)],
                ].map(([key, label, fmt]) => (
                  <tr key={key as string}>
                    <Td className="text-text-2">{label as string}</Td>
                    {comparison.runs.map((r) => (
                      <Td key={r.run_id} className="tnum text-right text-text-2">
                        {(fmt as (v: number | null) => string)(r.operational[key as string] ?? null)}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>

          <div className="mt-4 grid gap-4 lg:grid-cols-12">
            <RegressionGate runs={comparison.runs.map((r) => ({ id: r.run_id, name: r.name }))} baselineId={comparison.baseline_run_id} />
            <Panel className="lg:col-span-7">
              <PanelHeader title="Largest Disagreements" info="Questions where per-question quality differs most across the selected runs." />
              <Table>
                <thead>
                  <tr>
                    <Th>Question</Th>
                    {comparison.runs.map((r) => (
                      <Th key={r.run_id} className="text-right">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorOf(r.run_id) }} aria-label={r.name} />
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comparison.sample_diffs.filter((s) => s.spread > 0).slice(0, 8).map((s) => (
                    <tr key={s.sample_id}>
                      <Td className="max-w-[320px]">
                        <div className="truncate text-sm" title={s.question}>
                          <span className="mr-2 text-xs text-muted">{s.sample_id}</span>
                          {s.question}
                        </div>
                      </Td>
                      {comparison.runs.map((r) => (
                        <Td key={r.run_id} className="tnum text-right text-sm">
                          {s.runs[r.run_id]?.quality?.toFixed(0) ?? "—"}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
              {comparison.sample_diffs.every((s) => s.spread === 0) && <p className="py-4 text-center text-sm text-text-2">All runs score identically per question.</p>}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

function RegressionGate({ runs, baselineId }: { runs: { id: string; name: string }[]; baselineId: string }) {
  const candidates = runs.filter((r) => r.id !== baselineId);
  const [candidate, setCandidate] = useState(candidates[0]?.id ?? "");
  const [maxDrop, setMaxDrop] = useState(2);
  const [report, setReport] = useState<RegressionReport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const active = candidates.some((c) => c.id === candidate) ? candidate : candidates[0]?.id;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.regressionCheck({ candidate_run_id: active, baseline_run_id: baselineId, default_max_drop: maxDrop / 100 }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="lg:col-span-5">
      <PanelHeader title="Regression Gate" info="Fails when any metric drops more than the allowed amount versus the baseline, or p95 latency rises over 50%. The same check powers scripts/regression_check.py in CI." />
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Candidate">
          <select className={inputClass} value={active} onChange={(e) => setCandidate(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Max drop (pts)">
          <input className={inputClass} type="number" min={0} max={50} step={0.5} value={maxDrop} onChange={(e) => setMaxDrop(Number(e.target.value))} />
        </Field>
      </div>
      <Button className="mt-3 w-full" variant="primary" onClick={run} loading={busy} disabled={!active}>
        <ShieldCheck size={14} /> Run regression check
      </Button>
      {error ? <ErrorState error={error} className="mt-3" /> : null}
      {report && (
        <div className="mt-4">
          <div className={clsx("mb-3 flex items-center gap-2 text-sm font-semibold", report.passed ? "text-good" : "text-critical")}>
            {report.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {report.passed ? "Passed - no regressions" : `Failed - ${report.regressions.map(metricLabel).join(", ")}`}
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {report.checks.map((c) => (
              <li key={c.metric} className="flex items-center justify-between gap-2 border-b border-border/50 py-1">
                <span className="flex items-center gap-1.5 text-text-2">
                  {c.passed ? <CheckCircle2 size={12} className="text-good" /> : <XCircle size={12} className="text-critical" />}
                  {metricLabel(c.metric)}
                </span>
                <span className="tnum text-text">
                  {c.metric === "latency_p95_ms" ? `${ms(c.baseline)} → ${ms(c.candidate)}` : `${signed(c.delta, 3)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
