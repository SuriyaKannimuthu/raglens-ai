"""Application settings loaded from environment variables / .env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "RAGLens AI"
    environment: str = "development"
    log_level: str = "INFO"

    # Database: SQLite for zero-setup local runs, PostgreSQL (asyncpg) in Docker/production.
    database_url: str = f"sqlite+aiosqlite:///{(BACKEND_ROOT / 'raglens.db').as_posix()}"

    # CORS origins for the Next.js frontend (comma separated).
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # LLM provider: "local" runs an offline extractive generator, "anthropic" calls Claude.
    llm_provider: str = "local"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"
    anthropic_judge_model: str = "claude-opus-5-5"
    anthropic_effort: str = "low"
    anthropic_max_tokens: int = 8000
    anthropic_timeout_seconds: float = 120.0

    # Cost projection for runs that use the free local generator.
    cost_reference_model: str = "claude-opus-5-5"

    # Vector store backend: "memory" (numpy) or "qdrant" (requires qdrant-client).
    vector_store: str = "memory"
    qdrant_url: str | None = None

    # Experiment tracking.
    mlflow_tracking_uri: str | None = None
    mlflow_experiment_name: str = "raglens-ai"

    # Observability.
    otel_enabled: bool = False
    otel_service_name: str = "raglens-api"
    otel_exporter_otlp_endpoint: str | None = None

    # Evaluation runtime.
    datasets_dir: Path = BACKEND_ROOT / "evaluation"
    evaluation_concurrency: int = Field(default=4, ge=1, le=64)
    auto_seed_experiments: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def anthropic_configured(self) -> bool:
        return bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
