"""Chunking strategies. Every chunk keeps the id of its source document so retrieval
results can be scored against the dataset's relevance labels."""

from dataclasses import dataclass
from typing import Literal

from app.core.text import split_sentences

ChunkingStrategy = Literal["fixed", "sentence", "recursive"]


@dataclass(frozen=True)
class Document:
    id: str
    title: str
    text: str


@dataclass(frozen=True)
class Chunk:
    id: str
    doc_id: str
    title: str
    text: str
    position: int


def _fixed(text: str, size: int, overlap: int) -> list[str]:
    """Character windows that snap to word boundaries."""
    words = text.split()
    chunks, current, length = [], [], 0
    i = 0
    while i < len(words):
        word = words[i]
        if current and length + len(word) + 1 > size:
            chunks.append(" ".join(current))
            # Carry the trailing `overlap` characters' worth of words into the next window.
            carried, carried_len = [], 0
            for w in reversed(current):
                if carried_len + len(w) + 1 > overlap:
                    break
                carried.insert(0, w)
                carried_len += len(w) + 1
            current, length = carried, carried_len
        current.append(word)
        length += len(word) + 1
        i += 1
    if current:
        chunks.append(" ".join(current))
    return chunks


def _sentence(text: str, size: int, overlap: int) -> list[str]:
    """Pack whole sentences up to `size` characters; overlap by repeating the last sentence."""
    sentences = split_sentences(" ".join(text.split()))
    chunks: list[str] = []
    current: list[str] = []
    for sentence in sentences:
        if current and sum(len(s) + 1 for s in current) + len(sentence) > size:
            chunks.append(" ".join(current))
            current = [current[-1]] if overlap > 0 and len(current[-1]) <= overlap * 2 else []
        current.append(sentence)
    if current:
        chunks.append(" ".join(current))
    return chunks


def _recursive(text: str, size: int, overlap: int) -> list[str]:
    """Split on paragraphs first, then sentences, then words - keeping structure where possible."""
    chunks: list[str] = []
    buffer = ""
    for paragraph in [p.strip() for p in text.split("\n\n") if p.strip()]:
        paragraph = " ".join(paragraph.split())
        if len(paragraph) > size:
            if buffer:
                chunks.append(buffer)
                buffer = ""
            chunks.extend(_sentence(paragraph, size, overlap))
        elif buffer and len(buffer) + len(paragraph) + 1 > size:
            chunks.append(buffer)
            buffer = paragraph
        else:
            buffer = f"{buffer} {paragraph}".strip()
    if buffer:
        chunks.append(buffer)
    return chunks


_STRATEGIES = {"fixed": _fixed, "sentence": _sentence, "recursive": _recursive}


def chunk_documents(
    documents: list[Document],
    strategy: ChunkingStrategy = "recursive",
    chunk_size: int = 500,
    chunk_overlap: int = 50,
) -> list[Chunk]:
    if strategy not in _STRATEGIES:
        raise ValueError(f"Unknown chunking strategy: {strategy}")
    if chunk_overlap >= chunk_size:
        raise ValueError("chunk_overlap must be smaller than chunk_size")
    splitter = _STRATEGIES[strategy]
    chunks: list[Chunk] = []
    for doc in documents:
        source = doc.text if strategy == "recursive" else " ".join(doc.text.split())
        for position, piece in enumerate(splitter(source, chunk_size, chunk_overlap)):
            chunks.append(Chunk(id=f"{doc.id}::{position}", doc_id=doc.id, title=doc.title,
                                text=piece, position=position))
    return chunks
