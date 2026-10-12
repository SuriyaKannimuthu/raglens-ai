import numpy as np
import pytest

from app.core.text import stem, tokenize
from app.monitoring.tracing import Trace
from app.rag.bm25 import BM25Index
from app.rag.chunking import Chunk, Document, chunk_documents
from app.rag.embeddings import get_embedder
from app.rag.pipeline import PipelineConfig, RAGPipeline, reciprocal_rank_fusion, weighted_fusion

DOCS = [
    Document("d1", "Errors", "ERR-4012 means the token expired. Refresh the token.\n\nERR-5003 is a timeout."),
    Document("d2", "Pricing", "The Pro plan costs $49 per month. Overage is billed per GB."),
    Document("d3", "Backups", "Snapshots are taken every 6 hours and kept for 35 days."),
]


def test_tokenizer_keeps_identifiers_and_stems():
    assert "err-4012" in tokenize("Got ERR-4012 today")
    assert stem("snapshots") == stem("snapshot")


@pytest.mark.parametrize("strategy", ["fixed", "sentence", "recursive"])
def test_chunking_preserves_document_ids(strategy):
    chunks = chunk_documents(DOCS, strategy, chunk_size=120, chunk_overlap=20)
    assert {c.doc_id for c in chunks} == {"d1", "d2", "d3"}
    assert all(len(c.text) <= 160 for c in chunks)
    assert len({c.id for c in chunks}) == len(chunks)


def test_chunking_rejects_bad_overlap():
    with pytest.raises(ValueError):
        chunk_documents(DOCS, "fixed", chunk_size=100, chunk_overlap=100)


def test_bm25_ranks_exact_identifier_first():
    chunks = chunk_documents(DOCS, "recursive", 500, 50)
    hits = BM25Index(chunks).search("what is ERR-5003", k=3)
    assert hits[0][0].doc_id == "d1"


@pytest.mark.parametrize("model", ["local-hash-words", "local-hash-ngrams"])
def test_embeddings_are_normalized_and_deterministic(model):
    embedder = get_embedder(model)
    a = embedder.embed(["snapshot retention policy", "snapshot retention policy"])
    assert a.shape == (2, embedder.dimension)
    assert np.allclose(np.linalg.norm(a, axis=1), 1.0, atol=1e-5)
    assert np.allclose(a[0], a[1])


def test_char_ngram_embeddings_tolerate_morphology():
    embedder = get_embedder("local-hash-ngrams")
    q, close, far = embedder.embed(["restoring snapshots", "snapshot restore", "pricing per month"])
    assert q @ close > q @ far


def test_rank_fusion_combines_rankings():
    c = [Chunk(f"c{i}", "d", "t", "x", i) for i in range(3)]
    fused = reciprocal_rank_fusion([[(c[0], 1.0), (c[1], 0.5)], [(c[1], 9.0), (c[2], 3.0)]])
    assert fused[0][0].id == "c1"  # appears in both rankings
    weighted = weighted_fusion([(c[0], 1.0), (c[1], 0.0)], [(c[1], 5.0), (c[0], 0.0)], alpha=0.9)
    assert weighted[0][0].id == "c0"


@pytest.mark.parametrize("method", ["vector", "bm25", "hybrid"])
async def test_pipeline_query_returns_ranked_chunks_and_trace(method):
    config = PipelineConfig(retrieval_method=method, top_k=2, llm_provider="local", chunk_size=200, chunk_overlap=20)
    pipeline = RAGPipeline(config, DOCS)
    trace = Trace("test")
    result = await pipeline.query("How long are snapshots kept?", trace)
    assert result.retrieved[0].chunk.doc_id == "d3"
    assert [r.rank for r in result.retrieved] == list(range(1, len(result.retrieved) + 1))
    assert "35 days" in result.generation.answer
    assert {s.name for s in trace.spans} == {"retrieval", "generation"}


async def test_lexical_reranking_adds_rerank_span():
    config = PipelineConfig(retrieval_method="hybrid", reranking_enabled=True, top_k=2, llm_provider="local")
    trace = Trace("test")
    result = await RAGPipeline(config, DOCS).query("What does the Pro plan cost?", trace)
    assert result.retrieved[0].chunk.doc_id == "d2"
    assert "rerank" in {s.name for s in trace.spans}
