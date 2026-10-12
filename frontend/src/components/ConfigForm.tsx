"use client";

import { Field, Segmented, Toggle, inputClass } from "@/components/ui";
import type { PipelineConfig, SystemConfig } from "@/lib/api";

export const DEFAULT_CONFIG: PipelineConfig = {
  retrieval_method: "hybrid",
  embedding_model: "local-hash-ngrams",
  chunking_strategy: "recursive",
  chunk_size: 500,
  chunk_overlap: 50,
  top_k: 5,
  fusion: "rrf",
  hybrid_alpha: 0.5,
  reranking_enabled: true,
  reranker: "lexical",
  rerank_candidates: 20,
  llm_provider: "local",
  llm_model: null,
};

/** Pipeline configuration fields shared by the evaluation form and the playground. */
export function ConfigForm({
  config,
  onChange,
  system,
  compact = false,
}: {
  config: PipelineConfig;
  onChange: (config: PipelineConfig) => void;
  system?: SystemConfig;
  compact?: boolean;
}) {
  const set = <K extends keyof PipelineConfig>(key: K, value: PipelineConfig[K]) => onChange({ ...config, [key]: value });
  const claude = system?.llm.providers.find((p) => p.name === "anthropic");
  const llmReranker = system?.rerankers.find((r) => r.name === "llm");

  return (
    <div className={compact ? "space-y-4" : "grid gap-5 md:grid-cols-2"}>
      <Field label="Retrieval method">
        <Segmented
          value={config.retrieval_method}
          onChange={(v) => set("retrieval_method", v)}
          options={[
            { value: "vector", label: "Vector" },
            { value: "bm25", label: "BM25" },
            { value: "hybrid", label: "Hybrid" },
          ]}
        />
      </Field>

      <Field label="Embedding model" hint={config.retrieval_method === "bm25" ? "Not used by BM25 retrieval" : undefined}>
        <select className={inputClass} value={config.embedding_model} onChange={(e) => set("embedding_model", e.target.value)}>
          {(system?.embedding_models ?? [{ name: config.embedding_model, available: true, description: "" }]).map((m) => (
            <option key={m.name} value={m.name} disabled={!m.available}>
              {m.name}
              {m.available ? "" : " (not installed)"}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Chunking strategy">
        <Segmented
          value={config.chunking_strategy}
          onChange={(v) => set("chunking_strategy", v)}
          options={[
            { value: "recursive", label: "Recursive" },
            { value: "sentence", label: "Sentence" },
            { value: "fixed", label: "Fixed" },
          ]}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Chunk size · ${config.chunk_size} chars`}>
          <input type="range" min={150} max={1500} step={50} value={config.chunk_size} className="w-full"
            onChange={(e) => set("chunk_size", Number(e.target.value))} />
        </Field>
        <Field label={`Overlap · ${config.chunk_overlap} chars`}>
          <input type="range" min={0} max={300} step={10} value={config.chunk_overlap} className="w-full"
            onChange={(e) => set("chunk_overlap", Math.min(Number(e.target.value), config.chunk_size - 50))} />
        </Field>
      </div>

      <Field label={`Top K · ${config.top_k} chunks`}>
        <input type="range" min={1} max={15} value={config.top_k} className="w-full" onChange={(e) => set("top_k", Number(e.target.value))} />
      </Field>

      {config.retrieval_method === "hybrid" && (
        <Field label="Fusion" hint={config.fusion === "weighted" ? `Vector weight ${config.hybrid_alpha.toFixed(2)}` : "Reciprocal rank fusion (k=60)"}>
          <Segmented
            value={config.fusion}
            onChange={(v) => set("fusion", v)}
            options={[
              { value: "rrf", label: "RRF" },
              { value: "weighted", label: "Weighted" },
            ]}
          />
          {config.fusion === "weighted" && (
            <input type="range" min={0} max={1} step={0.05} value={config.hybrid_alpha} className="mt-2 w-full"
              onChange={(e) => set("hybrid_alpha", Number(e.target.value))} />
          )}
        </Field>
      )}

      <div className="space-y-3">
        <Toggle label="Second-stage reranking" checked={config.reranking_enabled} onChange={(v) => set("reranking_enabled", v)} />
        {config.reranking_enabled && (
          <Segmented
            value={config.reranker}
            onChange={(v) => set("reranker", v)}
            options={[
              { value: "lexical", label: "Lexical cross-scorer" },
              { value: "llm", label: "Claude (LLM)", disabled: !llmReranker?.available },
            ]}
          />
        )}
      </div>

      <Field
        label="Answer generator"
        hint={
          config.llm_provider === "anthropic"
            ? `Claude model ${claude?.model ?? ""}`
            : "Offline extractive generator - no API key, zero cost"
        }
      >
        <Segmented
          value={config.llm_provider ?? "local"}
          onChange={(v) => set("llm_provider", v)}
          options={[
            { value: "local", label: "Local extractive" },
            { value: "anthropic", label: claude?.available ? "Claude" : "Claude (no key)", disabled: !claude?.available },
          ]}
        />
      </Field>
    </div>
  );
}
