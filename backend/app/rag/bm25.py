"""Okapi BM25 keyword index used for keyword and hybrid retrieval."""

import math
from collections import Counter

from app.core.text import content_terms
from app.rag.chunking import Chunk


class BM25Index:
    def __init__(self, chunks: list[Chunk], k1: float = 1.5, b: float = 0.75) -> None:
        self.chunks = chunks
        self.k1, self.b = k1, b
        self._tfs = [Counter(content_terms(f"{c.title} {c.text}")) for c in chunks]
        self._lengths = [sum(tf.values()) for tf in self._tfs]
        self._avg_len = (sum(self._lengths) / len(self._lengths)) if self._lengths else 0.0
        df: Counter[str] = Counter()
        for tf in self._tfs:
            df.update(tf.keys())
        n = len(chunks)
        self._idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def score(self, query: str) -> list[float]:
        terms = content_terms(query)
        scores = [0.0] * len(self.chunks)
        for i, tf in enumerate(self._tfs):
            norm = self.k1 * (1 - self.b + self.b * self._lengths[i] / (self._avg_len or 1.0))
            s = 0.0
            for t in terms:
                f = tf.get(t)
                if f:
                    s += self._idf.get(t, 0.0) * f * (self.k1 + 1) / (f + norm)
            scores[i] = s
        return scores

    def search(self, query: str, k: int) -> list[tuple[Chunk, float]]:
        scores = self.score(query)
        ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        return [(self.chunks[i], scores[i]) for i in ranked[:k] if scores[i] > 0]
