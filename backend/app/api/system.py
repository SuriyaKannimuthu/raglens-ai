from dataclasses import asdict

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.database.session import get_session
from app.evaluation.metrics import METRICS, QUALITY_WEIGHTS
from app.experiments.runner import active_run_count
from app.experiments.tracking import mlflow_available
from app.monitoring.tracing import otel_active
from app.rag.embeddings import list_embedding_models
from app.rag.pricing import MODEL_PRICING

router = APIRouter(tags=["system"])


@router.get("/health")
async def health(session: AsyncSession = Depends(get_session)):
    database = "ok"
    try:
        await session.execute(text("SELECT 1"))
    except Exception:  # pragma: no cover - reported, not raised
        database = "unavailable"
    return {
        "status": "ok" if database == "ok" else "degraded",
        "database": database,
        "active_runs": active_run_count(),
    }


@router.get("/config")
async def capabilities():
    """What this deployment can do - used by the UI to build run configuration forms."""
    settings = get_settings()
    return {
        "app_name": settings.app_name,
        "environment": settings.environment,
        "llm": {
            "default_provider": settings.llm_provider,
            "providers": [
                {"name": "local", "model": "local-extractive", "available": True,
                 "description": "Offline extractive generator (no API key needed)"},
                {"name": "anthropic", "model": settings.anthropic_model, "available": settings.anthropic_configured,
                 "description": "Claude generation via the Anthropic API"},
            ],
            "judge_model": settings.anthropic_judge_model,
            "cost_reference_model": settings.cost_reference_model,
            "pricing_per_mtok": {k: {"input": v[0], "output": v[1]} for k, v in MODEL_PRICING.items()},
        },
        "embedding_models": [asdict(m) for m in list_embedding_models()],
        "retrieval_methods": ["vector", "bm25", "hybrid"],
        "chunking_strategies": ["recursive", "sentence", "fixed"],
        "rerankers": [
            {"name": "lexical", "available": True},
            {"name": "llm", "available": settings.anthropic_configured},
        ],
        "judges": [
            {"name": "heuristic", "available": True},
            {"name": "llm", "available": settings.anthropic_configured},
        ],
        "vector_store": settings.vector_store,
        "integrations": {
            "mlflow": {"enabled": mlflow_available(), "tracking_uri": settings.mlflow_tracking_uri},
            "opentelemetry": {"enabled": otel_active()},
        },
        "metrics": [asdict(m) for m in METRICS],
        "quality_weights": QUALITY_WEIGHTS,
    }
