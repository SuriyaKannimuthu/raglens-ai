"""Second-stage rerankers applied to a larger candidate pool from the first-stage retriever."""

import math
from collections import Counter
from dataclasses import dataclass
from typing import Protocol

import anthropic
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.text import content_terms
from app.rag.chunking import Chunk
from app.rag.llm import LLMError, describe_api_error, get_anthropic_client


@dataclass
class RerankUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    model: str | None = None


class Reranker(Protocol):
    name: str

    async def rerank(
        self, query: str, candidates: list[tuple[Chunk, float]], top_k: int
    ) -> tuple[list[tuple[Chunk, float]], RerankUsage]: ...


def _bigrams(terms: list[str]) -> set[tuple[str, str]]:
    return set(zip(terms, terms[1:]))


class LexicalReranker:
    """Query-passage cross-scoring with IDF-weighted term coverage, phrase (bigram) matches
    and title matches, blended with the first-stage rank as a prior."""

    name = "lexical"

    async def rerank(self, query, candidates, top_k):
        q_terms = content_terms(query)
        q_set = set(q_terms)
        q_bigrams = _bigrams(q_terms)
        docs = [content_terms(f"{c.title} {c.text}") for c, _ in candidates]
        df: Counter[str] = Counter()
        for terms in docs:
            df.update(set(terms))
        n = max(1, len(docs))
        idf = {t: math.log(1 + (n + 1) / (df[t] + 0.5)) for t in q_set}
        q_weight = sum(idf.values()) or 1.0

        rescored = []
        for rank, ((chunk, _), terms) in enumerate(zip(candidates, docs)):
            term_set = set(terms)
            coverage = sum(idf[t] for t in q_set & term_set) / q_weight
            phrase = len(q_bigrams & _bigrams(terms)) / len(q_bigrams) if q_bigrams else 0.0
            title = len(q_set & set(content_terms(chunk.title))) / len(q_set) if q_set else 0.0
            prior = 1.0 / (1.0 + rank)
            score = 0.55 * coverage + 0.2 * phrase + 0.1 * title + 0.15 * prior
            rescored.append((chunk, score))
        rescored.sort(key=lambda item: item[1], reverse=True)
        return rescored[:top_k], RerankUsage()


class _PassageScore(BaseModel):
    passage: int = Field(description="Passage number as shown in brackets")
    relevance: int = Field(description="0 (irrelevant) to 10 (directly answers the question)")


class _RerankResponse(BaseModel):
    scores: list[_PassageScore]


class LLMReranker:
    """Listwise reranking with Claude: one structured-output call scores every candidate."""

    name = "llm"

    def __init__(self, model: str | None = None) -> None:
        self.model = model or get_settings().anthropic_judge_model

    async def rerank(self, query, candidates, top_k):
        passages = "\n\n".join(f"[{i}] {c.text}" for i, (c, _) in enumerate(candidates, start=1))
        prompt = (
            "Score how useful each passage is for answering the question. Use 10 for a passage "
            "that directly contains the answer and 0 for an unrelated passage. Score every passage.\n\n"
            f"Question: {query}\n\nPassages:\n{passages}"
        )
        try:
            response = await get_anthropic_client().beta.messages.parse(
                model=self.model,
                max_tokens=4000,
                messages=[{"role": "user", "content": prompt}],
                output_format=_RerankResponse,
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as exc:
            raise LLMError(describe_api_error(exc)) from exc
        if response.stop_reason == "refusal" or response.parsed_output is None:
            raise LLMError("LLM reranker returned no usable scores")
        relevance = {s.passage: s.relevance for s in response.parsed_output.scores}
        rescored = [
            (chunk, relevance.get(i, 0) / 10 + 0.01 / i)  # tiny rank prior breaks ties
            for i, (chunk, _) in enumerate(candidates, start=1)
        ]
        rescored.sort(key=lambda item: item[1], reverse=True)
        usage = RerankUsage(response.usage.input_tokens, response.usage.output_tokens, response.model)
        return rescored[:top_k], usage


def get_reranker(name: str) -> Reranker:
    if name == "lexical":
        return LexicalReranker()
    if name == "llm":
        return LLMReranker()
    raise ValueError(f"Unknown reranker: {name}")
