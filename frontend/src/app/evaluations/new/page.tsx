"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfigForm, DEFAULT_CONFIG } from "@/components/ConfigForm";
import { Button, ErrorState, Field, PageHeader, Panel, PanelHeader, Segmented, Toggle, inputClass } from "@/components/ui";
import { api, type DatasetSummary, type PipelineConfig, type SystemConfig } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export default function NewEvaluationPage() {
  const router = useRouter();
  const { data: system } = useApi<SystemConfig>("/config");
  const { data: datasets } = useApi<DatasetSummary[]>("/datasets");
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [name, setName] = useState("");
  const [dataset, setDataset] = useState("sample_dataset");
  const [judge, setJudge] = useState<"heuristic" | "llm">("heuristic");
  const [limit, setLimit] = useState<string>("");
  const [baseline, setBaseline] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const llmJudge = system?.judges.find((j) => j.name === "llm");
  const selected = datasets?.find((d) => d.name === dataset);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { run_id } = await api.startEvaluation({
        ...config,
        name: name.trim() || undefined,
        dataset,
        judge,
        sample_limit: limit ? Number(limit) : undefined,
        set_as_baseline: baseline,
      });
      router.push(`/evaluations/${run_id}`);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <PageHeader
        title="New Evaluation"
        subtitle="Configure a RAG pipeline and run it against a labelled dataset."
        actions={
          <Button type="submit" variant="primary" loading={submitting}>
            <Play size={14} /> Start evaluation
          </Button>
        }
      />
      {error ? <ErrorState error={error} className="mb-4" /> : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Pipeline configuration" subtitle="Chunking, retrieval, reranking and generation" />
          <ConfigForm config={config} onChange={setConfig} system={system} />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="Run" />
            <div className="space-y-4">
              <Field label="Name" hint="Optional - generated from the configuration if empty">
                <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hybrid + rerank, k=5" maxLength={200} />
              </Field>
              <Field label="Dataset" hint={selected ? `${selected.documents} documents · ${selected.samples} questions` : undefined}>
                <select className={inputClass} value={dataset} onChange={(e) => setDataset(e.target.value)}>
                  {(datasets ?? [{ name: "sample_dataset" }]).map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sample limit" hint="Evaluate only the first N questions (blank = all)">
                <input className={inputClass} type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="All" />
              </Field>
              <Toggle label="Mark as regression baseline" checked={baseline} onChange={setBaseline} />
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Answer evaluation" info="Retrieval metrics always use ground-truth relevance labels. This setting controls how answer metrics are scored." />
            <Segmented
              value={judge}
              onChange={setJudge}
              options={[
                { value: "heuristic", label: "Heuristic" },
                { value: "llm", label: "LLM judge", disabled: !llmJudge?.available },
              ]}
            />
            <p className="mt-3 text-xs leading-relaxed text-text-2">
              {judge === "heuristic"
                ? "Deterministic token-overlap scoring for faithfulness, context recall, relevancy and correctness. Free and reproducible."
                : `Claude (${system?.llm.judge_model}) grades each answer through a validated structured-output schema.`}
              {!llmJudge?.available && " Set ANTHROPIC_API_KEY on the backend to enable the LLM judge."}
            </p>
          </Panel>
        </div>
      </div>
    </form>
  );
}
