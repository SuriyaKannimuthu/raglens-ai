"""Vector stores. The in-memory store is exact cosine search over a numpy matrix; the
Qdrant store is used when ``VECTOR_STORE=qdrant`` and qdrant-client is installed."""

import uuid
from typing import Protocol

import numpy as np

from app.rag.chunking import Chunk


class VectorStore(Protocol):
    def add(self, chunks: list[Chunk], vectors: np.ndarray) -> None: ...

    def search(self, query_vector: np.ndarray, k: int) -> list[tuple[Chunk, float]]: ...


class InMemoryVectorStore:
    def __init__(self) -> None:
        self._chunks: list[Chunk] = []
        self._matrix: np.ndarray | None = None

    def add(self, chunks: list[Chunk], vectors: np.ndarray) -> None:
        self._chunks.extend(chunks)
        self._matrix = vectors if self._matrix is None else np.vstack([self._matrix, vectors])

    def search(self, query_vector: np.ndarray, k: int) -> list[tuple[Chunk, float]]:
        if self._matrix is None or not self._chunks:
            return []
        scores = self._matrix @ query_vector
        k = min(k, len(self._chunks))
        top = np.argpartition(-scores, k - 1)[:k]
        top = top[np.argsort(-scores[top])]
        return [(self._chunks[i], float(scores[i])) for i in top]


class QdrantVectorStore:
    def __init__(self, dimension: int, url: str | None = None) -> None:
        from qdrant_client import QdrantClient, models  # optional dependency

        self._models = models
        self._client = QdrantClient(url=url) if url else QdrantClient(location=":memory:")
        self._collection = f"raglens_{uuid.uuid4().hex[:12]}"
        self._client.create_collection(
            self._collection,
            vectors_config=models.VectorParams(size=dimension, distance=models.Distance.COSINE),
        )
        self._chunks: dict[str, Chunk] = {}

    def add(self, chunks: list[Chunk], vectors: np.ndarray) -> None:
        points = []
        for chunk, vector in zip(chunks, vectors):
            point_id = str(uuid.uuid5(uuid.NAMESPACE_URL, chunk.id))
            self._chunks[point_id] = chunk
            points.append(self._models.PointStruct(id=point_id, vector=vector.tolist()))
        self._client.upsert(self._collection, points=points)

    def search(self, query_vector: np.ndarray, k: int) -> list[tuple[Chunk, float]]:
        hits = self._client.query_points(self._collection, query=query_vector.tolist(), limit=k).points
        return [(self._chunks[str(h.id)], float(h.score)) for h in hits]


def create_vector_store(backend: str, dimension: int, qdrant_url: str | None = None) -> VectorStore:
    if backend == "qdrant":
        return QdrantVectorStore(dimension, qdrant_url)
    return InMemoryVectorStore()
