# Architecture

> For the complete design (algorithms, metric formulas, data model, API contracts, decisions), see the [Technical Design Document](technical-design.md).

RAGLens AI has two deployable parts: a FastAPI backend (`backend/`) that runs and stores evaluations, and a Next.js dashboard (`frontend/`) that reads them. The dashboard calls the backend through a `/api/*` rewrite, so the browser only ever talks to one origin.

## Request lifecycle of an evaluation run

1. **Submit.** `POST /evaluations` validates the request (`schemas/requests.py`). Pipeline parameters live in `PipelineConfig`. The endpoint checks that the dataset exists and that Claude-dependent options have an API key (`experiments/runner.validate_capabilities`), inserts an `evaluation_runs` row with status `queued`, and starts a background task.
2. **Index.** `rag/pipeline.build_index` chunks the corpus, embeds the chunks, fills a vector store and builds a BM25 index. Indexes are cached by (corpus hash, embedding model, chunking parameters, vector store), so comparing retrieval methods on the same chunks does not re-embed.
3. **Query.** Questions run concurrently, bounded by `EVALUATION_CONCURRENCY`. For each question a `Trace` records these spans:
   - `retrieval`: vector, BM25 or hybrid search. Hybrid fuses both rankings with reciprocal rank fusion (k=60) or min-max-normalised weighted fusion.
   - `rerank` (optional): a candidate pool (`rerank_candidates`) is rescored by the lexical cross-scorer or by a single listwise Claude call with structured output.
   - `generation`: the extractive generator or Claude produces the answer from numbered context passages.
   - `evaluation`: metrics are computed.
4. **Score.** `evaluation/evaluator.py` computes the retrieval metrics against the dataset's `relevant_doc_ids` (a chunk is relevant when its source document is). It then scores the answer with heuristics or the Claude judge.
5. **Persist.** Each question writes a `sample_results` row and a `traces` row. Run progress (`completed_samples`, `failed_samples`) is committed as questions finish, so the UI can show live progress.
6. **Aggregate.** Metrics are averaged and the quality index is computed. Operational statistics are summarised: latency percentiles per stage, failure rate, token totals, actual cost, projected cost and throughput.
7. **Track.** The finished run is logged to MLflow (params, metrics, a JSON artifact) when `MLFLOW_TRACKING_URI` is set. Tracking failures are logged and never fail a run.

A failure on one question (for example an API error or a model refusal) marks only that question as failed. The run fails only if no question could be scored. On startup, runs left `queued`/`running` by a previous process are marked failed.

## Data model

| Table | Purpose |
|---|---|
| `evaluation_runs` | Configuration, status, aggregate metrics, operational summary, baseline flag, MLflow run id |
| `sample_results` | Per-question answer, retrieved chunks (with relevance), metrics, timings, tokens, cost |
| `traces` | Span timings and attributes for every evaluated or playground query |

SQLite is used locally and PostgreSQL (asyncpg) in Docker. The tables are created on startup.

## Observability

- **Traces:** `monitoring/tracing.py`. Spans are always persisted to the database. With `OTEL_ENABLED=true` they are also emitted as OpenTelemetry spans and exported over OTLP (Jaeger, Grafana Tempo, Langfuse and others), or to the console when no endpoint is set.
- **Metrics:** `monitoring/metrics.py` keeps in-process counters for HTTP requests (by route and status, with a latency histogram) and pipeline queries (failures, tokens, cost). They are exposed as JSON in `/monitoring/summary` and in Prometheus format at `/metrics`.
- **Dashboards:** `/monitoring/summary` and `/dashboard/overview` aggregate database state for the UI.

## Experiment comparison and regression gating

- `experiments/comparison.compare_runs` lines up runs, computes deltas against the baseline, finds the best run per metric, and lists the questions where configurations disagree most.
- `experiments/comparison.check_regression` fails when any metric drops by more than its allowed amount (default 0.02 on 0-1 metrics, 2 points on the quality index), or when p95 latency rises by more than the allowed percentage. Increases under 10 ms are ignored as noise.
- `scripts/run_evaluation.py --min-quality` is the offline gate used in CI. `scripts/regression_check.py` gates a candidate against a running API's baseline.

## Frontend

The dashboard is a Next.js 16 App Router app. Pages are client components that fetch through SWR and poll while runs are active. Charts are hand-written SVG components (`components/charts`): a radar with a target band, a trend line with a crosshair tooltip, a latency histogram, a trace "signal" feed and a span waterfall. The categorical colors used to compare runs were checked for colorblind separation and contrast on the dark surface. Each run keeps its color while the selection changes.

## Configuration

All backend settings are environment variables (`backend/.env.example`). The `/config` endpoint reports what the deployment can do (available providers, embedding models, integrations), and the UI disables options the backend cannot serve.
