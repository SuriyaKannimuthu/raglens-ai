"""MLflow experiment tracking. Tracking is optional: when ``MLFLOW_TRACKING_URI`` is unset or
mlflow is not installed every call is a no-op, and runs are still stored in the database."""

import json
import logging
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def mlflow_available() -> bool:
    if not get_settings().mlflow_tracking_uri:
        return False
    try:
        import mlflow  # noqa: F401
    except ImportError:
        return False
    return True


def _flatten(prefix: str, data: dict[str, Any]) -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, value in data.items():
        name = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            flat.update(_flatten(name, value))
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            flat[name] = value
    return flat


def log_run(
    run_name: str,
    run_id: str,
    dataset: str,
    config: dict[str, Any],
    metrics: dict[str, Any],
    operational: dict[str, Any],
    tags: dict[str, Any],
) -> str | None:
    """Log one completed evaluation run. Returns the MLflow run id, or None if not tracked."""
    if not mlflow_available():
        return None
    import mlflow

    settings = get_settings()
    try:
        mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
        mlflow.set_experiment(settings.mlflow_experiment_name)
        with mlflow.start_run(run_name=run_name) as active:
            mlflow.set_tags({"raglens.run_id": run_id, "dataset": dataset,
                             **{f"tag.{k}": str(v) for k, v in tags.items()}})
            mlflow.log_params({k: str(v) for k, v in config.items()})
            numeric = {k: v for k, v in metrics.items() if isinstance(v, (int, float))}
            numeric.update(_flatten("ops", operational))
            mlflow.log_metrics(numeric)
            mlflow.log_text(json.dumps({"config": config, "metrics": metrics, "operational": operational},
                                       indent=2, default=str), "raglens_run.json")
            return active.info.run_id
    except Exception:  # tracking must never fail an evaluation
        logger.exception("MLflow logging failed for run %s", run_id)
        return None
