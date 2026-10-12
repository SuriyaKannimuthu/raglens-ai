"""Evaluation orchestrator: runs a dataset through a configured RAG pipeline, scores every
sample, persists results and traces, aggregates metrics and logs the run to MLflow."""

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.database.models import EvaluationRun, SampleResult, TraceRecord, utcnow
from app.database.session import get_session_factory
from app.evaluation.dataset import DatasetSample, EvaluationDataset, load_dataset
from app.evaluation.evaluator import aggregate_metrics, evaluate_sample
from app.evaluation.metrics import percentile
from app.experiments.tracking import log_run
from app.monitoring.metrics import registry
from app.monitoring.tracing import Trace
from app.rag.llm import LLMError
from app.rag.pipeline import PipelineConfig, RAGPipeline
from app.rag.pricing import estimate_cost
from app.schemas.requests import EvaluationRequest

logger = logging.getLogger(__name__)

_background_tasks: set[asyncio.Task] = set()


class ConfigurationError(ValueError):
    """Raised when a run asks for something the server is not configured to do."""


def validate_capabilities(config: PipelineConfig, judge: str = "heuristic") -> None:
    settings = get_settings()
    needs_claude = []
    if config.llm_provider == "anthropic":
        needs_claude.append("llm_provider=anthropic")
    if config.reranking_enabled and config.reranker == "llm":
        needs_claude.append("reranker=llm")
    if judge == "llm":
        needs_claude.append("judge=llm")
    if needs_claude and not settings.anthropic_configured:
        raise ConfigurationError(f"{', '.join(needs_claude)} requires ANTHROPIC_API_KEY to be configured")


def default_run_name(config: PipelineConfig) -> str:
    parts = [config.retrieval_method]
    if config.reranking_enabled:
        parts.append(f"{config.reranker} rerank")
    parts.append(f"k={config.top_k}")
    parts.append(config.embedding_model.replace("local-hash-", "hash-"))
    return " · ".join(parts)


async def create_run(session: AsyncSession, request: EvaluationRequest) -> EvaluationRun:
    dataset = load_dataset(request.dataset)
    config = request.pipeline_config()
    validate_capabilities(config, request.judge)
    total = min(len(dataset.samples), request.sample_limit or len(dataset.samples))
    if request.set_as_baseline:
        await session.execute(update(EvaluationRun).values(is_baseline=False))
    run = EvaluationRun(
        name=request.name or default_run_name(config),
        dataset=dataset.name,
        status="queued",
        judge_mode=request.judge,
        config=config.model_dump(),
        tags=request.tags,
        total_samples=total,
        is_baseline=request.set_as_baseline,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def launch_run(run_id: str, sample_limit: int | None = None) -> asyncio.Task:
    task = asyncio.create_task(execute_run(run_id, sample_limit), name=f"evaluation-{run_id}")
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def active_run_count() -> int:
    return len(_background_tasks)


@dataclass
class _SampleOutcome:
    result: SampleResult
    trace: TraceRecord
    metrics: dict[str, float] | None


async def _run_sample(
    run_id: str, sample: DatasetSample, pipeline: RAGPipeline, judge_mode: str, semaphore: asyncio.Semaphore
) -> _SampleOutcome:
    settings = get_settings()
    async with semaphore:
        trace = Trace("evaluation", run_id=run_id, sample_id=sample.id)
        result = SampleResult(
            run_id=run_id, sample_id=sample.id, category=sample.category, question=sample.question,
            reference_answer=sample.reference_answer, relevant_doc_ids=sample.relevant_doc_ids,
            trace_id=trace.id,
        )
        sample_metrics = None
        judge_tokens = (0, 0, None)
        try:
            query = await pipeline.query(sample.question, trace)
            gen = query.generation
            with trace.span("evaluation", judge=judge_mode):
                evaluation = await evaluate_sample(sample, query, pipeline.corpus.chunks_per_doc,
                                                   pipeline.config.top_k, judge_mode)  # type: ignore[arg-type]
            sample_metrics = evaluation.metrics
            judge_tokens = (evaluation.judge_input_tokens, evaluation.judge_output_tokens, evaluation.judge_model)
            input_tokens = gen.input_tokens + query.rerank_usage.input_tokens
            output_tokens = gen.output_tokens + query.rerank_usage.output_tokens
            cost = estimate_cost(gen.model, gen.input_tokens, gen.output_tokens)
            if query.rerank_usage.model:
                cost += estimate_cost(query.rerank_usage.model, query.rerank_usage.input_tokens,
                                      query.rerank_usage.output_tokens)
            result.generated_answer = gen.answer
            result.retrieved = [
                {"rank": r.rank, "chunk_id": r.chunk.id, "doc_id": r.chunk.doc_id, "title": r.chunk.title,
                 "score": round(r.score, 6), "text": r.chunk.text, "relevant": rel}
                for r, rel in zip(query.retrieved, evaluation.relevances)
            ]
            result.metrics = {k: round(v, 4) for k, v in sample_metrics.items()}
            result.judge_rationale = evaluation.judge_rationale
            result.input_tokens, result.output_tokens, result.cost_usd = input_tokens, output_tokens, cost
            result.status = "completed"
            trace.finish()
        except (LLMError, ValueError, RuntimeError) as exc:
            logger.warning("Sample %s failed in run %s: %s", sample.id, run_id, exc)
            result.status, result.error = "failed", str(exc)
            trace.finish("error", str(exc))

        result.latency_ms = trace.duration_ms
        result.retrieval_ms = trace.span_duration("retrieval") + trace.span_duration("rerank")
        result.generation_ms = trace.span_duration("generation")
        judge_cost = estimate_cost(judge_tokens[2], judge_tokens[0], judge_tokens[1]) if judge_tokens[2] else 0.0
        registry.record_query(trace.duration_ms, result.status == "completed", result.input_tokens,
                              result.output_tokens, result.cost_usd)
        record = TraceRecord(
            id=trace.id, run_id=run_id, sample_id=sample.id, source="evaluation", question=sample.question,
            status=trace.status, error=trace.error, duration_ms=trace.duration_ms, spans=trace.spans_as_dicts(),
            attributes={"generator_model": pipeline.generator_model,
                        "projected_model": settings.cost_reference_model,
                        "judge_input_tokens": judge_tokens[0], "judge_output_tokens": judge_tokens[1],
                        "judge_cost_usd": judge_cost},
            input_tokens=result.input_tokens, output_tokens=result.output_tokens, cost_usd=result.cost_usd,
        )
        return _SampleOutcome(result, record, sample_metrics)


def summarize_operations(
    results: list[SampleResult], traces: list[TraceRecord], wall_seconds: float, generator_model: str
) -> dict[str, Any]:
    settings = get_settings()
    ok = [r for r in results if r.status == "completed"]

    def stats(values: list[float]) -> dict[str, float | None]:
        return {
            "avg": round(sum(values) / len(values), 3) if values else None,
            "p50": _round(percentile(values, 50)),
            "p95": _round(percentile(values, 95)),
            "p99": _round(percentile(values, 99)),
            "max": round(max(values), 3) if values else None,
        }

    input_tokens = sum(r.input_tokens for r in results)
    output_tokens = sum(r.output_tokens for r in results)
    cost = sum(r.cost_usd for r in results)
    judge_cost = sum(t.attributes.get("judge_cost_usd", 0.0) for t in traces)
    projected = estimate_cost(settings.cost_reference_model, input_tokens, output_tokens)
    n = len(results) or 1
    return {
        "latency_ms": stats([r.latency_ms for r in ok]),
        "retrieval_ms": stats([r.retrieval_ms for r in ok]),
        "generation_ms": stats([r.generation_ms for r in ok]),
        "failure_rate": round((len(results) - len(ok)) / n, 4),
        "tokens": {
            "input": input_tokens,
            "output": output_tokens,
            "total": input_tokens + output_tokens,
            "avg_per_query": round((input_tokens + output_tokens) / n, 1),
            "estimated": generator_model == "local-extractive",
        },
        "cost": {
            "generation_usd": round(cost, 6),
            "evaluation_usd": round(judge_cost, 6),
            "total_usd": round(cost + judge_cost, 6),
            "per_query_usd": round(cost / n, 8),
            "projected_model": settings.cost_reference_model,
            "projected_total_usd": round(projected, 6),
            "projected_per_query_usd": round(projected / n, 8),
        },
        "throughput_qps": round(len(results) / wall_seconds, 3) if wall_seconds > 0 else None,
        "wall_seconds": round(wall_seconds, 3),
        "generator_model": generator_model,
    }


def _round(value: float | None) -> float | None:
    return round(value, 3) if value is not None else None


async def execute_run(run_id: str, sample_limit: int | None = None) -> None:
    settings = get_settings()
    factory = get_session_factory()
    async with factory() as session:
        run = await session.get(EvaluationRun, run_id)
        if run is None:
            return
        try:
            dataset: EvaluationDataset = load_dataset(run.dataset)
            config = PipelineConfig.model_validate(run.config)
            samples = dataset.samples[: run.total_samples or sample_limit or len(dataset.samples)]
            run.status, run.started_at = "running", utcnow()
            await session.commit()

            pipeline = await asyncio.to_thread(RAGPipeline, config, dataset.to_documents())
            semaphore = asyncio.Semaphore(settings.evaluation_concurrency)
            write_lock = asyncio.Lock()
            outcomes: list[_SampleOutcome] = []
            started = time.perf_counter()

            async def worker(sample: DatasetSample) -> None:
                outcome = await _run_sample(run_id, sample, pipeline, run.judge_mode, semaphore)
                async with write_lock:
                    outcomes.append(outcome)
                    session.add_all([outcome.result, outcome.trace])
                    run.completed_samples = sum(1 for o in outcomes if o.result.status == "completed")
                    run.failed_samples = len(outcomes) - run.completed_samples
                    await session.commit()

            await asyncio.gather(*(worker(s) for s in samples))
            wall = time.perf_counter() - started

            results = [o.result for o in outcomes]
            scored = [o.metrics for o in outcomes if o.metrics is not None]
            run.metrics = aggregate_metrics(scored) if scored else {}
            run.operational = summarize_operations(results, [o.trace for o in outcomes], wall,
                                                   pipeline.generator_model)
            run.completed_at = utcnow()
            if not scored:
                run.status = "failed"
                run.error = results[0].error if results else "No samples were evaluated"
            else:
                run.status = "completed"
            await session.commit()

            if run.status == "completed":
                mlflow_id = await asyncio.to_thread(
                    log_run, run.name, run.id, run.dataset, run.config, run.metrics, run.operational, run.tags
                )
                if mlflow_id:
                    run.mlflow_run_id = mlflow_id
                    await session.commit()
            logger.info("Run %s (%s) finished: %s quality_index=%s", run.id, run.name, run.status,
                        run.metrics.get("quality_index"))
        except Exception as exc:
            logger.exception("Run %s failed", run_id)
            await session.rollback()
            run = await session.get(EvaluationRun, run_id)
            if run is not None:
                run.status, run.error, run.completed_at = "failed", str(exc), utcnow()
                await session.commit()


async def recover_interrupted_runs() -> int:
    """Mark runs left queued/running by a previous process as failed."""
    async with get_session_factory()() as session:
        result = await session.execute(
            update(EvaluationRun)
            .where(EvaluationRun.status.in_(["queued", "running"]))
            .values(status="failed", error="Interrupted by a server restart", completed_at=utcnow())
        )
        await session.commit()
        return result.rowcount or 0


DEFAULT_EXPERIMENTS: list[dict[str, Any]] = [
    {"name": "Experiment A · Vector search", "retrieval_method": "vector",
     "tags": {"experiment": "A", "purpose": "baseline"}, "set_as_baseline": True},
    {"name": "Experiment B · Hybrid search", "retrieval_method": "hybrid",
     "tags": {"experiment": "B", "purpose": "keyword + semantic"}},
    {"name": "Experiment C · Hybrid + reranking", "retrieval_method": "hybrid", "reranking_enabled": True,
     "tags": {"experiment": "C", "purpose": "improved ordering"}},
    {"name": "Experiment D · Hybrid + rerank, sentence chunks", "retrieval_method": "hybrid",
     "reranking_enabled": True, "chunking_strategy": "sentence", "chunk_size": 300,
     "tags": {"experiment": "D", "purpose": "chunking strategy"}},
]


async def seed_default_experiments() -> list[str]:
    """Run the README's example experiments once, so a fresh install has data to explore."""
    async with get_session_factory()() as session:
        existing = await session.execute(select(EvaluationRun.id).limit(1))
        if existing.first() is not None:
            return []
        run_ids = []
        for spec in DEFAULT_EXPERIMENTS:
            request = EvaluationRequest.model_validate({"llm_provider": "local", **spec})
            run = await create_run(session, request)
            run_ids.append(run.id)
    for run_id in run_ids:
        await execute_run(run_id)
    return run_ids
