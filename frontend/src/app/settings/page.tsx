"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { Badge, ErrorState, Loading, PageHeader, Panel, PanelHeader, Table, Td, Th } from "@/components/ui";
import type { SystemConfig } from "@/lib/api";
import { metricLabel } from "@/lib/format";
import { useApi } from "@/lib/hooks";

function Status({ ok, label }: { ok: boolean; label?: string }) {
  return ok ? (
    <Badge tone="good">
      <CheckCircle2 size={11} /> {label ?? "available"}
    </Badge>
  ) : (
    <Badge tone="muted">
      <XCircle size={11} /> {label ?? "not configured"}
    </Badge>
  );
}

export default function SettingsPage() {
  const { data, error } = useApi<SystemConfig>("/config");
  if (error) return <ErrorState error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Read-only view of the backend configuration. Change it with environment variables (see backend/.env.example)."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="LLM Providers" />
          <ul className="space-y-3">
            {data.llm.providers.map((p) => (
              <li key={p.name} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-bg-elevated/60 p-3">
                <div>
                  <div className="text-sm font-medium text-text">
                    {p.name} <span className="font-normal text-text-2">· {p.model}</span>
                  </div>
                  <div className="text-xs text-text-2">{p.description}</div>
                </div>
                <Status ok={p.available} />
              </li>
            ))}
          </ul>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Default provider</dt>
              <dd className="text-text">{data.llm.default_provider}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">LLM judge model</dt>
              <dd className="text-text">{data.llm.judge_model}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Cost projection model</dt>
              <dd className="text-text">{data.llm.cost_reference_model}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Vector store</dt>
              <dd className="text-text">{data.vector_store}</dd>
            </div>
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title="Integrations" />
          <ul className="space-y-3">
            <li className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated/60 p-3">
              <div>
                <div className="text-sm font-medium text-text">MLflow experiment tracking</div>
                <div className="text-xs text-text-2">{data.integrations.mlflow.tracking_uri ?? "Set MLFLOW_TRACKING_URI to enable"}</div>
              </div>
              <Status ok={data.integrations.mlflow.enabled} label={data.integrations.mlflow.enabled ? "tracking" : undefined} />
            </li>
            <li className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated/60 p-3">
              <div>
                <div className="text-sm font-medium text-text">OpenTelemetry tracing</div>
                <div className="text-xs text-text-2">Set OTEL_ENABLED=true and OTEL_EXPORTER_OTLP_ENDPOINT</div>
              </div>
              <Status ok={data.integrations.opentelemetry.enabled} label={data.integrations.opentelemetry.enabled ? "exporting" : undefined} />
            </li>
            <li className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated/60 p-3">
              <div>
                <div className="text-sm font-medium text-text">Prometheus metrics</div>
                <div className="text-xs text-text-2">Scrape GET /metrics on the API</div>
              </div>
              <Status ok label="enabled" />
            </li>
          </ul>
          <div className="mt-4">
            <div className="mb-2 text-xs text-muted">Embedding models</div>
            <ul className="space-y-1.5 text-sm">
              {data.embedding_models.map((m) => (
                <li key={m.name} className="flex items-center justify-between gap-2">
                  <span className="truncate text-text" title={m.description}>
                    {m.name} <span className="text-xs text-muted">{m.dimension}d</span>
                  </span>
                  <Status ok={m.available} label={m.available ? "ready" : "not installed"} />
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel className="p-0 lg:col-span-2">
          <div className="p-5 pb-0">
            <PanelHeader title="Metric Definitions" subtitle="Quality index weights shown where a metric contributes to it." />
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Metric</Th>
                <Th>Group</Th>
                <Th>Definition</Th>
                <Th className="text-right">QI weight</Th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.key}>
                  <Td className="whitespace-nowrap font-medium">{metricLabel(m.key)}</Td>
                  <Td>
                    <Badge tone={m.group === "retrieval" ? "accent" : "good"}>{m.group}</Badge>
                  </Td>
                  <Td className="whitespace-normal text-text-2">{m.description}</Td>
                  <Td className="tnum text-right">{data.quality_weights[m.key] ? `${(data.quality_weights[m.key] * 100).toFixed(0)}%` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel className="p-0 lg:col-span-2">
          <div className="p-5 pb-0">
            <PanelHeader title="Model Pricing" subtitle="USD per million tokens, used for cost estimation" />
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Model</Th>
                <Th className="text-right">Input</Th>
                <Th className="text-right">Output</Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.llm.pricing_per_mtok).map(([model, p]) => (
                <tr key={model}>
                  <Td>{model}</Td>
                  <Td className="tnum text-right">${p.input.toFixed(2)}</Td>
                  <Td className="tnum text-right">${p.output.toFixed(2)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  );
}
