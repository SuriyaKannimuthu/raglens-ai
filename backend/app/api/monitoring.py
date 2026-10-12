from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import EvaluationRun, TraceRecord
from app.database.session import get_session
from app.evaluation.metrics import percentile
from app.monitoring.metrics import registry
from app.schemas.responses import TraceOut

router = APIRouter(tags=["monitoring"])

_HISTOGRAM_EDGES_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]


@router.get("/traces", response_model=list[TraceOut])
async def list_traces(
    session: AsyncSession = Depends(get_session),
    run_id: str | None = None,
    source: Literal["evaluation", "playground"] | None = None,
    status_filter: Literal["ok", "error"] | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=500),
):
    query = select(TraceRecord)
    if run_id:
        query = query.where(TraceRecord.run_id == run_id)
    if source:
        query = query.where(TraceRecord.source == source)
    if status_filter:
        query = query.where(TraceRecord.status == status_filter)
    rows = await session.execute(query.order_by(TraceRecord.created_at.desc()).limit(limit))
    return list(rows.scalars())


@router.get("/traces/{trace_id}", response_model=TraceOut)
async def get_trace(trace_id: str, session: AsyncSession = Depends(get_session)):
    trace = await session.get(TraceRecord, trace_id)
    if trace is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Trace '{trace_id}' not found")
    return trace


@router.get("/monitoring/summary")
async def monitoring_summary(session: AsyncSession = Depends(get_session), window: int = Query(500, ge=10, le=5000)):
    """Operational view across recent traces and runs: latency percentiles, latency
    distribution, per-stage timings, failure rate, token usage and cost."""
    rows = await session.execute(select(TraceRecord).order_by(TraceRecord.created_at.desc()).limit(window))
    traces = list(rows.scalars())
    ok = [t for t in traces if t.status == "ok"]
    durations = [t.duration_ms for t in ok]

    stage_totals: dict[str, list[float]] = defaultdict(list)
    for t in ok:
        for span in t.spans:
            stage_totals[span["name"]].append(span["duration_ms"])
    stages = {
        name: {"avg_ms": round(sum(v) / len(v), 3), "p95_ms": round(percentile(v, 95) or 0, 3), "count": len(v)}
        for name, v in stage_totals.items()
    }

    histogram = []
    lower = 0.0
    for edge in _HISTOGRAM_EDGES_MS + [float("inf")]:
        count = sum(1 for d in durations if lower <= d < edge)
        histogram.append({"from_ms": lower, "to_ms": None if edge == float("inf") else edge, "count": count})
        lower = edge

    run_rows = await session.execute(
        select(EvaluationRun).where(EvaluationRun.status == "completed").order_by(EvaluationRun.created_at)
    )
    runs = [
        {
            "run_id": r.id, "name": r.name, "created_at": r.created_at,
            "quality_index": r.metrics.get("quality_index"),
            "latency_p50_ms": r.operational.get("latency_ms", {}).get("p50"),
            "latency_p95_ms": r.operational.get("latency_ms", {}).get("p95"),
            "failure_rate": r.operational.get("failure_rate"),
            "tokens_total": r.operational.get("tokens", {}).get("total"),
            "cost_total_usd": r.operational.get("cost", {}).get("total_usd"),
            "projected_cost_total_usd": r.operational.get("cost", {}).get("projected_total_usd"),
            "throughput_qps": r.operational.get("throughput_qps"),
        }
        for r in run_rows.scalars()
    ]
    status_counts = dict((await session.execute(
        select(EvaluationRun.status, func.count(EvaluationRun.id)).group_by(EvaluationRun.status)
    )).all())

    def p(values: list[float], pct: float) -> float | None:
        value = percentile(values, pct)
        return round(value, 3) if value is not None else None

    return {
        "window": len(traces),
        "latency_ms": {
            "avg": round(sum(durations) / len(durations), 3) if durations else None,
            "p50": p(durations, 50), "p95": p(durations, 95), "p99": p(durations, 99),
        },
        "failure_rate": round((len(traces) - len(ok)) / len(traces), 4) if traces else 0.0,
        "errors": len(traces) - len(ok),
        "tokens": {"input": sum(t.input_tokens for t in traces), "output": sum(t.output_tokens for t in traces)},
        "cost_usd": round(sum(t.cost_usd for t in traces), 6),
        "stages": stages,
        "latency_histogram": histogram,
        "runs": runs,
        "run_status_counts": status_counts,
        "live": registry.snapshot(),
    }


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
async def prometheus_metrics():
    return PlainTextResponse(registry.prometheus(), media_type="text/plain; version=0.0.4")
