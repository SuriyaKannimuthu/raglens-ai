"""Scores a single RAG query result against a dataset sample and aggregates run metrics."""

from dataclasses import dataclass, field
from typing import Literal

from app.evaluation import metrics as m
from app.evaluation.dataset import DatasetSample
from app.evaluation.judge import judge_answer
from app.rag.embeddings import get_embedder
from app.rag.llm import NO_ANSWER
from app.rag.pipeline import QueryResult

JudgeMode = Literal["heuristic", "llm"]

_SIMILARITY_MODEL = "local-hash-ngrams"


@dataclass
class SampleEvaluation:
    metrics: dict[str, float]
    relevances: list[bool]
    judge_rationale: str | None = None
    judge_input_tokens: int = 0
    judge_output_tokens: int = 0
    judge_model: str | None = None
    notes: list[str] = field(default_factory=list)


def is_abstention(answer: str) -> bool:
    return answer.strip().rstrip(".").lower() == NO_ANSWER.rstrip(".").lower()


def retrieval_metrics(
    sample: DatasetSample, result: QueryResult, chunks_per_doc: dict[str, int], top_k: int
) -> tuple[dict[str, float], list[bool]]:
    relevant = set(sample.relevant_doc_ids)
    doc_ids = [r.chunk.doc_id for r in result.retrieved]
    relevances = [d in relevant for d in doc_ids]
    total_relevant_chunks = sum(chunks_per_doc.get(d, 0) for d in relevant)
    return {
        "context_precision": m.context_precision(relevances),
        "precision_at_k": m.precision_at_k(relevances, top_k),
        "recall_at_k": m.recall_at_k(doc_ids, relevant, top_k),
        "mrr": m.reciprocal_rank(relevances),
        "ndcg": m.ndcg_at_k(relevances, top_k, total_relevant_chunks),
        "hit_rate": m.hit_rate(relevances),
    }, relevances


async def evaluate_sample(
    sample: DatasetSample,
    result: QueryResult,
    chunks_per_doc: dict[str, int],
    top_k: int,
    judge_mode: JudgeMode = "heuristic",
) -> SampleEvaluation:
    scores, relevances = retrieval_metrics(sample, result, chunks_per_doc, top_k)
    answer = result.generation.answer
    contexts = [r.chunk.text for r in result.retrieved]
    abstained = is_abstention(answer)

    if judge_mode == "llm":
        verdict = await judge_answer(sample.question, answer, sample.reference_answer, contexts)
        scores.update(
            faithfulness=verdict.faithfulness,
            context_recall=verdict.context_recall,
            answer_relevancy=verdict.answer_relevancy,
            answer_correctness=verdict.answer_correctness,
        )
        return SampleEvaluation(scores, relevances, verdict.rationale, verdict.input_tokens,
                                verdict.output_tokens, verdict.model)

    embedder = get_embedder(_SIMILARITY_MODEL)
    q_vec, a_vec, r_vec = embedder.embed([sample.question, answer, sample.reference_answer])
    scores.update(
        faithfulness=m.heuristic_faithfulness(answer, contexts, abstained),
        context_recall=m.heuristic_context_recall(sample.reference_answer, contexts),
        answer_relevancy=m.heuristic_answer_relevancy(sample.question, answer, m.cosine(q_vec, a_vec), abstained),
        answer_correctness=0.0 if abstained else m.heuristic_correctness(answer, sample.reference_answer,
                                                                          m.cosine(a_vec, r_vec)),
    )
    return SampleEvaluation(scores, relevances)


def aggregate_metrics(per_sample: list[dict[str, float]]) -> dict[str, float | None]:
    aggregated: dict[str, float | None] = {}
    for key in m.METRIC_KEYS:
        value = m.mean([s.get(key) for s in per_sample])
        aggregated[key] = round(value, 4) if value is not None else None
    aggregated["quality_index"] = m.quality_index(aggregated)
    return aggregated
