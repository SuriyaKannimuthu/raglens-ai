"""Lightweight text processing shared by retrieval, generation and metrics."""

import re

STOPWORDS = frozenset(
    """
    a about above after again against all am an and any are as at be because been before being
    below between both but by can could did do does doing down during each few for from further
    had has have having he her here hers herself him himself his how i if in into is it its itself
    just me more most my myself no nor not now of off on once only or other our ours ourselves out
    over own same she should so some such than that the their theirs them themselves then there
    these they this those through to too under until up very was we were what when where which
    while who whom why will with would you your yours yourself yourselves also may must shall
    get gets got per via does use used using within without into onto across
    """.split()
)

_TOKEN_RE = re.compile(r"[a-z0-9]+(?:[-_.][a-z0-9]+)*")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


def tokenize(text: str) -> list[str]:
    """Lowercase word tokens; keeps identifiers such as ``err-4012`` or ``v2.1`` intact."""
    return _TOKEN_RE.findall(text.lower())


def stem(token: str) -> str:
    """A deliberately small suffix stripper (enough to match plural/tense variants)."""
    if len(token) <= 4 or any(ch.isdigit() for ch in token):
        return token
    for suffix, min_len in (("ations", 7), ("ation", 6), ("ings", 6), ("ing", 5), ("edly", 6),
                            ("ies", 5), ("ied", 5), ("ed", 5), ("es", 5), ("ly", 5), ("s", 4)):
        if token.endswith(suffix) and len(token) >= min_len:
            base = token[: -len(suffix)]
            if suffix in ("ies", "ied"):
                base += "y"
            return base
    return token


def content_terms(text: str) -> list[str]:
    """Stemmed tokens with stopwords removed."""
    return [stem(t) for t in tokenize(text) if t not in STOPWORDS]


def split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_RE.split(text.strip()) if p.strip()]
    return parts or ([text.strip()] if text.strip() else [])


def estimate_tokens(text: str) -> int:
    """Approximate LLM token count (~4 characters per token) for local/offline runs."""
    return max(1, round(len(text) / 4)) if text else 0
