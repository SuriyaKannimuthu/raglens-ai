from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class EvaluationSubmitted(BaseModel):
    run_id: str
    status: str
    message: str


class RunSummary(ORMModel):
    id: str
    name: str
    dataset: str
    status: str
    judge_mode: str
    config: dict[str, Any]
    tags: dict[str, Any]
    metrics: dict[str, Any]
    operational: dict[str, Any]
    total_samples: int
    completed_samples: int
    failed_samples: int
    is_baseline: bool
    mlflow_run_id: str | None
    error: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class RunList(BaseModel):
    items: list[RunSummary]
    total: int


class RunMetrics(BaseModel):
    run_id: str
    status: str
    metrics: dict[str, Any]
    operational: dict[str, Any]
    by_category: dict[str, dict[str, Any]]


class SampleResultOut(ORMModel):
    id: str
    sample_id: str
    category: str | None
    question: str
    reference_answer: str
    generated_answer: str | None
    relevant_doc_ids: list[str]
    retrieved: list[dict[str, Any]]
    metrics: dict[str, Any]
    judge_rationale: str | None
    latency_ms: float
    retrieval_ms: float
    generation_ms: float
    input_tokens: int
    output_tokens: int
    cost_usd: float
    status: str
    error: str | None
    trace_id: str | None


class TraceOut(ORMModel):
    id: str
    run_id: str | None
    sample_id: str | None
    source: str
    question: str
    status: str
    error: str | None
    duration_ms: float
    spans: list[dict[str, Any]]
    attributes: dict[str, Any]
    input_tokens: int
    output_tokens: int
    cost_usd: float
    created_at: datetime


class DatasetSummary(BaseModel):
    name: str
    description: str
    documents: int
    samples: int
    categories: list[str]


class PlaygroundResult(BaseModel):
    question: str
    answer: str
    model: str
    retrieved: list[dict[str, Any]]
    latency_ms: float
    input_tokens: int
    output_tokens: int
    cost_usd: float
    tokens_estimated: bool
    trace: TraceOut
