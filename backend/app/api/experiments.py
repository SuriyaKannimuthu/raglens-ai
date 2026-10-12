from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.models import EvaluationRun, SampleResult
from app.database.session import get_session
from app.experiments.comparison import check_regression, compare_runs
from app.schemas.requests import CompareRequest, RegressionCheckRequest

router = APIRouter(prefix="/experiments", tags=["experiments"])


async def _completed_runs(session: AsyncSession, run_ids: list[str]) -> list[EvaluationRun]:
    rows = await session.execute(select(EvaluationRun).where(EvaluationRun.id.in_(run_ids)))
    found = {r.id: r for r in rows.scalars()}
    missing = [rid for rid in run_ids if rid not in found]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Runs not found: {', '.join(missing)}")
    incomplete = [rid for rid in run_ids if found[rid].status != "completed"]
    if incomplete:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Runs not completed yet: {', '.join(incomplete)}")
    return [found[rid] for rid in run_ids]


@router.post("/compare")
async def compare_experiments(request: CompareRequest, session: AsyncSession = Depends(get_session)):
    """Compare completed runs side by side, with deltas against a baseline run."""
    run_ids = list(dict.fromkeys(request.run_ids))
    if request.baseline_run_id and request.baseline_run_id not in run_ids:
        run_ids.insert(0, request.baseline_run_id)
    if len(run_ids) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Provide at least two distinct runs")
    runs = await _completed_runs(session, run_ids)
    rows = await session.execute(select(SampleResult).where(SampleResult.run_id.in_(run_ids)))
    samples: dict[str, list[SampleResult]] = {}
    for result in rows.scalars():
        samples.setdefault(result.run_id, []).append(result)
    return compare_runs(runs, samples, request.baseline_run_id)


@router.post("/regression-check")
async def regression_check(request: RegressionCheckRequest, session: AsyncSession = Depends(get_session)):
    """Gate a candidate run against the baseline. Returns passed=false if any metric dropped
    by more than its allowed threshold - suitable for CI."""
    baseline_id = request.baseline_run_id
    if baseline_id is None:
        row = await session.execute(select(EvaluationRun.id).where(EvaluationRun.is_baseline.is_(True)))
        baseline_id = row.scalar_one_or_none()
        if baseline_id is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                                "No baseline run is marked; pass baseline_run_id or mark one")
    baseline, candidate = await _completed_runs(session, [baseline_id, request.candidate_run_id])
    return check_regression(baseline, candidate, request)
