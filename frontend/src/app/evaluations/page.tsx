"use client";

import { Plus, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge, ErrorState, LinkButton, Loading, PageHeader, Panel, ProgressBar, Segmented, StatusBadge, Table, Td, Th } from "@/components/ui";
import type { Run } from "@/lib/api";
import { configSummary, dateTime, ms, pct, usd } from "@/lib/format";
import { useApi } from "@/lib/hooks";

type Filter = "all" | "completed" | "running" | "failed";

export default function EvaluationsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const query = filter === "all" ? "/evaluations?limit=200" : `/evaluations?limit=200&status=${filter}`;
  const { data, error, isLoading } = useApi<{ items: Run[]; total: number }>(query, {
    refreshInterval: (latest) => (latest?.items.some((r) => r.status === "queued" || r.status === "running") ? 1500 : 10000),
  });

  return (
    <>
      <PageHeader
        title="Evaluation Runs"
        subtitle="Every run evaluates one pipeline configuration against a labelled dataset."
        actions={
          <LinkButton href="/evaluations/new" variant="primary">
            <Plus size={15} /> New evaluation
          </LinkButton>
        }
      />
      <Panel className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="w-full max-w-md">
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "completed", label: "Completed" },
                { value: "running", label: "Running" },
                { value: "failed", label: "Failed" },
              ]}
            />
          </div>
          <span className="text-xs text-text-2">{data ? `${data.total} runs` : ""}</span>
        </div>
        {error ? (
          <ErrorState error={error} className="m-4" />
        ) : isLoading || !data ? (
          <Loading />
        ) : data.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-2">No runs match this filter.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Status</Th>
                <Th className="text-right">Quality</Th>
                <Th className="text-right">Recall@K</Th>
                <Th className="text-right">MRR</Th>
                <Th className="text-right">Faithfulness</Th>
                <Th className="text-right">p95 latency</Th>
                <Th className="text-right">Cost / query</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((run) => {
                const done = run.completed_samples + run.failed_samples;
                const cost = run.operational.cost;
                return (
                  <tr key={run.id} className="hover:bg-white/[0.02]">
                    <Td className="max-w-[340px]">
                      <Link href={`/evaluations/${run.id}`} className="flex items-center gap-2 font-medium text-text hover:text-accent">
                        <span className="truncate">{run.name}</span>
                        {run.is_baseline && (
                          <Badge tone="baseline">
                            <Star size={10} /> baseline
                          </Badge>
                        )}
                      </Link>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {configSummary(run.config)} · {run.config.embedding_model} · {run.config.llm_provider}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={run.status} />
                      {(run.status === "running" || run.status === "queued") && (
                        <div className="mt-1.5 w-24">
                          <ProgressBar value={run.total_samples ? done / run.total_samples : 0} />
                        </div>
                      )}
                    </Td>
                    <Td className="tnum text-right font-medium">{run.metrics.quality_index?.toFixed(1) ?? "—"}</Td>
                    <Td className="tnum text-right">{pct(run.metrics.recall_at_k)}</Td>
                    <Td className="tnum text-right">{run.metrics.mrr?.toFixed(3) ?? "—"}</Td>
                    <Td className="tnum text-right">{pct(run.metrics.faithfulness)}</Td>
                    <Td className="tnum text-right">{ms(run.operational.latency_ms?.p95)}</Td>
                    <Td className="tnum text-right" >
                      {cost ? (cost.per_query_usd ? usd(cost.per_query_usd) : <span title={`Projected at ${cost.projected_model} pricing`} className="text-text-2">{usd(cost.projected_per_query_usd)}*</span>) : "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-text-2">{dateTime(run.created_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      <p className="mt-3 text-xs text-muted">* Projected cost: the local generator is free, so cost is projected from its token usage at the reference model&apos;s pricing.</p>
    </>
  );
}
