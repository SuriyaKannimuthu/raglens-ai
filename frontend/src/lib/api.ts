// Typed client for the RAGLens FastAPI backend. Requests go through the Next.js
// rewrite at /api/* (see next.config.ts), so the browser never needs CORS.

export const API_BASE = "/api";

export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface PipelineConfig {
  retrieval_method: "vector" | "bm25" | "hybrid";
  embedding_model: string;
  chunking_strategy: "recursive" | "sentence" | "fixed";
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  fusion: "rrf" | "weighted";
  hybrid_alpha: number;
  reranking_enabled: boolean;
  reranker: "lexical" | "llm";
  rerank_candidates: number;
  llm_provider: "local" | "anthropic" | null;
  llm_model: string | null;
}

export interface LatencyStats {
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max?: number | null;
}

export interface Operational {
  latency_ms?: LatencyStats;
  retrieval_ms?: LatencyStats;
  generation_ms?: LatencyStats;
  failure_rate?: number;
  tokens?: { input: number; output: number; total: number; avg_per_query: number; estimated: boolean };
  cost?: {
    generation_usd: number;
    evaluation_usd: number;
    total_usd: number;
    per_query_usd: number;
    projected_model: string;
    projected_total_usd: number;
    projected_per_query_usd: number;
  };
  throughput_qps?: number | null;
  wall_seconds?: number;
  generator_model?: string;
}

export type Metrics = Record<string, number | null>;

export interface Run {
  id: string;
  name: string;
  dataset: string;
  status: RunStatus;
  judge_mode: string;
  config: PipelineConfig;
  tags: Record<string, string>;
  metrics: Metrics;
  operational: Operational;
  total_samples: number;
  completed_samples: number;
  failed_samples: number;
  is_baseline: boolean;
  mlflow_run_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface RetrievedChunk {
  rank: number;
  chunk_id: string;
  doc_id: string;
  title: string;
  score: number;
  text: string;
  relevant: boolean | null;
}

export interface SampleResult {
  id: string;
  sample_id: string;
  category: string | null;
  question: string;
  reference_answer: string;
  generated_answer: string | null;
  relevant_doc_ids: string[];
  retrieved: RetrievedChunk[];
  metrics: Metrics;
  judge_rationale: string | null;
  latency_ms: number;
  retrieval_ms: number;
  generation_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  status: "completed" | "failed";
  error: string | null;
  trace_id: string | null;
}

export interface Span {
  name: string;
  start_ms: number;
  duration_ms: number;
  status: string;
  error: string | null;
  attributes: Record<string, unknown>;
}

export interface Trace {
  id: string;
  run_id: string | null;
  sample_id: string | null;
  source: "evaluation" | "playground";
  question: string;
  status: "ok" | "error";
  error: string | null;
  duration_ms: number;
  spans: Span[];
  attributes: Record<string, unknown>;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface RunBrief {
  run_id: string;
  name: string;
  status: RunStatus;
  dataset: string;
  retrieval_method: string;
  reranking_enabled: boolean;
  quality_index: number | null;
  trend: number | null;
  progress: number;
  is_baseline: boolean;
  created_at: string;
}

export interface Recommendation {
  title: string;
  detail: string;
  impact: "high" | "medium" | "low";
  metric: string | null;
}

export interface Alert {
  severity: "critical" | "warning";
  run_id: string;
  message: string;
}

export interface Overview {
  counts: { runs: number; completed: number; running: number; failed: number; queries_evaluated: number };
  latest_run: RunBrief | null;
  best_run: RunBrief | null;
  baseline_run: RunBrief | null;
  kpis: Record<string, { value: number | null; delta: number | null }>;
  operational: {
    latency_p50_ms?: number | null;
    latency_p95_ms?: number | null;
    failure_rate?: number | null;
    cost_per_query_usd?: number | null;
    projected_cost_per_query_usd?: number | null;
    projected_model?: string;
    tokens_per_query?: number | null;
    tokens_estimated?: boolean;
  };
  radar: {
    metrics: string[];
    focus: { run_id: string; name: string; values: Metrics } | null;
    baseline: { run_id: string; name: string; values: Metrics } | null;
  };
  trend: {
    run_id: string;
    name: string;
    created_at: string;
    quality_index: number | null;
    latency_p95_ms: number | null;
    recall_at_k: number | null;
    faithfulness: number | null;
  }[];
  weakest_metrics: { metric: string; value: number }[];
  runs: RunBrief[];
  recent_traces: Trace[];
  recommendations: Recommendation[];
  alerts: Alert[];
}

export interface MetricDefinition {
  key: string;
  label: string;
  group: "retrieval" | "answer";
  description: string;
}

export interface SystemConfig {
  app_name: string;
  environment: string;
  llm: {
    default_provider: string;
    providers: { name: string; model: string; available: boolean; description: string }[];
    judge_model: string;
    cost_reference_model: string;
    pricing_per_mtok: Record<string, { input: number; output: number }>;
  };
  embedding_models: { name: string; description: string; dimension: number; local: boolean; available: boolean }[];
  retrieval_methods: string[];
  chunking_strategies: string[];
  rerankers: { name: string; available: boolean }[];
  judges: { name: string; available: boolean }[];
  vector_store: string;
  integrations: { mlflow: { enabled: boolean; tracking_uri: string | null }; opentelemetry: { enabled: boolean } };
  metrics: MetricDefinition[];
  quality_weights: Record<string, number>;
}

export interface DatasetSummary {
  name: string;
  description: string;
  documents: number;
  samples: number;
  categories: string[];
}

export interface Dataset {
  name: string;
  description: string;
  documents: { id: string; title: string; text: string }[];
  samples: { id: string; question: string; reference_answer: string; relevant_doc_ids: string[]; category: string | null }[];
}

export interface Comparison {
  baseline_run_id: string;
  runs: {
    run_id: string;
    name: string;
    status: RunStatus;
    dataset: string;
    is_baseline: boolean;
    config: PipelineConfig;
    metrics: Metrics;
    deltas: Metrics;
    operational: Record<string, number | null>;
  }[];
  best_by_metric: Record<string, string | null>;
  winner_run_id: string | null;
  sample_diffs: {
    sample_id: string;
    question: string;
    spread: number;
    runs: Record<string, { quality: number | null; mrr: number | null; answer_correctness: number | null; status: string }>;
  }[];
}

export interface RegressionReport {
  baseline_run_id: string;
  candidate_run_id: string;
  passed: boolean;
  regressions: string[];
  checks: { metric: string; baseline: number; candidate: number; delta: number; allowed_drop: number; passed: boolean }[];
}

export interface MonitoringSummary {
  window: number;
  latency_ms: { avg: number | null; p50: number | null; p95: number | null; p99: number | null };
  failure_rate: number;
  errors: number;
  tokens: { input: number; output: number };
  cost_usd: number;
  stages: Record<string, { avg_ms: number; p95_ms: number; count: number }>;
  latency_histogram: { from_ms: number; to_ms: number | null; count: number }[];
  runs: {
    run_id: string;
    name: string;
    created_at: string;
    quality_index: number | null;
    latency_p50_ms: number | null;
    latency_p95_ms: number | null;
    failure_rate: number | null;
    tokens_total: number | null;
    cost_total_usd: number | null;
    projected_cost_total_usd: number | null;
    throughput_qps: number | null;
  }[];
  run_status_counts: Record<string, number>;
  live: {
    uptime_seconds: number;
    http: { requests_total: number; server_errors_total: number; latency_ms: LatencyStats & { count: number } };
    pipeline: { queries_total: number; failures_total: number; failure_rate: number };
  };
}

export interface PlaygroundResult {
  question: string;
  answer: string;
  model: string;
  retrieved: RetrievedChunk[];
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  tokens_estimated: boolean;
  trace: Trace;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail))
        message = body.detail.map((d: { loc?: string[]; msg: string }) => `${d.loc?.slice(1).join(".")}: ${d.msg}`).join("; ");
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const fetcher = <T,>(path: string) => request<T>(path);

export const api = {
  startEvaluation: (body: Record<string, unknown>) =>
    request<{ run_id: string; status: string; message: string }>("/evaluations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  markBaseline: (runId: string) => request<Run>(`/evaluations/${runId}/baseline`, { method: "POST" }),
  deleteRun: (runId: string) => request<void>(`/evaluations/${runId}`, { method: "DELETE" }),
  compare: (runIds: string[], baselineRunId?: string) =>
    request<Comparison>("/experiments/compare", {
      method: "POST",
      body: JSON.stringify({ run_ids: runIds, baseline_run_id: baselineRunId }),
    }),
  regressionCheck: (body: { candidate_run_id: string; baseline_run_id?: string; default_max_drop?: number }) =>
    request<RegressionReport>("/experiments/regression-check", { method: "POST", body: JSON.stringify(body) }),
  query: (body: Record<string, unknown>) =>
    request<PlaygroundResult>("/query", { method: "POST", body: JSON.stringify(body) }),
};
