import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.database.session import dispose_db, init_db
from app.experiments.runner import recover_interrupted_runs, seed_default_experiments
from app.monitoring.metrics import registry
from app.monitoring.tracing import setup_opentelemetry

logger = logging.getLogger("raglens")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    setup_opentelemetry(settings)
    await init_db()
    interrupted = await recover_interrupted_runs()
    if interrupted:
        logger.warning("Marked %d interrupted run(s) as failed", interrupted)
    seed_task = asyncio.create_task(seed_default_experiments()) if settings.auto_seed_experiments else None
    yield
    if seed_task and not seed_task.done():
        seed_task.cancel()
    await dispose_db()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="RAGLens AI",
        description="Evaluate, compare and monitor Retrieval-Augmented Generation pipelines.",
        version="1.0.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def observe_requests(request: Request, call_next):
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            elapsed = (time.perf_counter() - start) * 1000
            route = request.scope.get("route")
            path = getattr(route, "path", "unmatched")
            registry.record_http(request.method, path, status_code, elapsed)

    app.include_router(api_router)
    return app


app = create_app()
