"use client";

import clsx from "clsx";
import { CheckCircle2, ChevronDown, ChevronRight, GitCompareArrows, Lightbulb, Star, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Fragment, Suspense, useEffect, useState } from "react";
import { TraceWaterfall } from "@/components/charts/Bars";
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  MetricBar,
  PageHeader,
  Panel,
  PanelHeader,
  ProgressBar,
  Segmented,
  StatusBadge,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { api, type Recommendation, type Run, type SampleResult, type Trace } from "@/lib/api";
import { ANSWER_METRICS, RETRIEVAL_METRICS, compact, dateTime, metricLabel, ms, pct, tone, usd } from "@/lib/format";
import { useApi } from "@/lib/hooks";

const TONE_COLOR = { good: "var(--good)", warning: "var(--warning)", critical: "var(--critical)", muted: "var(--muted)" };

export default function RunDetailPage() {
  return (
    <Suspense fallback={<Loading label="Loading run…" />}>
      <RunDetail />
    </Suspense>
  );
}

function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: run, error, mutate } = useApi<Run>(`/evaluations/${id}`, {
    refreshInterval: (latest) => (latest && (latest.status === "running" || latest.status === "queued") ? 1000 : 0),
  });
  const done = run?.status === "completed";
  const { data: metrics } = useApi<{ by_category: Record<string, Record<string, number | null>> }>(done ? `/evaluations/${id}/metrics` : null);
  const { data: results, mutate: refreshResults } = useApi<SampleResult[]>(
    run && run.status !== "queued" ? `/evaluations/${id}/results` : null,
    { refreshInterval: run?.status === "running" ? 2000 : 0 },
  );
  // Fetch the final result set once the run finishes (polling stops at that point).
  const finished = run?.status === "completed" || run?.status === "failed";
  useEffect(() => {
    if (finished) refreshResults();
  }, [finished, refreshResults]);
  const { data: insights } = useApi<{ recommendations: Recommendation[] }>(done ? `/evaluations/${id}/insights` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorState error={error} />;
  if (!run) return <Loading label="Loading run…" />;

  const ops = run.operational;
  const processed = run.completed_samples + run.failed_samples;

  async function act(kind: "baseline" | "delete") {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "baseline") {
        await api.markBaseline(id);
        await mutate();
      } else {
        if (!confirm(`Delete run "${run!.name}" and all of its results?`)) return;
        await api.deleteRun(id);
        router.push("/evaluations");
      }
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title={run.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            {run.is_baseline && (
              <Badge tone="baseline">
                <Star size={10} /> baseline
              </Badge>
            )}
            <span className="text-text-2">
              {run.dataset} · created {dateTime(run.created_at)} · judge: {run.judge_mode}
            </span>
          </span>
        }
        actions={
          <>
            <Link
              href={`/experiments?runs=${run.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-panel-2 px-3.5 py-2 text-sm font-medium text-text hover:bg-panel-hover"
            >
              <GitCompareArrows size={14} /> Compare
            </Link>
            {done && !run.is_baseline && (
              <Button onClick={() => act("baseline")} loading={busy === "baseline"}>
                <Star size={14} /> Mark as baseline
              </Button>
            )}
            {run.status !== "running" && run.status !== "queued" && (
              <Button variant="danger" onClick={() => act("delete")} loading={busy === "delete"} aria-label="Delete run">
                <Trash2 size={14} />
              </Button>
            )}
          </>
        }
      />
      {actionError ? <ErrorState error={actionError} className="mb-4" /> : null}

      {(run.status === "running" || run.status === "queued") && (
        <Panel className="mb-4">
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-text">{run.status === "queued" ? "Queued…" : "Evaluating questions…"}</span>
            <span className="tnum text-text-2">
              {processed} / {run.total_samples}
            </span>
          </div>
          <ProgressBar value={run.total_samples ? processed / run.total_samples : 0} />
        </Panel>
      )}
      {run.status === "failed" && <ErrorState error={new Error(run.error ?? "Run failed")} className="mb-4" />}

      <div className="mb-4 grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-3">
          <PanelHeader title="Quality Index" info="Weighted composite of the core retrieval and answer metrics (0-100)." />
          <div className="glow-text text-5xl font-semibold text-accent">{run.metrics.quality_index?.toFixed(1) ?? "—"}</div>
          <div className="mt-1 text-xs text-text-2">/100 · {run.completed_samples} questions scored</div>
          <dl className="mt-5 space-y-2 text-xs">
            {[
              ["Retrieval", run.config.retrieval_method + (run.config.retrieval_method === "hybrid" ? ` (${run.config.fusion})` : "")],
              ["Embeddings", run.config.embedding_model],
              ["Chunking", `${run.config.chunking_strategy} · ${run.config.chunk_size}/${run.config.chunk_overlap}`],
              ["Top K", String(run.config.top_k)],
              ["Reranking", run.config.reranking_enabled ? `${run.config.reranker} (${run.config.rerank_candidates} candidates)` : "off"],
              ["Generator", ops.generator_model ?? run.config.llm_provider ?? "—"],
              ["MLflow run", run.mlflow_run_id ? run.mlflow_run_id.slice(0, 12) : "not tracked"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted">{k}</dt>
                <dd className="truncate text-right text-text" title={v}>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="lg:col-span-5">
          <PanelHeader title="Quality Metrics" info="Retrieval metrics use ground-truth relevance labels; answer metrics use the selected judge." />
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div className="space-y-3.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Retrieval</div>
              {RETRIEVAL_METRICS.map((k) => (
                <MetricBar key={k} label={metricLabel(k)} value={run.metrics[k] ?? null} color="var(--accent)" />
              ))}
            </div>
            <div className="space-y-3.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Answer</div>
              {ANSWER_METRICS.map((k) => (
                <MetricBar key={k} label={metricLabel(k)} value={run.metrics[k] ?? null} color="var(--good)" />
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-4">
          <PanelHeader title="Operational" info="Latency, tokens and cost measured while running this evaluation." />
          <div className="grid grid-cols-3 gap-3">
            <Stat label="p50" value={ms(ops.latency_ms?.p50)} />
            <Stat label="p95" value={ms(ops.latency_ms?.p95)} />
            <Stat label="p99" value={ms(ops.latency_ms?.p99)} />
            <Stat label="Retrieval avg" value={ms(ops.retrieval_ms?.avg)} />
            <Stat label="Generation avg" value={ms(ops.generation_ms?.avg)} />
            <Stat label="Failure rate" value={pct(ops.failure_rate)} tone={ops.failure_rate ? "critical" : undefined} />
            <Stat label={ops.tokens?.estimated ? "Tokens (est.)" : "Tokens"} value={compact(ops.tokens?.total)} />
            <Stat label="Tokens / query" value={compact(ops.tokens?.avg_per_query)} />
            <Stat label="Throughput" value={ops.throughput_qps ? `${ops.throughput_qps.toFixed(1)} q/s` : "—"} />
          </div>
          {ops.cost && (
            <div className="mt-4 rounded-lg border border-border bg-bg-elevated/60 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-text-2">Cost (generation + rerank)</span>
                <span className="tnum text-text">{usd(ops.cost.generation_usd)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-text-2">Evaluation (LLM judge)</span>
                <span className="tnum text-text">{usd(ops.cost.evaluation_usd)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-text-2">Projected @ {ops.cost.projected_model}</span>
                <span className="tnum text-text">
                  {usd(ops.cost.projected_total_usd)} · {usd(ops.cost.projected_per_query_usd)}/q
                </span>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {done && (
        <div className="mb-4 grid gap-4 lg:grid-cols-12">
          <Panel className="lg:col-span-7">
            <PanelHeader title="By Question Category" info="Metrics aggregated per dataset category." />
            {metrics ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Category</Th>
                    <Th className="text-right">n</Th>
                    <Th className="text-right">Quality</Th>
                    <Th className="text-right">Recall@K</Th>
                    <Th className="text-right">MRR</Th>
                    <Th className="text-right">Correctness</Th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metrics.by_category).map(([cat, m]) => (
                    <tr key={cat}>
                      <Td className="capitalize">{cat}</Td>
                      <Td className="tnum text-right text-text-2">{m.samples}</Td>
                      <Td className="tnum text-right font-medium">{m.quality_index?.toFixed(1)}</Td>
                      <Td className="tnum text-right">{pct(m.recall_at_k)}</Td>
                      <Td className="tnum text-right">{m.mrr?.toFixed(3)}</Td>
                      <Td className="tnum text-right">{pct(m.answer_correctness)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Loading />
            )}
          </Panel>
          <Panel className="lg:col-span-5">
            <PanelHeader title="Recommendations" />
            <ul className="space-y-3">
              {insights?.recommendations.map((r) => (
                <li key={r.title} className="flex gap-3">
                  <Lightbulb size={16} className="mt-0.5 shrink-0 text-accent" />
                  <div>
                    <div className="flex items-center gap-2 text-sm text-text">
                      {r.title}
                      <Badge tone={r.impact === "high" ? "warning" : "muted"}>{r.impact}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-2">{r.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {results && <ResultsTable results={results} />}
    </>
  );
}

function Stat({ label, value, tone: t }: { label: string; value: string; tone?: "critical" }) {
  return (
    <div>
      <div className="text-[11px] text-muted">{label}</div>
      <div className={clsx("tnum text-base font-semibold", t ? "text-critical" : "text-text")}>{value}</div>
    </div>
  );
}

type ResultFilter = "all" | "misses" | "failed";

function ResultsTable({ results }: { results: SampleResult[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const rows = results.filter((r) =>
    filter === "failed" ? r.status === "failed" : filter === "misses" ? r.status === "completed" && (r.metrics.mrr ?? 0) < 1 : true,
  );

  return (
    <Panel className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <PanelHeader title="Per-question Results" subtitle="Expand a row for the answer, retrieved context and trace" className="mb-0" />
        <div className="w-full max-w-sm">
          <Segmented<ResultFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All (${results.length})` },
              { value: "misses", label: "Rank misses" },
              { value: "failed", label: "Failed" },
            ]}
          />
        </div>
      </div>
      <Table minWidth="min-w-[860px]">
        <thead>
          <tr>
            <Th className="w-8" />
            <Th>Question</Th>
            <Th>Category</Th>
            <Th className="text-right">MRR</Th>
            <Th className="text-right">Recall@K</Th>
            <Th className="text-right">Faithful</Th>
            <Th className="text-right">Correct</Th>
            <Th className="text-right">Latency</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <Td className="text-text-2">{open === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</Td>
                <Td className="max-w-[420px]">
                  <div className="truncate" title={r.question}>
                    <span className="mr-2 text-xs text-muted">{r.sample_id}</span>
                    {r.question}
                  </div>
                </Td>
                <Td className="text-xs capitalize text-text-2">{r.category ?? "—"}</Td>
                {r.status === "failed" ? (
                  <td colSpan={4} className="border-b border-border/60 px-3 py-2.5 text-right text-xs text-critical" title={r.error ?? undefined}>
                    failed
                  </td>
                ) : (
                  <>
                    <ScoreCell value={r.metrics.mrr} />
                    <ScoreCell value={r.metrics.recall_at_k} />
                    <ScoreCell value={r.metrics.faithfulness} />
                    <ScoreCell value={r.metrics.answer_correctness} />
                  </>
                )}
                <Td className="tnum text-right text-text-2">{ms(r.latency_ms)}</Td>
              </tr>
              {open === r.id && (
                <tr>
                  <td colSpan={8} className="border-b border-border bg-bg-elevated/60 p-5">
                    <SampleDetail result={r} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}

function ScoreCell({ value }: { value: number | null | undefined }) {
  const t = tone(value);
  return (
    <Td className="text-right">
      <span className="tnum inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[t] }} aria-hidden />
        {value == null ? "—" : value.toFixed(2)}
      </span>
    </Td>
  );
}

function SampleDetail({ result }: { result: SampleResult }) {
  const { data: trace } = useApi<Trace>(result.trace_id ? `/traces/${result.trace_id}` : null);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        {result.error && <p className="rounded-md border border-critical/30 bg-critical/10 p-2 text-xs text-critical">{result.error}</p>}
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Generated answer</div>
          <p className="text-sm leading-relaxed text-text">{result.generated_answer ?? "—"}</p>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Reference answer</div>
          <p className="text-sm leading-relaxed text-text-2">{result.reference_answer}</p>
        </div>
        {result.judge_rationale && (
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted">Judge rationale</div>
            <p className="text-sm text-text-2">{result.judge_rationale}</p>
          </div>
        )}
        <div className="grid grid-cols-4 gap-2 text-xs">
          {Object.entries(result.metrics).map(([k, v]) => (
            <div key={k} className="rounded-md border border-border bg-panel px-2 py-1.5">
              <div className="truncate text-muted">{metricLabel(k)}</div>
              <div className="tnum text-text">{v?.toFixed(3)}</div>
            </div>
          ))}
        </div>
        {trace && (
          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">
              Trace · {ms(trace.duration_ms)} · {result.input_tokens + result.output_tokens} tokens
            </div>
            <TraceWaterfall spans={trace.spans} total={trace.duration_ms} />
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">
          Retrieved context · relevant docs: {result.relevant_doc_ids.join(", ")}
        </div>
        <ol className="space-y-2">
          {result.retrieved.map((c) => (
            <li key={c.chunk_id} className="rounded-lg border border-border bg-panel p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-text">
                  {c.relevant ? <CheckCircle2 size={13} className="text-good" /> : <XCircle size={13} className="text-muted" />}#{c.rank} · {c.title}
                </span>
                <span className="tnum text-muted">
                  {c.doc_id} · score {c.score.toFixed(3)}
                </span>
              </div>
              <p className="line-clamp-3 text-xs leading-relaxed text-text-2">{c.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
