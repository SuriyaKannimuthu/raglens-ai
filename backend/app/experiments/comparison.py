"""Experiment comparison and regression detection."""

from typing import Any

from app.database.models import EvaluationRun, SampleResult
from app.evaluation.metrics import METRIC_KEYS, quality_index
from app.schemas.requests import RegressionCheckRequest

COMPARED_METRICS = ["quality_index", *METRIC_KEYS]


def _ops_summary(run: EvaluationRun) -> dict[str, Any]:
    ops = run.operational or {}
    latency = ops.get("latency_ms", {})
    cost = ops.get("cost", {})
    return {
        "latency_p50_ms": latency.get("p50"),
        "latency_p95_ms": latency.get("p95"),
        "failure_rate": ops.get("failure_rate"),
        "tokens_per_query": ops.get("tokens", {}).get("avg_per_query"),
        "cost_per_query_usd": cost.get("per_query_usd"),
        "projected_cost_per_query_usd": cost.get("projected_per_query_usd"),
    }


def compare_runs(
    runs: list[EvaluationRun], samples: dict[str, list[SampleResult]], baseline_id: str | None = None
) -> dict[str, Any]:
    baseline = next((r for r in runs if r.id == baseline_id), runs[0])
    table = []
    for run in runs:
        metrics = {k: run.metrics.get(k) for k in COMPARED_METRICS}
        deltas = {
            k: (round(v - baseline.metrics[k], 4) if v is not None and baseline.metrics.get(k) is not None else None)
            for k, v in metrics.items()
        }
        table.append({
            "run_id": run.id, "name": run.name, "status": run.status, "dataset": run.dataset,
            "is_baseline": run.id == baseline.id, "config": run.config, "metrics": metrics,
            "deltas": deltas, "operational": _ops_summary(run),
        })

    best: dict[str, str | None] = {}
    for key in COMPARED_METRICS:
        candidates = [(r.metrics.get(key), r.id) for r in runs if r.metrics.get(key) is not None]
        best[key] = max(candidates)[1] if candidates else None

    # Per-question view: where do configurations disagree the most?
    by_sample: dict[str, dict[str, Any]] = {}
    for run in runs:
        for s in samples.get(run.id, []):
            entry = by_sample.setdefault(s.sample_id, {"sample_id": s.sample_id, "question": s.question, "runs": {}})
            entry["runs"][run.id] = {
                "quality": quality_index(s.metrics) if s.metrics else None,
                "mrr": s.metrics.get("mrr"),
                "answer_correctness": s.metrics.get("answer_correctness"),
                "status": s.status,
            }

    def spread(entry: dict[str, Any]) -> float:
        values = [v["quality"] for v in entry["runs"].values() if v["quality"] is not None]
        return (max(values) - min(values)) if len(values) > 1 else 0.0

    sample_diffs = sorted(by_sample.values(), key=spread, reverse=True)[:12]
    for entry in sample_diffs:
        entry["spread"] = round(spread(entry), 2)

    winner = best.get("quality_index")
    return {
        "baseline_run_id": baseline.id,
        "runs": table,
        "best_by_metric": best,
        "winner_run_id": winner,
        "sample_diffs": sample_diffs,
    }


def check_regression(
    baseline: EvaluationRun, candidate: EvaluationRun, request: RegressionCheckRequest
) -> dict[str, Any]:
    checks = []
    for key in COMPARED_METRICS:
        base, cand = baseline.metrics.get(key), candidate.metrics.get(key)
        if base is None or cand is None:
            continue
        allowed = request.max_drop.get(key, request.default_max_drop)
        if key == "quality_index" and key not in request.max_drop:
            allowed = request.default_max_drop * 100
        delta = cand - base
        checks.append({
            "metric": key, "baseline": base, "candidate": cand, "delta": round(delta, 4),
            "allowed_drop": allowed, "passed": delta >= -allowed - 1e-9,
        })

    if request.max_latency_increase_pct is not None:
        base_p95 = (baseline.operational or {}).get("latency_ms", {}).get("p95")
        cand_p95 = (candidate.operational or {}).get("latency_ms", {}).get("p95")
        if base_p95 and cand_p95 is not None:
            # Sub-10ms latencies are noise; only gate on increases larger than 10ms.
            increase = (cand_p95 - base_p95) / base_p95 * 100
            checks.append({
                "metric": "latency_p95_ms", "baseline": base_p95, "candidate": cand_p95,
                "delta": round(cand_p95 - base_p95, 3), "allowed_drop": request.max_latency_increase_pct,
                "passed": increase <= request.max_latency_increase_pct or (cand_p95 - base_p95) < 10,
            })

    failed = [c for c in checks if not c["passed"]]
    return {
        "baseline_run_id": baseline.id,
        "candidate_run_id": candidate.id,
        "passed": not failed,
        "regressions": [c["metric"] for c in failed],
        "checks": checks,
    }
