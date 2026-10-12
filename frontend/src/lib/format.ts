export const METRIC_LABELS: Record<string, string> = {
  quality_index: "Quality Index",
  context_precision: "Context Precision",
  context_recall: "Context Recall",
  precision_at_k: "Precision@K",
  recall_at_k: "Recall@K",
  mrr: "MRR",
  ndcg: "nDCG@K",
  hit_rate: "Hit Rate",
  faithfulness: "Faithfulness",
  answer_relevancy: "Answer Relevancy",
  answer_correctness: "Answer Correctness",
  latency_p95_ms: "Latency p95",
};

export const RETRIEVAL_METRICS = ["context_precision", "context_recall", "precision_at_k", "recall_at_k", "mrr", "ndcg", "hit_rate"];
export const ANSWER_METRICS = ["faithfulness", "answer_relevancy", "answer_correctness"];

export const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key.replace(/_/g, " ");
}

export function pct(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function score(value: number | null | undefined, digits = 3): string {
  return value == null ? "—" : value.toFixed(digits);
}

export function ms(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  if (value >= 100) return `${value.toFixed(0)}ms`;
  return `${value.toFixed(1)}ms`;
}

export function usd(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export function compact(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function signed(value: number | null | undefined, digits = 2, suffix = ""): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  return `${sign}${Math.abs(value).toFixed(digits)}${suffix}`;
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function configSummary(config: { retrieval_method: string; reranking_enabled: boolean; top_k: number; chunking_strategy: string }): string {
  return [config.retrieval_method, config.reranking_enabled ? "rerank" : null, `k=${config.top_k}`, config.chunking_strategy]
    .filter(Boolean)
    .join(" · ");
}

/** Status tone for a 0-1 quality metric. */
export function tone(value: number | null | undefined): "good" | "warning" | "critical" | "muted" {
  if (value == null) return "muted";
  if (value >= 0.8) return "good";
  if (value >= 0.6) return "warning";
  return "critical";
}
