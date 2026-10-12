from fastapi import APIRouter, HTTPException, status

from app.evaluation.dataset import DatasetNotFoundError, EvaluationDataset, list_datasets, load_dataset, save_dataset
from app.schemas.requests import DatasetUpload
from app.schemas.responses import DatasetSummary

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _summary(dataset: EvaluationDataset) -> DatasetSummary:
    categories = sorted({s.category for s in dataset.samples if s.category})
    return DatasetSummary(name=dataset.name, description=dataset.description, documents=len(dataset.documents),
                          samples=len(dataset.samples), categories=categories)


@router.get("", response_model=list[DatasetSummary])
async def get_datasets():
    return [_summary(d) for d in list_datasets()]


@router.get("/{name}", response_model=EvaluationDataset)
async def get_dataset(name: str):
    try:
        return load_dataset(name)
    except DatasetNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Dataset '{name}' not found")


@router.post("", status_code=status.HTTP_201_CREATED, response_model=DatasetSummary)
async def upload_dataset(upload: DatasetUpload):
    """Register a new evaluation dataset (documents + labelled questions)."""
    dataset = EvaluationDataset.model_validate(upload.model_dump(exclude={"overwrite"}))
    try:
        save_dataset(dataset, overwrite=upload.overwrite)
    except FileExistsError:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Dataset '{dataset.name}' already exists")
    return _summary(dataset)
