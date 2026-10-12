from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import EvaluationRun, SampleResult, TraceRecord
from app.database.session import get_session
from app.evaluation.dataset import DatasetNotFoundError
from app.evaluation.metrics import METRIC_KEYS, mean, quality_index
from app.experiments.insights import recommend
from app.experiments.runner import ConfigurationError, create_run, launch_run
from app.schemas.requests import EvaluationRequest
from app.schemas.responses import EvaluationSubmitted, RunList, RunMetrics, RunSummary, SampleResultOut

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


async def get_run_or_404(session: AsyncSession, run_id: str) -> EvaluationRun:
    run = await session.get(EvaluationRun, run_id)
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Evaluation run '{run_id}' not found")
    return run


@router.post("", status_code=status.HTTP_202_ACCEPTED, response_model=EvaluationSubmitted)
async def start_evaluation(request: EvaluationRequest, session: AsyncSession = Depends(get_session)):
    """Queue an evaluation run. The run executes in the background; poll its status."""
    try:
        run = await create_run(session, request)
    except DatasetNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Dataset '{request.dataset}' not found")
    except ConfigurationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    launch_run(run.id)
    return EvaluationSubmitted(run_id=run.id, status=run.status, message="Evaluation submitted successfully")


@router.get("", response_model=RunList)
async def list_evaluations(
    session: AsyncSession = Depends(get_session),
    status_filter: Literal["queued", "running", "completed", "failed"] | None = Query(None, alias="status"),
    dataset: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    query = select(EvaluationRun)
    count = select(func.count(EvaluationRun.id))
    if status_filter:
        query, count = query.where(EvaluationRun.status == status_filter), count.where(EvaluationRun.status == status_filter)
    if dataset:
        query, count = query.where(EvaluationRun.dataset == dataset), count.where(EvaluationRun.dataset == dataset)
    rows = await session.execute(query.order_by(EvaluationRun.created_at.desc()).limit(limit).offset(offset))
    total = (await session.execute(count)).scalar_one()
    return RunList(items=[RunSummary.model_validate(r) for r in rows.scalars()], total=total)


@router.get("/{run_id}", response_model=RunSummary)
async def get_evaluation(run_id: str, session: AsyncSession = Depends(get_session)):
    return await get_run_or_404(session, run_id)


@router.get("/{run_id}/metrics", response_model=RunMetrics)
async def get_evaluation_metrics(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await get_run_or_404(session, run_id)
    rows = await session.execute(
        select(SampleResult).where(SampleResult.run_id == run_id, SampleResult.status == "completed")
    )
    grouped: dict[str, list[dict]] = defaultdict(list)
    for result in rows.scalars():
        grouped[result.category or "uncategorized"].append(result.metrics)
    by_category = {}
    for category, items in sorted(grouped.items()):
        agg = {k: (round(v, 4) if (v := mean([i.get(k) for i in items])) is not None else None) for k in METRIC_KEYS}
        agg["quality_index"] = quality_index(agg)
        agg["samples"] = len(items)
        by_category[category] = agg
    return RunMetrics(run_id=run.id, status=run.status, metrics=run.metrics,
                      operational=run.operational, by_category=by_category)


@router.get("/{run_id}/results", response_model=list[SampleResultOut])
async def get_evaluation_results(
    run_id: str,
    session: AsyncSession = Depends(get_session),
    status_filter: Literal["completed", "failed"] | None = Query(None, alias="status"),
):
    await get_run_or_404(session, run_id)
    query = select(SampleResult).where(SampleResult.run_id == run_id)
    if status_filter:
        query = query.where(SampleResult.status == status_filter)
    rows = await session.execute(query.order_by(SampleResult.sample_id))
    return list(rows.scalars())


@router.get("/{run_id}/insights")
async def get_evaluation_insights(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await get_run_or_404(session, run_id)
    if run.status != "completed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Insights are available once the run has completed")
    return {"run_id": run.id, "recommendations": recommend(run)}


@router.post("/{run_id}/baseline", response_model=RunSummary)
async def mark_baseline(run_id: str, session: AsyncSession = Depends(get_session)):
    """Mark a completed run as the regression baseline (replacing any previous baseline)."""
    run = await get_run_or_404(session, run_id)
    if run.status != "completed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only completed runs can be used as a baseline")
    await session.execute(update(EvaluationRun).values(is_baseline=False))
    run.is_baseline = True
    await session.commit()
    await session.refresh(run)
    return run


@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_evaluation(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await get_run_or_404(session, run_id)
    if run.status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot delete a run that is still in progress")
    await session.execute(delete(TraceRecord).where(TraceRecord.run_id == run_id))
    await session.execute(delete(SampleResult).where(SampleResult.run_id == run_id))
    await session.delete(run)
    await session.commit()
