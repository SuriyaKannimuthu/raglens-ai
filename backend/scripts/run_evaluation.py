"""Run an evaluation in-process (no API server or database) and print a metrics table.

Examples:
    python -m scripts.run_evaluation --retrieval-method hybrid --rerank
    python -m scripts.run_evaluation --compare-defaults
    python -m scripts.run_evaluation --retrieval-method vector --min-quality 70   # CI gate
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.evaluation.dataset import load_dataset  # noqa: E402
from app.evaluation.evaluator import aggregate_metrics, evaluate_sample  # noqa: E402
from app.experiments.runner import DEFAULT_EXPERIMENTS  # noqa: E402
from app.monitoring.tracing import Trace  # noqa: E402
from app.rag.pipeline import PipelineConfig, RAGPipeline  # noqa: E402

COLUMNS = ["quality_index", "context_precision", "context_recall", "precision_at_k", "recall_at_k",
           "mrr", "ndcg", "faithfulness", "answer_relevancy", "answer_correctness"]


async def evaluate(dataset_name: str, config: PipelineConfig, judge: str = "heuristic") -> dict:
    dataset = load_dataset(dataset_name)
    pipeline = RAGPipeline(config, dataset.to_documents())
    per_sample = []
    for sample in dataset.samples:
        result = await pipeline.query(sample.question, Trace("cli"))
        evaluation = await evaluate_sample(sample, result, pipeline.corpus.chunks_per_doc, config.top_k, judge)
        per_sample.append(evaluation.metrics)
    return aggregate_metrics(per_sample)


def print_table(rows: list[tuple[str, dict]]) -> None:
    width = max(len(name) for name, _ in rows) + 2
    header = "".join(f"{c[:12]:>13}" for c in COLUMNS)
    print(f"{'configuration':<{width}}{header}")
    for name, metrics in rows:
        values = "".join(
            f"{metrics[c]:>13.2f}" if c == "quality_index" else f"{metrics[c]:>13.3f}" for c in COLUMNS
        )
        print(f"{name:<{width}}{values}")


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", default="sample_dataset")
    parser.add_argument("--retrieval-method", choices=["vector", "bm25", "hybrid"], default="vector")
    parser.add_argument("--embedding-model", default="local-hash-ngrams")
    parser.add_argument("--chunking-strategy", choices=["recursive", "sentence", "fixed"], default="recursive")
    parser.add_argument("--chunk-size", type=int, default=500)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--rerank", action="store_true")
    parser.add_argument("--llm-provider", choices=["local", "anthropic"], default="local")
    parser.add_argument("--judge", choices=["heuristic", "llm"], default="heuristic")
    parser.add_argument("--compare-defaults", action="store_true", help="Run the README A/B/C/D experiments")
    parser.add_argument("--min-quality", type=float, help="Exit non-zero if quality_index is below this")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table")
    args = parser.parse_args()

    if args.compare_defaults:
        rows = []
        for spec in DEFAULT_EXPERIMENTS:
            fields = {k: v for k, v in spec.items() if k in PipelineConfig.model_fields}
            config = PipelineConfig(llm_provider="local", **fields)
            rows.append((spec["name"], await evaluate(args.dataset, config)))
    else:
        config = PipelineConfig(
            retrieval_method=args.retrieval_method, embedding_model=args.embedding_model,
            chunking_strategy=args.chunking_strategy, chunk_size=args.chunk_size, top_k=args.top_k,
            reranking_enabled=args.rerank, llm_provider=args.llm_provider,
        )
        rows = [("run", await evaluate(args.dataset, config, args.judge))]

    if args.json:
        print(json.dumps(dict(rows), indent=2))
    else:
        print_table(rows)

    if args.min_quality is not None:
        worst = min(m["quality_index"] for _, m in rows)
        if worst < args.min_quality:
            print(f"FAIL: quality_index {worst:.2f} is below the required {args.min_quality:.2f}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
