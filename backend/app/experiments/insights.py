"""Rule-based optimization recommendations derived from a run's metrics."""

from typing import Any

from app.database.models import EvaluationRun

_IMPACT_ORDER = {"high": 0, "medium": 1, "low": 2}


def recommend(run: EvaluationRun) -> list[dict[str, Any]]:
    m: dict[str, Any] = run.metrics or {}
    cfg: dict[str, Any] = run.config or {}
    ops: dict[str, Any] = run.operational or {}
    recs: list[dict[str, Any]] = []

    def add(title: str, detail: str, impact: str, metric: str | None = None) -> None:
        recs.append({"title": title, "detail": detail, "impact": impact, "metric": metric})

    recall, precision, mrr = m.get("recall_at_k"), m.get("context_precision"), m.get("mrr")
    if recall is not None and recall < 0.85:
        if cfg.get("retrieval_method") == "vector":
            add("Switch to hybrid retrieval",
                f"Recall@K is {recall:.0%}. Adding BM25 keyword matching usually recovers exact-term "
                "queries (codes, names, numbers) that embeddings miss.", "high", "recall_at_k")
        else:
            add("Widen the retrieval window",
                f"Recall@K is {recall:.0%}. Increase top_k (currently {cfg.get('top_k')}) or the chunk size "
                "so supporting passages make it into the context.", "high", "recall_at_k")
    if mrr is not None and mrr < 0.8 and not cfg.get("reranking_enabled"):
        add("Enable reranking",
            f"MRR is {mrr:.2f}: relevant chunks are retrieved but not ranked first. A second-stage "
            "reranker over a larger candidate pool fixes ordering.", "high", "mrr")
    if precision is not None and precision < 0.7:
        add("Reduce context noise",
            f"Context precision is {precision:.0%}. Lower top_k or use smaller, sentence-based chunks "
            "to cut irrelevant text sent to the LLM.", "medium", "context_precision")
    faithfulness = m.get("faithfulness")
    if faithfulness is not None and faithfulness < 0.85:
        add("Tighten answer grounding",
            f"Faithfulness is {faithfulness:.0%}. Strengthen the 'answer only from context' instruction "
            "and require the model to abstain when context is insufficient.", "high", "faithfulness")
    correctness = m.get("answer_correctness")
    if correctness is not None and correctness < 0.6:
        if cfg.get("llm_provider") == "local":
            add("Evaluate with an LLM generator",
                f"Answer correctness is {correctness:.0%} with the offline extractive generator. Run the same "
                "configuration with llm_provider=anthropic to measure generative answer quality.",
                "medium", "answer_correctness")
        else:
            add("Improve answer synthesis",
                f"Answer correctness is {correctness:.0%}. Review failing samples - retrieval may be right "
                "while the answer misses details.", "medium", "answer_correctness")
    relevancy = m.get("answer_relevancy")
    if relevancy is not None and relevancy < 0.6:
        add("Answer the question directly",
            f"Answer relevancy is {relevancy:.0%}. Prompt for a direct first-sentence answer.", "low",
            "answer_relevancy")

    failure_rate = ops.get("failure_rate") or 0
    if failure_rate > 0:
        add("Investigate failed queries",
            f"{failure_rate:.0%} of queries failed. Open the traces for error details.", "high", None)
    p95 = (ops.get("latency_ms") or {}).get("p95")
    if p95 is not None and p95 > 3000:
        add("Reduce tail latency",
            f"p95 latency is {p95 / 1000:.1f}s. Lower rerank candidates, reduce top_k, or use a lower effort "
            "setting for generation.", "medium", None)

    if not recs:
        add("Promote this configuration",
            "All tracked metrics are within healthy ranges. Mark this run as the regression baseline.",
            "low", None)
    recs.sort(key=lambda r: _IMPACT_ORDER[r["impact"]])
    return recs
