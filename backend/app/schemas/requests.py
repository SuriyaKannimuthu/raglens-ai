from typing import Any, Literal

from pydantic import BaseModel, Field

from app.evaluation.dataset import EvaluationDataset
from app.rag.pipeline import PipelineConfig


class EvaluationRequest(PipelineConfig):
    """Start an evaluation run: a pipeline configuration plus run options."""

    name: str | None = Field(default=None, max_length=200)
    dataset: str = "sample_dataset"
    judge: Literal["heuristic", "llm"] = "heuristic"
    sample_limit: int | None = Field(default=None, ge=1)
    tags: dict[str, Any] = Field(default_factory=dict)
    set_as_baseline: bool = False

    def pipeline_config(self) -> PipelineConfig:
        return PipelineConfig.model_validate(self.model_dump(include=set(PipelineConfig.model_fields)))


class CompareRequest(BaseModel):
    run_ids: list[str] = Field(min_length=2, max_length=8)
    baseline_run_id: str | None = None


class RegressionCheckRequest(BaseModel):
    candidate_run_id: str
    baseline_run_id: str | None = Field(default=None, description="Defaults to the run marked as baseline")
    max_drop: dict[str, float] = Field(
        default_factory=dict,
        description="Allowed absolute drop per metric (0-1 scale; quality_index on 0-100). "
        "Metrics not listed use default_max_drop.",
    )
    default_max_drop: float = Field(default=0.02, ge=0, le=1)
    max_latency_increase_pct: float | None = Field(default=50.0, ge=0)


class PlaygroundQuery(PipelineConfig):
    dataset: str = "sample_dataset"
    question: str = Field(min_length=3, max_length=2000)


class DatasetUpload(EvaluationDataset):
    overwrite: bool = False
