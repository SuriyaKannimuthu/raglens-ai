"""Metric implementations. All functions are pure and return values in [0, 1].

Retrieval metrics are computed from ground-truth relevance labels (document ids), so they
are exact. Answer metrics have two implementations: the deterministic heuristics below
(token overlap based, used by default and in tests) and LLM-as-a-judge versions in
``judge.py``. The method used is recorded with every run.
"""

import math
from collections import Counter
from dataclasses import dataclass

from app.core.text import content_terms, split_sentences

# --------------------------------------------------------------------------- retrieval


def precision_at_k(relevances: list[bool], k: int) -> float:
    if k <= 0:
        return 0.0
    return sum(relevances[:k]) / k


def recall_at_k(retrieved_doc_ids: list[str], relevant_doc_ids: set[str], k: int) -> float:
    """Fraction of relevant documents represented among the top-k retrieved chunks."""
    if not relevant_doc_ids:
        return 0.0
    found = set(retrieved_doc_ids[:k]) & relevant_doc_ids
    return len(found) / len(relevant_doc_ids)


def reciprocal_rank(relevances: list[bool]) -> float:
    for rank, relevant in enumerate(relevances, start=1):
        if relevant:
            return 1.0 / rank
    return 0.0


def hit_rate(relevances: list[bool]) -> float:
    return 1.0 if any(relevances) else 0.0


def ndcg_at_k(relevances: list[bool], k: int, total_relevant: int) -> float:
    """Binary-relevance nDCG; the ideal ranking places min(k, total_relevant) hits first."""
    dcg = sum(1.0 / math.log2(i + 2) for i, rel in enumerate(relevances[:k]) if rel)
    ideal_hits = min(k, total_relevant)
    idcg = sum(1.0 / math.log2(i + 2) for i in range(ideal_hits))
    return dcg / idcg if idcg else 0.0


def context_precision(relevances: list[bool]) -> float:
    """Rank-weighted precision (average precision over the retrieved list), as defined by
    Ragas: relevant chunks ranked higher score better."""
    hits, total = 0, 0.0
    for k, relevant in enumerate(relevances, start=1):
        if relevant:
            hits += 1
            total += hits / k
    return total / hits if hits else 0.0


# --------------------------------------------------------------------------- answers


def term_coverage(statement: str, context: str) -> float:
    terms = set(content_terms(statement))
    if not terms:
        return 1.0
    return len(terms & set(content_terms(context))) / len(terms)


def statement_support(statements: list[str], contexts: list[str], threshold: float = 0.5) -> float:
    """Fraction of statements whose content terms are mostly present in a single context."""
    statements = [s for s in statements if content_terms(s)]
    if not statements:
        return 1.0
    if not contexts:
        return 0.0
    supported = sum(
        1 for s in statements if max(term_coverage(s, c) for c in contexts) >= threshold
    )
    return supported / len(statements)


def token_f1(prediction: str, reference: str) -> float:
    pred, ref = Counter(content_terms(prediction)), Counter(content_terms(reference))
    overlap = sum((pred & ref).values())
    if not pred or not ref or not overlap:
        return 0.0
    precision, recall = overlap / sum(pred.values()), overlap / sum(ref.values())
    return 2 * precision * recall / (precision + recall)


def cosine(a, b) -> float:
    return max(0.0, float(a @ b))


def heuristic_faithfulness(answer: str, contexts: list[str], abstained: bool) -> float:
    if abstained:
        return 1.0  # an abstention makes no unsupported claims
    return statement_support(split_sentences(answer), contexts)


def heuristic_context_recall(reference_answer: str, contexts: list[str]) -> float:
    return statement_support(split_sentences(reference_answer), contexts)


def heuristic_answer_relevancy(question: str, answer: str, similarity: float, abstained: bool) -> float:
    if abstained:
        return 0.0
    q_terms = set(content_terms(question))
    coverage = len(q_terms & set(content_terms(answer))) / len(q_terms) if q_terms else 0.0
    return min(1.0, 0.6 * coverage + 0.4 * min(1.0, similarity * 2))


def heuristic_correctness(answer: str, reference: str, similarity: float) -> float:
    """Mirrors Ragas answer_correctness weighting: 0.75 factual overlap + 0.25 similarity."""
    return min(1.0, 0.75 * token_f1(answer, reference) + 0.25 * similarity)


# --------------------------------------------------------------------------- catalog


@dataclass(frozen=True)
class MetricDefinition:
    key: str
    label: str
    group: str
    description: str


METRICS: list[MetricDefinition] = [
    MetricDefinition("context_precision", "Context Precision", "retrieval",
                     "Rank-weighted precision of retrieved chunks (relevant chunks ranked first score higher)."),
    MetricDefinition("context_recall", "Context Recall", "retrieval",
                     "Share of reference-answer statements supported by the retrieved context."),
    MetricDefinition("precision_at_k", "Precision@K", "retrieval",
                     "Proportion of the top K retrieved chunks that come from a relevant document."),
    MetricDefinition("recall_at_k", "Recall@K", "retrieval",
                     "Proportion of relevant documents found among the top K chunks."),
    MetricDefinition("mrr", "MRR", "retrieval", "Reciprocal rank of the first relevant chunk."),
    MetricDefinition("ndcg", "nDCG@K", "retrieval", "Normalized discounted cumulative gain (binary relevance)."),
    MetricDefinition("hit_rate", "Hit Rate", "retrieval", "Share of questions with at least one relevant chunk retrieved."),
    MetricDefinition("faithfulness", "Faithfulness", "answer",
                     "Share of answer statements supported by the retrieved context."),
    MetricDefinition("answer_relevancy", "Answer Relevancy", "answer",
                     "How directly the answer addresses the question."),
    MetricDefinition("answer_correctness", "Answer Correctness", "answer",
                     "Agreement between the generated answer and the reference answer."),
]

METRIC_KEYS = [m.key for m in METRICS]

QUALITY_WEIGHTS = {
    "context_precision": 0.15,
    "context_recall": 0.20,
    "mrr": 0.15,
    "faithfulness": 0.20,
    "answer_relevancy": 0.10,
    "answer_correctness": 0.20,
}


def quality_index(metrics: dict[str, float | None]) -> float | None:
    """Weighted composite of the core metrics on a 0-100 scale."""
    total, weight = 0.0, 0.0
    for key, w in QUALITY_WEIGHTS.items():
        value = metrics.get(key)
        if value is not None:
            total += w * value
            weight += w
    return round(100 * total / weight, 2) if weight else None


def mean(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return sum(present) / len(present) if present else None


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = (len(ordered) - 1) * pct / 100
    lo, hi = math.floor(idx), math.ceil(idx)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (idx - lo)
