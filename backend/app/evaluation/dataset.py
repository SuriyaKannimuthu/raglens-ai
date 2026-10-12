"""Evaluation datasets: a document corpus plus questions with reference answers and
relevance labels (the ids of the documents that contain the answer)."""

import json
import re
from pathlib import Path

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.config import get_settings
from app.rag.chunking import Document

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


class DatasetDocument(BaseModel):
    id: str
    title: str
    text: str = Field(min_length=1)


class DatasetSample(BaseModel):
    id: str
    question: str = Field(min_length=3)
    reference_answer: str = Field(min_length=1)
    relevant_doc_ids: list[str] = Field(min_length=1)
    category: str | None = None


class EvaluationDataset(BaseModel):
    name: str
    description: str = ""
    documents: list[DatasetDocument] = Field(min_length=1)
    samples: list[DatasetSample] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def _valid_name(cls, value: str) -> str:
        if not _NAME_RE.match(value):
            raise ValueError("name must be 2-64 chars of lowercase letters, digits, '-' or '_'")
        return value

    @model_validator(mode="after")
    def _check_references(self) -> "EvaluationDataset":
        doc_ids = {d.id for d in self.documents}
        if len(doc_ids) != len(self.documents):
            raise ValueError("document ids must be unique")
        if len({s.id for s in self.samples}) != len(self.samples):
            raise ValueError("sample ids must be unique")
        for sample in self.samples:
            missing = set(sample.relevant_doc_ids) - doc_ids
            if missing:
                raise ValueError(f"sample {sample.id} references unknown documents: {sorted(missing)}")
        return self

    def to_documents(self) -> list[Document]:
        return [Document(d.id, d.title, d.text) for d in self.documents]


class DatasetNotFoundError(LookupError):
    pass


def _datasets_dir() -> Path:
    path = Path(get_settings().datasets_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_datasets() -> list[EvaluationDataset]:
    datasets = []
    for file in sorted(_datasets_dir().glob("*.json")):
        try:
            datasets.append(EvaluationDataset.model_validate_json(file.read_text(encoding="utf-8")))
        except ValueError:
            continue
    return datasets


def load_dataset(name: str) -> EvaluationDataset:
    if not _NAME_RE.match(name):
        raise DatasetNotFoundError(name)
    path = _datasets_dir() / f"{name}.json"
    if not path.exists():
        raise DatasetNotFoundError(name)
    return EvaluationDataset.model_validate_json(path.read_text(encoding="utf-8"))


def save_dataset(dataset: EvaluationDataset, overwrite: bool = False) -> None:
    path = _datasets_dir() / f"{dataset.name}.json"
    if path.exists() and not overwrite:
        raise FileExistsError(dataset.name)
    path.write_text(json.dumps(dataset.model_dump(), indent=2), encoding="utf-8")
