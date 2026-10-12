"""Configurable RAG pipeline: chunk -> index -> retrieve (vector / BM25 / hybrid) ->
optional rerank -> generate."""

import asyncio
import hashlib
import threading
from collections import OrderedDict
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.config import get_settings
from app.monitoring.tracing import Trace
from app.rag.bm25 import BM25Index
from app.rag.chunking import Chunk, ChunkingStrategy, Document, chunk_documents
from app.rag.embeddings import get_embedder
from app.rag.llm import GenerationResult, get_generator
from app.rag.reranker import RerankUsage, get_reranker
from app.rag.vector_store import VectorStore, create_vector_store

RetrievalMethod = Literal["vector", "bm25", "hybrid"]


class PipelineConfig(BaseModel):
    """Everything that defines a RAG configuration under test."""

    retrieval_method: RetrievalMethod = "vector"
    embedding_model: str = "local-hash-ngrams"
    chunking_strategy: ChunkingStrategy = "recursive"
    chunk_size: int = Field(default=500, ge=100, le=4000)
    chunk_overlap: int = Field(default=50, ge=0, le=1000)
    top_k: int = Field(default=5, ge=1, le=20)
    fusion: Literal["rrf", "weighted"] = "rrf"
    hybrid_alpha: float = Field(default=0.5, ge=0.0, le=1.0, description="Vector weight for weighted fusion")
    reranking_enabled: bool = False
    reranker: Literal["lexical", "llm"] = "lexical"
    rerank_candidates: int = Field(default=20, ge=2, le=100)
    llm_provider: Literal["local", "anthropic"] | None = None
    llm_model: str | None = None

    @model_validator(mode="after")
    def _check(self) -> "PipelineConfig":
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        if self.llm_provider is None:
            self.llm_provider = get_settings().llm_provider  # type: ignore[assignment]
        return self


@dataclass
class RetrievedChunk:
    chunk: Chunk
    score: float
    rank: int


@dataclass
class QueryResult:
    question: str
    retrieved: list[RetrievedChunk]
    generation: GenerationResult
    rerank_usage: RerankUsage


@dataclass
class IndexedCorpus:
    chunks: list[Chunk]
    vector_store: VectorStore
    bm25: BM25Index
    chunks_per_doc: dict[str, int]


_INDEX_CACHE: "OrderedDict[str, IndexedCorpus]" = OrderedDict()
_INDEX_LOCK = threading.Lock()
_INDEX_CACHE_SIZE = 16


def _index_key(documents: list[Document], config: PipelineConfig) -> str:
    digest = hashlib.sha256()
    for doc in documents:
        digest.update(doc.id.encode())
        digest.update(doc.text.encode())
    parts = [digest.hexdigest(), config.embedding_model, config.chunking_strategy,
             str(config.chunk_size), str(config.chunk_overlap), get_settings().vector_store]
    return "|".join(parts)


def build_index(documents: list[Document], config: PipelineConfig) -> IndexedCorpus:
    key = _index_key(documents, config)
    with _INDEX_LOCK:
        if key in _INDEX_CACHE:
            _INDEX_CACHE.move_to_end(key)
            return _INDEX_CACHE[key]
    settings = get_settings()
    chunks = chunk_documents(documents, config.chunking_strategy, config.chunk_size, config.chunk_overlap)
    embedder = get_embedder(config.embedding_model)
    vectors = embedder.embed([f"{c.title}. {c.text}" for c in chunks])
    store = create_vector_store(settings.vector_store, embedder.dimension, settings.qdrant_url)
    store.add(chunks, vectors)
    per_doc: dict[str, int] = {}
    for c in chunks:
        per_doc[c.doc_id] = per_doc.get(c.doc_id, 0) + 1
    corpus = IndexedCorpus(chunks, store, BM25Index(chunks), per_doc)
    with _INDEX_LOCK:
        _INDEX_CACHE[key] = corpus
        while len(_INDEX_CACHE) > _INDEX_CACHE_SIZE:
            _INDEX_CACHE.popitem(last=False)
    return corpus


def reciprocal_rank_fusion(rankings: list[list[tuple[Chunk, float]]], k: int = 60) -> list[tuple[Chunk, float]]:
    scores: dict[str, float] = {}
    by_id: dict[str, Chunk] = {}
    for ranking in rankings:
        for rank, (chunk, _) in enumerate(ranking, start=1):
            scores[chunk.id] = scores.get(chunk.id, 0.0) + 1.0 / (k + rank)
            by_id[chunk.id] = chunk
    return sorted(((by_id[i], s) for i, s in scores.items()), key=lambda x: x[1], reverse=True)


def weighted_fusion(
    vector: list[tuple[Chunk, float]], keyword: list[tuple[Chunk, float]], alpha: float
) -> list[tuple[Chunk, float]]:
    def normalize(results: list[tuple[Chunk, float]]) -> dict[str, float]:
        if not results:
            return {}
        values = [s for _, s in results]
        lo, hi = min(values), max(values)
        span = (hi - lo) or 1.0
        return {c.id: (s - lo) / span for c, s in results}

    v, kw = normalize(vector), normalize(keyword)
    by_id = {c.id: c for c, _ in vector + keyword}
    fused = {cid: alpha * v.get(cid, 0.0) + (1 - alpha) * kw.get(cid, 0.0) for cid in by_id}
    return sorted(((by_id[i], s) for i, s in fused.items()), key=lambda x: x[1], reverse=True)


class RAGPipeline:
    def __init__(self, config: PipelineConfig, documents: list[Document]) -> None:
        self.config = config
        self.corpus = build_index(documents, config)
        self._embedder = get_embedder(config.embedding_model)
        self._generator = get_generator(config.llm_provider or "local", config.llm_model)
        self._reranker = get_reranker(config.reranker) if config.reranking_enabled else None

    @property
    def generator_model(self) -> str:
        return self._generator.model

    def _first_stage(self, question: str, k: int) -> list[tuple[Chunk, float]]:
        cfg = self.config
        if cfg.retrieval_method == "bm25":
            return self.corpus.bm25.search(question, k)
        query_vector = self._embedder.embed([question])[0]
        vector_hits = self.corpus.vector_store.search(query_vector, k)
        if cfg.retrieval_method == "vector":
            return vector_hits
        keyword_hits = self.corpus.bm25.search(question, k)
        if cfg.fusion == "weighted":
            return weighted_fusion(vector_hits, keyword_hits, cfg.hybrid_alpha)[:k]
        return reciprocal_rank_fusion([vector_hits, keyword_hits])[:k]

    async def retrieve(self, question: str, trace: Trace) -> tuple[list[RetrievedChunk], RerankUsage]:
        cfg = self.config
        pool = max(cfg.rerank_candidates, cfg.top_k) if self._reranker else cfg.top_k
        with trace.span("retrieval", method=cfg.retrieval_method, k=pool) as span:
            hits = await asyncio.to_thread(self._first_stage, question, pool)
            span.set(hits=len(hits))
        usage = RerankUsage()
        if self._reranker:
            with trace.span("rerank", reranker=self._reranker.name, candidates=len(hits)) as span:
                hits, usage = await self._reranker.rerank(question, hits, cfg.top_k)
                span.set(input_tokens=usage.input_tokens, output_tokens=usage.output_tokens)
        hits = hits[: cfg.top_k]
        return [RetrievedChunk(c, s, rank) for rank, (c, s) in enumerate(hits, start=1)], usage

    async def query(self, question: str, trace: Trace) -> QueryResult:
        retrieved, usage = await self.retrieve(question, trace)
        with trace.span("generation", provider=self._generator.provider, model=self._generator.model) as span:
            generation = await self._generator.generate(question, [r.chunk for r in retrieved])
            span.set(input_tokens=generation.input_tokens, output_tokens=generation.output_tokens)
        return QueryResult(question, retrieved, generation, usage)
