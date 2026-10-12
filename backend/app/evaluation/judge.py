"""LLM-as-a-judge answer evaluation with Claude.

Safeguards: the judge returns counts and 0-10 ratings through a validated structured-output
schema (never free-form numbers parsed from text); ratios are computed and clamped here; a
judge failure is recorded on the sample instead of silently falling back to a score.
"""

from dataclasses import dataclass

import anthropic
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.rag.llm import LLMError, describe_api_error, get_anthropic_client

JUDGE_PROMPT = """You are grading one answer produced by a retrieval-augmented generation system.

<question>{question}</question>
<retrieved_context>
{context}
</retrieved_context>
<generated_answer>{answer}</generated_answer>
<reference_answer>{reference}</reference_answer>

Grade with these definitions:
- answer_claims_total: number of distinct factual claims in the generated answer (0 if it declines to answer).
- answer_claims_supported: how many of those claims are directly supported by the retrieved context.
- reference_statements_total: number of distinct factual statements in the reference answer.
- reference_statements_in_context: how many reference statements can be found in the retrieved context.
- answer_relevancy: 0-10, how directly the generated answer addresses the question (ignore correctness).
- answer_correctness: 0-10, how well the generated answer agrees with the reference answer.
Keep the rationale to one sentence."""


class JudgeVerdict(BaseModel):
    answer_claims_total: int = Field(ge=0)
    answer_claims_supported: int = Field(ge=0)
    reference_statements_total: int = Field(ge=0)
    reference_statements_in_context: int = Field(ge=0)
    answer_relevancy: int = Field(ge=0, le=10)
    answer_correctness: int = Field(ge=0, le=10)
    rationale: str


@dataclass
class JudgeResult:
    faithfulness: float
    context_recall: float
    answer_relevancy: float
    answer_correctness: float
    rationale: str
    input_tokens: int
    output_tokens: int
    model: str


def _ratio(part: int, whole: int, empty: float) -> float:
    if whole <= 0:
        return empty
    return max(0.0, min(1.0, part / whole))


async def judge_answer(question: str, answer: str, reference: str, contexts: list[str]) -> JudgeResult:
    settings = get_settings()
    context = "\n\n".join(f"[{i}] {c}" for i, c in enumerate(contexts, start=1)) or "(no context retrieved)"
    prompt = JUDGE_PROMPT.format(question=question, context=context, answer=answer, reference=reference)
    try:
        response = await get_anthropic_client().beta.messages.parse(
            model=settings.anthropic_judge_model,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
            output_format=JudgeVerdict,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as exc:
        raise LLMError(describe_api_error(exc)) from exc
    verdict = response.parsed_output
    if response.stop_reason == "refusal" or verdict is None:
        raise LLMError("Judge returned no verdict")
    return JudgeResult(
        faithfulness=_ratio(verdict.answer_claims_supported, verdict.answer_claims_total, 1.0),
        context_recall=_ratio(verdict.reference_statements_in_context, verdict.reference_statements_total, 0.0),
        answer_relevancy=verdict.answer_relevancy / 10,
        answer_correctness=verdict.answer_correctness / 10,
        rationale=verdict.rationale,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        model=response.model,
    )
