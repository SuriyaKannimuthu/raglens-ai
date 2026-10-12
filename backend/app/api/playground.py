import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.database.models import TraceRecord
from app.database.session import get_session
from app.evaluation.dataset import DatasetNotFoundError, load_dataset
from app.experiments.runner import ConfigurationError, validate_capabilities
from app.monitoring.metrics import registry
from app.monitoring.tracing import Trace
from app.rag.llm import LLMError
from app.rag.pipeline import PipelineConfig, RAGPipeline
from app.rag.pricing import estimate_cost
from app.schemas.requests import PlaygroundQuery
from app.schemas.responses import PlaygroundResult, TraceOut

router = APIRouter(tags=["playground"])


@router.post("/query", response_model=PlaygroundResult)
async def run_query(request: PlaygroundQuery, session: AsyncSession = Depends(get_session)):
    """Run a single ad-hoc question through a pipeline configuration (traced)."""
    try:
        dataset = load_dataset(request.dataset)
    except DatasetNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Dataset '{request.dataset}' not found")
    config = PipelineConfig.model_validate(request.model_dump(include=set(PipelineConfig.model_fields)))
    try:
        validate_capabilities(config)
    except ConfigurationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))

    pipeline = await asyncio.to_thread(RAGPipeline, config, dataset.to_documents())
    trace = Trace("playground", dataset=dataset.name)
    try:
        result = await pipeline.query(request.question, trace)
    except LLMError as exc:
        trace.finish("error", str(exc))
        record = TraceRecord(id=trace.id, source="playground", question=request.question, status="error",
                             error=str(exc), duration_ms=trace.duration_ms, spans=trace.spans_as_dicts())
        session.add(record)
        await session.commit()
        registry.record_query(trace.duration_ms, False, 0, 0, 0.0)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    trace.finish()

    gen = result.generation
    cost = estimate_cost(gen.model, gen.input_tokens, gen.output_tokens)
    if result.rerank_usage.model:
        cost += estimate_cost(result.rerank_usage.model, result.rerank_usage.input_tokens,
                              result.rerank_usage.output_tokens)
    relevant_by_question = {s.question.strip().lower(): set(s.relevant_doc_ids) for s in dataset.samples}
    relevant = relevant_by_question.get(request.question.strip().lower())
    retrieved = [
        {"rank": r.rank, "chunk_id": r.chunk.id, "doc_id": r.chunk.doc_id, "title": r.chunk.title,
         "score": round(r.score, 6), "text": r.chunk.text,
         "relevant": (r.chunk.doc_id in relevant) if relevant is not None else None}
        for r in result.retrieved
    ]
    record = TraceRecord(
        id=trace.id, source="playground", question=request.question, status="ok",
        duration_ms=trace.duration_ms, spans=trace.spans_as_dicts(),
        attributes={"generator_model": gen.model, "projected_model": get_settings().cost_reference_model,
                    "config": config.model_dump()},
        input_tokens=gen.input_tokens, output_tokens=gen.output_tokens, cost_usd=cost,
    )
    session.add(record)
    await session.commit()
    registry.record_query(trace.duration_ms, True, gen.input_tokens, gen.output_tokens, cost)
    return PlaygroundResult(
        question=request.question, answer=gen.answer, model=gen.model, retrieved=retrieved,
        latency_ms=trace.duration_ms, input_tokens=gen.input_tokens, output_tokens=gen.output_tokens,
        cost_usd=cost, tokens_estimated=gen.tokens_estimated, trace=TraceOut.model_validate(record),
    )
