from types import SimpleNamespace

import pytest

from app.evaluation.dataset import EvaluationDataset
from app.evaluation.evaluator import aggregate_metrics, evaluate_sample, is_abstention
from app.experiments.comparison import check_regression, compare_runs
from app.experiments.insights import recommend
from app.monitoring.tracing import Trace
from app.rag.pipeline import PipelineConfig, RAGPipeline
from app.schemas.requests import RegressionCheckRequest

# Quality floor for the default configuration on the bundled dataset. Changes to chunking,
# retrieval or metrics that drop below it fail CI (automated regression testing).
MIN_QUALITY_INDEX = 78.0


def test_sample_dataset_is_valid(dataset):
    assert len(dataset.documents) >= 10
    assert len(dataset.samples) >= 20
    assert {"keyword", "paraphrase", "multi-hop"} <= {s.category for s in dataset.samples}


def test_dataset_rejects_unknown_relevant_documents():
    with pytest.raises(ValueError, match="unknown documents"):
        EvaluationDataset.model_validate({
            "name": "broken",
            "documents": [{"id": "a", "title": "A", "text": "x"}],
            "samples": [{"id": "q", "question": "what?", "reference_answer": "x", "relevant_doc_ids": ["b"]}],
        })


def test_abstention_detection():
    assert is_abstention("I don't know based on the provided context.")
    assert not is_abstention("The Pro plan costs $49.")


async def _run(dataset, **overrides):
    config = PipelineConfig(llm_provider="local", **overrides)
    pipeline = RAGPipeline(config, dataset.to_documents())
    per_sample = []
    for sample in dataset.samples:
        result = await pipeline.query(sample.question, Trace("test"))
        evaluation = await evaluate_sample(sample, result, pipeline.corpus.chunks_per_doc, config.top_k)
        assert all(0.0 <= v <= 1.0 for v in evaluation.metrics.values())
        per_sample.append(evaluation.metrics)
    return aggregate_metrics(per_sample)


async def test_default_configuration_meets_quality_floor(dataset):
    metrics = await _run(dataset)
    assert metrics["quality_index"] >= MIN_QUALITY_INDEX
    assert metrics["hit_rate"] >= 0.9


async def test_hybrid_reranking_does_not_regress_vector_baseline(dataset):
    baseline = await _run(dataset, retrieval_method="vector")
    candidate = await _run(dataset, retrieval_method="hybrid", reranking_enabled=True)
    assert candidate["mrr"] >= baseline["mrr"]
    assert candidate["quality_index"] >= baseline["quality_index"]


def _fake_run(run_id, quality, mrr, p95=10.0, **config):
    return SimpleNamespace(
        id=run_id, name=run_id, status="completed", dataset="sample_dataset",
        metrics={"quality_index": quality, "mrr": mrr, "faithfulness": 0.9, "recall_at_k": 0.95,
                 "context_precision": 0.9, "answer_correctness": 0.7},
        operational={"latency_ms": {"p50": p95 / 2, "p95": p95}, "failure_rate": 0.0, "cost": {}, "tokens": {}},
        config={"retrieval_method": "hybrid", "reranking_enabled": True, "llm_provider": "anthropic", **config},
    )


def test_regression_check_flags_metric_drop():
    baseline, candidate = _fake_run("base", 85.0, 0.95), _fake_run("cand", 80.0, 0.80)
    report = check_regression(baseline, candidate, RegressionCheckRequest(candidate_run_id="cand"))
    assert not report["passed"]
    assert {"quality_index", "mrr"} <= set(report["regressions"])


def test_regression_check_passes_within_threshold():
    baseline, candidate = _fake_run("base", 85.0, 0.95), _fake_run("cand", 84.5, 0.94)
    report = check_regression(baseline, candidate, RegressionCheckRequest(candidate_run_id="cand"))
    assert report["passed"]


def test_regression_check_gates_latency():
    baseline, candidate = _fake_run("base", 85.0, 0.95, p95=100), _fake_run("cand", 85.0, 0.95, p95=400)
    report = check_regression(baseline, candidate, RegressionCheckRequest(candidate_run_id="cand"))
    assert report["regressions"] == ["latency_p95_ms"]


def test_compare_runs_reports_deltas_and_winner():
    a, b = _fake_run("a", 80.0, 0.9), _fake_run("b", 86.0, 0.95)
    result = compare_runs([a, b], {}, baseline_id="a")
    assert result["winner_run_id"] == "b"
    delta = next(r for r in result["runs"] if r["run_id"] == "b")["deltas"]["quality_index"]
    assert delta == pytest.approx(6.0)


def test_recommendations_suggest_hybrid_for_low_recall_vector_runs():
    run = _fake_run("v", 70.0, 0.6, retrieval_method="vector", reranking_enabled=False)
    run.metrics["recall_at_k"] = 0.6
    titles = [r["title"] for r in recommend(run)]
    assert "Switch to hybrid retrieval" in titles
    assert "Enable reranking" in titles
