"""Embedding models.

Two dependency-free local embedders ship by default so evaluations run offline and are
fully reproducible. They are *feature-hashing* models: fast and deterministic, but lexical
in nature - they are baselines, not substitutes for neural embedding models. A
sentence-transformers model is used automatically when the package is installed and the
model name is prefixed with ``sentence-transformers/``.
"""

import zlib
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import numpy as np

from app.core.text import STOPWORDS, content_terms, tokenize


class EmbeddingModel(Protocol):
    name: str
    dimension: int

    def embed(self, texts: list[str]) -> np.ndarray: ...


@dataclass(frozen=True)
class EmbeddingModelInfo:
    name: str
    description: str
    dimension: int
    local: bool
    available: bool


def _bucket(feature: str, dim: int) -> tuple[int, float]:
    h = zlib.crc32(feature.encode("utf-8"))
    return h % dim, (1.0 if (h >> 31) & 1 == 0 else -1.0)


def _normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms


class HashingWordEmbedder:
    """Signed feature hashing over stemmed unigrams and bigrams with sublinear TF."""

    def __init__(self, dimension: int = 2048):
        self.name = "local-hash-words"
        self.dimension = dimension

    def _features(self, text: str) -> dict[str, float]:
        terms = content_terms(text)
        feats: dict[str, float] = {}
        for t in terms:
            feats[t] = feats.get(t, 0.0) + 1.0
        for a, b in zip(terms, terms[1:]):
            key = f"{a}_{b}"
            feats[key] = feats.get(key, 0.0) + 0.5
        return feats

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            for feature, count in self._features(text).items():
                idx, sign = _bucket(feature, self.dimension)
                out[row, idx] += sign * (1.0 + np.log(count))
        return _normalize(out)


class HashingCharNgramEmbedder:
    """Character 3-5 gram hashing: tolerant to morphology, typos and partial word matches,
    which makes it behave more 'semantically' than pure word matching."""

    def __init__(self, dimension: int = 4096):
        self.name = "local-hash-ngrams"
        self.dimension = dimension

    def _features(self, text: str) -> dict[str, float]:
        feats: dict[str, float] = {}
        for token in tokenize(text):
            if token in STOPWORDS:
                continue
            padded = f"<{token}>"
            feats[f"w:{token}"] = feats.get(f"w:{token}", 0.0) + 1.0
            for n in (3, 4, 5):
                for i in range(max(1, len(padded) - n + 1)):
                    gram = padded[i : i + n]
                    feats[gram] = feats.get(gram, 0.0) + 1.0 / n
        return feats

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dimension), dtype=np.float32)
        for row, text in enumerate(texts):
            for feature, count in self._features(text).items():
                idx, sign = _bucket(feature, self.dimension)
                out[row, idx] += sign * (1.0 + np.log1p(count))
        return _normalize(out)


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # optional dependency

        self.name = f"sentence-transformers/{model_name}"
        self._model = SentenceTransformer(model_name)
        self.dimension = int(self._model.get_sentence_embedding_dimension())

    def embed(self, texts: list[str]) -> np.ndarray:
        vectors = self._model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return np.asarray(vectors, dtype=np.float32)


def _sentence_transformers_installed() -> bool:
    try:
        import sentence_transformers  # noqa: F401
    except ImportError:
        return False
    return True


LOCAL_MODELS = {
    "local-hash-words": ("Feature-hashed stemmed word unigrams + bigrams (lexical baseline)", 2048),
    "local-hash-ngrams": ("Feature-hashed character 3-5 grams (morphology-tolerant)", 4096),
}


def list_embedding_models() -> list[EmbeddingModelInfo]:
    models = [EmbeddingModelInfo(name, desc, dim, True, True) for name, (desc, dim) in LOCAL_MODELS.items()]
    models.append(
        EmbeddingModelInfo(
            "sentence-transformers/all-MiniLM-L6-v2",
            "Neural sentence embeddings (requires the optional sentence-transformers package)",
            384,
            True,
            _sentence_transformers_installed(),
        )
    )
    return models


@lru_cache(maxsize=8)
def get_embedder(name: str) -> EmbeddingModel:
    if name == "local-hash-words":
        return HashingWordEmbedder()
    if name == "local-hash-ngrams":
        return HashingCharNgramEmbedder()
    if name.startswith("sentence-transformers/"):
        if not _sentence_transformers_installed():
            raise ValueError("sentence-transformers is not installed; see requirements-optional.txt")
        return SentenceTransformerEmbedder(name.split("/", 1)[1])
    raise ValueError(f"Unknown embedding model: {name}")
