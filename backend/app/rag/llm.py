"""Answer generators.

``local`` is an offline extractive generator: it answers by selecting the context sentences
that best match the question. It needs no API key, which keeps the platform runnable and
its tests deterministic. ``anthropic`` generates answers with Claude.
"""

import logging
import math
import time
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import anthropic

from app.core.config import get_settings
from app.core.text import content_terms, estimate_tokens, split_sentences
from app.rag.chunking import Chunk

logger = logging.getLogger(__name__)

NO_ANSWER = "I don't know based on the provided context."

RAG_SYSTEM_PROMPT = (
    "You answer questions for a retrieval-augmented generation system. Use only the numbered "
    "context passages supplied with the question. If the passages do not contain the answer, "
    f'reply exactly: "{NO_ANSWER}" Answer in one to three sentences, state specific values '
    "(numbers, names, limits) exactly as written in the passages, and do not add outside knowledge."
)


class LLMError(RuntimeError):
    pass


@dataclass
class GenerationResult:
    answer: str
    model: str
    provider: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    tokens_estimated: bool
    stop_reason: str | None = None


class Generator(Protocol):
    provider: str
    model: str

    async def generate(self, question: str, contexts: list[Chunk]) -> GenerationResult: ...


def build_context_prompt(question: str, contexts: list[Chunk]) -> str:
    passages = "\n\n".join(f"[{i}] ({c.title})\n{c.text}" for i, c in enumerate(contexts, start=1))
    return f"<context>\n{passages}\n</context>\n\nQuestion: {question}"


class LocalExtractiveGenerator:
    provider = "local"
    model = "local-extractive"

    def __init__(self, max_sentences: int = 2, min_overlap: float = 0.2) -> None:
        self.max_sentences = max_sentences
        self.min_overlap = min_overlap

    async def generate(self, question: str, contexts: list[Chunk]) -> GenerationResult:
        start = time.perf_counter()
        prompt = build_context_prompt(question, contexts)
        answer = self._extract(question, contexts)
        return GenerationResult(
            answer=answer,
            model=self.model,
            provider=self.provider,
            input_tokens=estimate_tokens(RAG_SYSTEM_PROMPT + prompt),
            output_tokens=estimate_tokens(answer),
            latency_ms=(time.perf_counter() - start) * 1000,
            tokens_estimated=True,
        )

    def _extract(self, question: str, contexts: list[Chunk]) -> str:
        q_terms = set(content_terms(question))
        if not q_terms or not contexts:
            return NO_ANSWER
        candidates: list[tuple[str, set[str], int]] = []
        df: Counter[str] = Counter()
        for rank, chunk in enumerate(contexts):
            for sentence in split_sentences(chunk.text):
                terms = set(content_terms(sentence))
                candidates.append((sentence, terms, rank))
                df.update(terms)
        n = max(1, len(candidates))
        idf = {t: math.log(1 + n / (1 + df[t])) for t in df}
        q_weight = sum(idf.get(t, math.log(1 + n)) for t in q_terms)

        def score(item: tuple[str, set[str], int]) -> float:
            _, terms, rank = item
            overlap = sum(idf[t] for t in q_terms & terms) / q_weight
            return overlap * (1.0 - 0.04 * rank)

        ranked = sorted(candidates, key=score, reverse=True)
        best = ranked[0]
        if score(best) < self.min_overlap:
            return NO_ANSWER
        chosen = [best]
        covered = q_terms & best[1]
        for item in ranked[1:]:
            if len(chosen) >= self.max_sentences:
                break
            new_terms = (q_terms & item[1]) - covered
            if new_terms and score(item) >= 0.6 * score(best):
                chosen.append(item)
                covered |= new_terms
        return " ".join(sentence for sentence, _, _ in chosen)


@lru_cache
def get_anthropic_client() -> anthropic.AsyncAnthropic:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise LLMError("ANTHROPIC_API_KEY is not configured")
    return anthropic.AsyncAnthropic(
        api_key=settings.anthropic_api_key,
        timeout=settings.anthropic_timeout_seconds,
        max_retries=3,
    )


def describe_api_error(exc: Exception) -> str:
    if isinstance(exc, anthropic.AuthenticationError):
        return "Anthropic authentication failed - check ANTHROPIC_API_KEY"
    if isinstance(exc, anthropic.RateLimitError):
        return "Anthropic rate limit exceeded after retries"
    if isinstance(exc, anthropic.BadRequestError):
        return f"Anthropic rejected the request: {exc.message}"
    if isinstance(exc, anthropic.APIStatusError):
        return f"Anthropic API error ({exc.status_code}): {exc.message}"
    if isinstance(exc, anthropic.APIConnectionError):
        return "Could not reach the Anthropic API"
    return str(exc)


class AnthropicGenerator:
    provider = "anthropic"

    def __init__(self, model: str | None = None) -> None:
        settings = get_settings()
        self.model = model or settings.anthropic_model
        self._effort = settings.anthropic_effort
        self._max_tokens = settings.anthropic_max_tokens

    async def generate(self, question: str, contexts: list[Chunk]) -> GenerationResult:
        client = get_anthropic_client()
        start = time.perf_counter()
        try:
            response = await client.beta.messages.create(
                model=self.model,
                max_tokens=self._max_tokens,
                system=RAG_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": build_context_prompt(question, contexts)}],
                output_config={"effort": self._effort},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIError as exc:
            raise LLMError(describe_api_error(exc)) from exc
        latency_ms = (time.perf_counter() - start) * 1000
        if response.stop_reason == "refusal":
            raise LLMError("The model declined to answer this request (stop_reason=refusal)")
        answer = "".join(block.text for block in response.content if block.type == "text").strip()
        return GenerationResult(
            answer=answer or NO_ANSWER,
            model=response.model,
            provider=self.provider,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            latency_ms=latency_ms,
            tokens_estimated=False,
            stop_reason=response.stop_reason,
        )


def get_generator(provider: str, model: str | None = None) -> Generator:
    if provider == "local":
        return LocalExtractiveGenerator()
    if provider == "anthropic":
        return AnthropicGenerator(model)
    raise ValueError(f"Unknown LLM provider: {provider}")
