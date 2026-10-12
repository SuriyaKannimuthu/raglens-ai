from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import EvaluationRun, SampleResult, TraceRecord
from app.database.session import get_session
from app.experiments.insights import recommend
from app.schemas.responses import TraceOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

RADAR_METRICS = ["context_precision", "context_recall", "mrr", "ndcg",
                 "faithfulness", "answer_relevancy", "answer_correctness"]


def _qi(run: EvaluationRun | None) -> float | None:
    return run.metrics.get("quality_index") if run else None


def _brief(run: EvaluationRun, previous: EvaluationRun | None) -> dict:
    qi, prev = _qi(run), _qi(previous)
    return {
        "run_id": run.id, "name": run.name, "status": run.status, "dataset": run.dataset,
        "retrieval_method": run.config.get("retrieval_method"),
        "reranking_enabled": run.config.get("reranking_enabled"),
        "quality_index": qi,
        "trend": (round(qi - prev, 2) if qi is not None and prev is not None else None),
        "progress": (run.completed_samples + run.failed_samples) / run.total_samples if run.total_samples else 0,
        "is_baseline": run.is_baseline, "created_at": run.created_at,
    }


@router.get("/overview")
async def overview(session: AsyncSession = Depends(get_session)):
    rows = await session.execute(select(EvaluationRun).order_by(EvaluationRun.created_at))
    runs = list(rows.scalars())
    completed = [r for r in runs if r.status == "completed" and r.metrics]
    latest = completed[-1] if completed else None
    previous = completed[-2] if len(completed) > 1 else None
    baseline = next((r for r in completed if r.is_baseline), completed[0] if completed else None)
    best = max(completed, key=lambda r: r.metrics.get("quality_index") or 0, default=None)

    def kpi(key: str, run: EvaluationRun | None, prev: EvaluationRun | None) -> dict:
        value = run.metrics.get(key) if run else None
        before = prev.metrics.get(key) if prev else None
        return {"value": value, "delta": round(value - before, 4) if value is not None and before is not None else None}

    def ops(run: EvaluationRun | None) -> dict:
        if not run:
            return {}
        o = run.operational
        return {
            "latency_p50_ms": o.get("latency_ms", {}).get("p50"),
            "latency_p95_ms": o.get("latency_ms", {}).get("p95"),
            "failure_rate": o.get("failure_rate"),
            "cost_per_query_usd": o.get("cost", {}).get("per_query_usd"),
            "projected_cost_per_query_usd": o.get("cost", {}).get("projected_per_query_usd"),
            "projected_model": o.get("cost", {}).get("projected_model"),
            "tokens_per_query": o.get("tokens", {}).get("avg_per_query"),
            "tokens_estimated": o.get("tokens", {}).get("estimated"),
        }

    previous_of: dict[str, EvaluationRun | None] = {}
    last_done: EvaluationRun | None = None
    for r in runs:
        previous_of[r.id] = last_done
        if r in completed:
            last_done = r

    alerts = []
    for r in runs[-20:]:
        if r.status == "failed":
            alerts.append({"severity": "critical", "run_id": r.id, "message": f"{r.name} failed: {r.error}"})
        elif r in completed and baseline and r.id != baseline.id:
            drop = (_qi(baseline) or 0) - (_qi(r) or 0)
            if drop > 2:
                alerts.append({"severity": "warning", "run_id": r.id,
                               "message": f"{r.name} is {drop:.1f} pts below the baseline quality index"})
        if r in completed and (r.operational.get("failure_rate") or 0) > 0:
            alerts.append({"severity": "warning", "run_id": r.id,
                           "message": f"{r.name} had {r.operational['failure_rate']:.0%} failed queries"})

    trace_rows = await session.execute(select(TraceRecord).order_by(TraceRecord.created_at.desc()).limit(10))
    total_queries = (await session.execute(select(func.count(SampleResult.id)))).scalar_one()

    focus = best or latest
    return {
        "counts": {
            "runs": len(runs),
            "completed": len(completed),
            "running": sum(1 for r in runs if r.status in ("queued", "running")),
            "failed": sum(1 for r in runs if r.status == "failed"),
            "queries_evaluated": total_queries,
        },
        "latest_run": _brief(latest, previous) if latest else None,
        "best_run": _brief(best, None) if best else None,
        "baseline_run": _brief(baseline, None) if baseline else None,
        "kpis": {
            "quality_index": kpi("quality_index", latest, previous),
            "faithfulness": kpi("faithfulness", latest, previous),
            "context_precision": kpi("context_precision", latest, previous),
            "recall_at_k": kpi("recall_at_k", latest, previous),
        },
        "operational": ops(latest),
        "radar": {
            "metrics": RADAR_METRICS,
            "focus": {"run_id": focus.id, "name": focus.name,
                      "values": {k: focus.metrics.get(k) for k in RADAR_METRICS}} if focus else None,
            "baseline": {"run_id": baseline.id, "name": baseline.name,
                         "values": {k: baseline.metrics.get(k) for k in RADAR_METRICS}} if baseline else None,
        },
        "trend": [
            {"run_id": r.id, "name": r.name, "created_at": r.created_at, "quality_index": _qi(r),
             "latency_p95_ms": r.operational.get("latency_ms", {}).get("p95"),
             "recall_at_k": r.metrics.get("recall_at_k"), "faithfulness": r.metrics.get("faithfulness")}
            for r in completed[-20:]
        ],
        "weakest_metrics": sorted(
            ({"metric": k, "value": focus.metrics.get(k)} for k in RADAR_METRICS if focus and focus.metrics.get(k) is not None),
            key=lambda x: x["value"],
        )[:4] if focus else [],
        "runs": [_brief(r, previous_of[r.id]) for r in reversed(runs[-8:])],
        "recent_traces": [TraceOut.model_validate(t).model_dump() for t in trace_rows.scalars()],
        "recommendations": recommend(focus)[:4] if focus else [],
        "alerts": alerts[-10:],
    }
