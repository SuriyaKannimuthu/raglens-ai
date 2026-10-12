"use client";

import { CheckCircle2, CircleHelp, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { TraceWaterfall } from "@/components/charts/Bars";
import { ConfigForm, DEFAULT_CONFIG } from "@/components/ConfigForm";
import { Button, ErrorState, PageHeader, Panel, PanelHeader, inputClass } from "@/components/ui";
import { api, type Dataset, type PipelineConfig, type PlaygroundResult, type SystemConfig } from "@/lib/api";
import { ms, usd } from "@/lib/format";
import { useApi } from "@/lib/hooks";

export default function PlaygroundPage() {
  const { data: system } = useApi<SystemConfig>("/config");
  const { data: dataset } = useApi<Dataset>("/datasets/sample_dataset");
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [question, setQuestion] = useState("How should I handle ERR-4090?");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    if (question.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.query({ ...config, dataset: "sample_dataset", question }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="RAG Playground" subtitle="Ask one question, inspect what was retrieved, and see the traced timing of every stage." />
      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-4">
          <PanelHeader title="Configuration" />
          <ConfigForm config={config} onChange={setConfig} system={system} compact />
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-8">
          <Panel>
            <form onSubmit={ask} className="flex gap-2">
              <input className={inputClass} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about the sample corpus…" maxLength={2000} />
              <Button type="submit" variant="primary" loading={busy}>
                <Send size={14} /> Ask
              </Button>
            </form>
            {dataset && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {dataset.samples.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setQuestion(s.question)}
                    className="rounded-full border border-border-strong bg-panel-2 px-2.5 py-1 text-[11px] text-text-2 hover:border-accent/40 hover:text-text"
                  >
                    {s.question}
                  </button>
                ))}
              </div>
            )}
          </Panel>

          {error ? <ErrorState error={error} /> : null}

          {result && (
            <>
              <Panel>
                <PanelHeader
                  title="Answer"
                  right={
                    <span className="text-xs text-text-2">
                      {result.model} · {ms(result.latency_ms)} · {result.input_tokens + result.output_tokens} tokens{result.tokens_estimated ? " (est.)" : ""} ·{" "}
                      {usd(result.cost_usd)}
                    </span>
                  }
                />
                <p className="text-base leading-relaxed text-text">{result.answer}</p>
                <div className="mt-5 border-t border-border pt-4">
                  <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Trace</div>
                  <TraceWaterfall spans={result.trace.spans} total={result.trace.duration_ms} />
                </div>
              </Panel>
              <Panel>
                <PanelHeader
                  title="Retrieved Context"
                  info="When the question matches a labelled dataset question, chunks are marked relevant or not using its ground-truth labels."
                />
                <ol className="space-y-2.5">
                  {result.retrieved.map((c) => (
                    <li key={c.chunk_id} className="rounded-lg border border-border bg-bg-elevated/60 p-3">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-text">
                          {c.relevant === true ? (
                            <CheckCircle2 size={13} className="text-good" aria-label="relevant" />
                          ) : c.relevant === false ? (
                            <XCircle size={13} className="text-muted" aria-label="not relevant" />
                          ) : (
                            <CircleHelp size={13} className="text-muted" aria-label="unlabelled" />
                          )}
                          #{c.rank} · {c.title}
                        </span>
                        <span className="tnum text-muted">score {c.score.toFixed(4)}</span>
                      </div>
                      <p className="text-sm leading-relaxed text-text-2">{c.text}</p>
                    </li>
                  ))}
                </ol>
              </Panel>
            </>
          )}
        </div>
      </div>
    </>
  );
}
