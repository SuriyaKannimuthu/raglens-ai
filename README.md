# RAGLens AI

### RAG evaluation & observability platform

> 📘 **[Technical Design Document (PDF)](docs/RAGLens-AI-Technical-Design-Document.pdf)**: the detailed design of the system (requirements, architecture, RAG pipeline algorithms, metric formulas, data model, API contracts, frontend design, deployment, testing strategy and design decisions).

RAGLens AI evaluates, compares and monitors **Retrieval-Augmented Generation (RAG)** pipelines. It runs a labelled question set through a RAG configuration and scores retrieval and answer quality. It also records latency, tokens and cost for every query and shows the results in a dashboard. You can compare configurations and block quality regressions in CI.

It works **out of the box with no API key**. The default stack (local embeddings, BM25, an extractive answer generator and deterministic metrics) runs fully offline. Add an Anthropic API key to generate, rerank and judge answers with Claude.

![RAGLens dashboard](docs/screenshots/dashboard.png)

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Set up the backend](#2-set-up-the-backend)
  - [3. Set up the frontend](#3-set-up-the-frontend)
  - [4. Open the app](#4-open-the-app)
  - [Alternative: Docker Compose](#alternative-docker-compose)
- [Configuration](#configuration)
- [Using the frontend](#using-the-frontend)
- [Typical workflow](#typical-workflow)
- [Adding your own dataset](#adding-your-own-dataset)
- [Metrics reference](#metrics-reference)
- [Example results](#example-results)
- [API reference](#api-reference)
- [Testing and regression gates](#testing-and-regression-gates)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)
- [Limitations](#limitations)
- [Author](#author)

---

## Features

| Area | What you get |
|---|---|
| **RAG evaluation** | Run any labelled dataset through a pipeline and score every question |
| **Configuration comparison** | Compare embedding models, chunking strategies (recursive / sentence / fixed), retrieval methods (vector / BM25 / hybrid) and reranking |
| **Retrieval metrics** | Context precision, context recall, Precision@K, Recall@K, MRR, nDCG@K, hit rate |
| **Answer metrics** | Faithfulness, answer relevancy, answer correctness, scored by deterministic heuristics or Claude as an LLM judge |
| **Experiment tracking** | Every run is stored in the database and logged to MLflow |
| **Performance monitoring** | Latency percentiles per stage, failure rate, token usage, actual and projected cost |
| **Regression testing** | A pass/fail gate that compares a candidate run with the baseline, available in the UI, the API and CI |
| **Observability** | Every query is traced (retrieval → rerank → generation → evaluation), with optional OpenTelemetry export and Prometheus metrics |
| **Dashboard** | A Next.js UI with a quality radar, run comparison, trace explorer and a query playground |

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12+, FastAPI, Pydantic v2, SQLAlchemy 2 (async) |
| Database | SQLite (local default) / PostgreSQL (Docker) |
| Retrieval | Feature-hashing embeddings, numpy vector search (or Qdrant), BM25, rank fusion, rerankers |
| LLM | Anthropic Claude (`claude-opus-5-5`) or an offline extractive generator |
| Tracking & observability | MLflow, OpenTelemetry (OTLP), Prometheus text format |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, SWR |
| Testing / CI | Pytest, ESLint, TypeScript, GitHub Actions |
| Deployment | Docker, Docker Compose |

---

## Quick start

The app has two parts that run side by side:

| Part | Folder | URL |
|---|---|---|
| Backend API (FastAPI) | `backend/` | http://localhost:8000 (docs at `/docs`) |
| Frontend dashboard (Next.js) | `frontend/` | http://localhost:3000 |

### Prerequisites

- **Python 3.12 or newer** (`python --version`, or `py --version` on Windows)
- **Node.js 20.9 or newer** with npm (`node --version`)
- **Git**
- *Optional:* Docker Desktop, if you prefer the Docker Compose setup
- *Optional:* an Anthropic API key, to use Claude

### 1. Clone the repository

```bash
git clone <your-github-repository-url>
cd raglens-ai
```

### 2. Set up the backend

Open a terminal in the `backend` folder.

**Windows (PowerShell)**

```powershell
cd backend
py -m venv .venv                  # any Python 3.12+ (or: python -m venv .venv)
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

**macOS / Linux**

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

You should see `Uvicorn running on http://127.0.0.1:8000`. Check it with:

```bash
curl http://localhost:8000/health
# {"status":"ok","database":"ok","active_runs":0}
```

> **First start:** with an empty database, the API runs four example experiments (A-D) in the background. They take a few seconds, and the dashboard has data as soon as it opens. Set `AUTO_SEED_EXPERIMENTS=false` in `.env` to turn this off.

The defaults in `.env.example` work as they are: a SQLite file (`backend/raglens.db`) and the fully offline stack.

### 3. Set up the frontend

Open a **second terminal** in the `frontend` folder:

```bash
cd frontend
npm install
npm run dev
```

The frontend proxies every `/api/*` request to the backend, so the browser needs no CORS setup. If your backend is not on `http://localhost:8000`, set `BACKEND_URL` before starting:

```bash
# macOS / Linux
BACKEND_URL=http://localhost:9000 npm run dev
# Windows PowerShell
$env:BACKEND_URL="http://localhost:9000"; npm run dev
```

For a production build (`BACKEND_URL` is applied at build time):

```bash
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
node .next/standalone/server.js
```

### 4. Open the app

Go to **http://localhost:3000**. The **System Status** card at the bottom of the sidebar should read **Optimal**. If it reads *API offline*, the backend isn't running (see [Troubleshooting](#troubleshooting)).

### Alternative: Docker Compose

Runs PostgreSQL, MLflow, the API and the dashboard together:

```bash
cp backend/.env.example backend/.env    # optional: add ANTHROPIC_API_KEY
docker compose up --build
```

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API + Swagger docs | http://localhost:8000/docs |
| MLflow UI | http://localhost:5000 |

---

## Configuration

All backend settings are environment variables, read from `backend/.env`. See `backend/.env.example` for the full list.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./raglens.db` | Use `postgresql+asyncpg://user:pass@host:5432/db` for PostgreSQL |
| `LLM_PROVIDER` | `local` | Default answer generator: `local` (offline) or `anthropic` (Claude) |
| `ANTHROPIC_API_KEY` | *(empty)* | Enables Claude generation, the Claude reranker and the LLM judge |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used to generate answers |
| `ANTHROPIC_JUDGE_MODEL` | `claude-opus-5-5` | Model used by the LLM judge and the LLM reranker |
| `ANTHROPIC_EFFORT` | `low` | Claude effort level for answer generation |
| `COST_REFERENCE_MODEL` | `claude-opus-5-5` | Pricing used to *project* cost for free local runs |
| `VECTOR_STORE` | `memory` | `memory` (numpy) or `qdrant` (install `qdrant-client`) |
| `MLFLOW_TRACKING_URI` | *(empty)* | e.g. `sqlite:///mlflow.db` or `http://localhost:5000`; empty disables MLflow |
| `OTEL_ENABLED` | `false` | Export traces with OpenTelemetry (install the optional OTel packages) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | e.g. `http://localhost:4318/v1/traces` |
| `EVALUATION_CONCURRENCY` | `4` | Questions evaluated in parallel per run |
| `AUTO_SEED_EXPERIMENTS` | `true` | Run the example experiments on first start |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Only needed if the browser calls the API directly |

Frontend: `BACKEND_URL` (default `http://localhost:8000`) sets where `/api/*` requests are proxied.

### Using Claude

Add to `backend/.env` and restart the backend:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

The **Claude** generator, **Claude (LLM)** reranker and **LLM judge** options then become available in the UI. To make Claude the default generator for new runs, also set `LLM_PROVIDER=anthropic`. Requests opt into server-side refusal fallbacks, and token counts and costs come from the API's usage data.

### Using MLflow

```env
MLFLOW_TRACKING_URI=sqlite:///mlflow.db
```

Each completed run is logged with its parameters, metrics and a JSON artifact. The run's MLflow id appears on the run detail page. To browse runs locally, install the full package (`pip install mlflow`) and run `mlflow ui --backend-store-uri sqlite:///mlflow.db`. With Docker Compose, MLflow is already set up at http://localhost:5000.

### Optional integrations

```bash
pip install -r requirements-optional.txt
```

This installs `sentence-transformers` (neural embeddings), `qdrant-client` (Qdrant vector store) and the OpenTelemetry SDK and exporter.

---

## Using the frontend

The sidebar has seven pages:

| Page | Use it to |
|---|---|
| **Dashboard** | See overall quality, trends, alerts and recommendations at a glance |
| **Evaluations** | List all runs, start a new evaluation, open a run's detailed results |
| **Experiments** | Compare up to four runs side by side and run the regression gate |
| **Monitoring** | Watch latency, failures, tokens, cost and individual traces |
| **Playground** | Ask one question with any configuration and inspect retrieval and timing |
| **Datasets** | Browse the evaluation documents and labelled questions |
| **Settings** | See which providers, models and integrations the backend has enabled |

The header shows the current page, a **Live** indicator (data refreshes automatically), the UTC clock, an alert bell and a fullscreen toggle.

### Dashboard

![Dashboard](docs/screenshots/dashboard.png)

| Panel | What it shows |
|---|---|
| **Quality Index** | Composite score (0-100) of the latest completed run, its trend, and the change from the previous run |
| **Retrieval Recall** | Recall@K of the latest run; each bar is one recent run |
| **Alerts** | Failed runs, runs more than 2 points below the baseline, and runs with failed queries |
| **Quality Radar** | The focus run (solid cyan, defaults to the best run) against the baseline (dashed violet) on seven metrics. The green ring marks the ≥ 80 target zone. Hover a vertex for exact values, and pick another run with the dropdown |
| **Quality Trend** | Quality index across completed runs, oldest to newest; hover for run names |
| **Weakest Metrics** | The four lowest metrics of the focus run: where to optimize next |
| **Run Status** | Recent runs with their quality level and trend versus the previous run |
| **Live Trace Feed** | One bar per recent query (height = latency, red = failed) with p50 latency, errors and cost per query |
| **Recommendations** | Rule-based next steps, for example "Switch to hybrid retrieval" when recall is low |

### Running an evaluation

Go to **Evaluations → New evaluation**.

![New evaluation form](docs/screenshots/new-evaluation.png)

**Pipeline configuration**

| Field | Options | Notes |
|---|---|---|
| Retrieval method | Vector · BM25 · Hybrid | Hybrid combines vector and keyword search |
| Embedding model | `local-hash-ngrams`, `local-hash-words`, `sentence-transformers/…` | Neural models appear once `sentence-transformers` is installed |
| Chunking strategy | Recursive · Sentence · Fixed | Recursive keeps paragraphs together where possible |
| Chunk size / Overlap | 150-1500 / 0-300 characters | Overlap must be smaller than the chunk size |
| Top K | 1-15 | Number of chunks passed to the generator |
| Fusion *(hybrid only)* | RRF · Weighted | Weighted shows a slider for the vector weight |
| Second-stage reranking | Lexical cross-scorer · Claude (LLM) | Reranks a larger candidate pool before taking the top K |
| Answer generator | Local extractive · Claude | Claude needs `ANTHROPIC_API_KEY` |

**Run options**

| Field | Notes |
|---|---|
| Name | Optional; generated from the configuration if empty |
| Dataset | Any dataset registered under **Datasets** |
| Sample limit | Evaluate only the first N questions, useful for quick, cheap checks with Claude |
| Mark as regression baseline | Makes this run the reference for regression checks and the radar's dashed polygon |
| Answer evaluation | **Heuristic** (free, deterministic) or **LLM judge** (Claude grades each answer) |

Click **Start evaluation**. You are taken to the run page, which shows a live progress bar until the run finishes.

### Reading a run

![Run detail](docs/screenshots/run-detail.png)

- **Quality Index:** the run's composite score and its full configuration (including its MLflow run id when tracking is enabled).
- **Quality Metrics:** every retrieval metric (cyan) and answer metric (green).
- **Operational:** p50 / p95 / p99 latency, average retrieval and generation time, failure rate, tokens, throughput, and cost. Local runs show a cost *projected* at Claude pricing.
- **By Question Category:** metrics per category (factual, keyword, paraphrase, multi-hop …), showing which kinds of questions the configuration struggles with.
- **Recommendations:** suggested next steps for this run.
- **Per-question Results:** one row per question with colored score dots (green ≥ 0.8, amber ≥ 0.6, red below). Filter to **Rank misses** (relevant chunk not ranked first) or **Failed**.

Click a question to expand it:

![Question detail](docs/screenshots/question-detail.png)

The expanded row shows the generated and reference answers, every metric for that question, the trace waterfall (time spent in retrieval, rerank, generation and evaluation), and the retrieved chunks in rank order. A ✓ marks a chunk from a relevant document; ✗ marks a non-relevant chunk.

Page actions: **Compare** (opens Experiments with this run selected), **Mark as baseline**, and **Delete** (trash icon).

### Comparing experiments

Open **Experiments**.

![Experiments](docs/screenshots/experiments.png)

1. **Runs:** tick up to four completed runs. Each run gets a color that stays the same while you change the selection.
2. **Compare against (baseline):** choose the reference run. It is drawn dashed on the radar.
3. **Quality Overlay:** all selected runs on one radar; hover a vertex to see each run's value.
4. **Metric Comparison:** every metric per run with its delta against the baseline (green = better, red = worse). A 🏆 marks the best value in each row, and the overall winner is shown at the top right. Latency, tokens, projected cost and failure rate are listed below.
5. **Largest Disagreements:** questions where the runs differ most, a good place to start investigating.

#### Regression gate

![Regression gate](docs/screenshots/regression-gate.png)

Choose a **Candidate**, set the **Max drop** in points (2 = a 0.02 drop on 0-1 metrics, or 2 points on the quality index), then click **Run regression check**. The gate **fails** if any metric drops by more than the allowed amount, or if p95 latency rises by more than 50% (and by more than 10 ms). Every check is listed with its delta. The example above fails because sentence chunks lost context recall and were slower.

### Monitoring

![Monitoring](docs/screenshots/monitoring.png)

- **KPI tiles:** p50 / p95 / p99 latency, failure rate, total tokens, LLM cost (with projected cost) over the last 500 traced queries.
- **Latency Distribution:** histogram of end-to-end query latency.
- **Stage Breakdown:** average and p95 time per pipeline stage.
- **API Health:** uptime, HTTP request count, HTTP p95, 5xx errors and pipeline counters (also at `GET /metrics` in Prometheus format).
- **p95 Latency by Run** and **Recent Query Signal:** latency over runs and over individual queries.
- **Traces:** filter by *All / Errors / Playground*; click a trace to see its span waterfall and error message.

The page refreshes every 5 seconds.

### Playground

![Playground](docs/screenshots/playground.png)

Use the playground to debug a single question without running a full evaluation:

1. Set a configuration in the left panel (same fields as the evaluation form).
2. Type a question, or click one of the sample-question chips, then click **Ask**.
3. Read the **Answer** with its model, latency, tokens and cost, plus the **Trace** waterfall.
4. Inspect the **Retrieved Context**. If the question matches a labelled dataset question, each chunk is marked relevant (✓) or not (✗).

Playground queries are traced and appear under **Monitoring → Traces → Playground**.

### Datasets

![Datasets](docs/screenshots/datasets.png)

Pick a dataset on the left. **Questions** lists each question with its category, reference answer and relevant document ids; filter by category. **Documents** shows the full corpus.

### Settings

A read-only view of the backend: LLM providers and whether they are available, the judge and cost-projection models, MLflow / OpenTelemetry / Prometheus status, installed embedding models, metric definitions with their quality-index weights, and model pricing. To change anything, edit `backend/.env` and restart the backend.

---

## Typical workflow

1. **Explore:** open the **Dashboard** and the seeded experiments A-D.
2. **Establish a baseline:** run your current configuration, then **Mark as baseline**.
3. **Debug:** open the run, filter to **Rank misses**, and expand questions to see which chunks were retrieved.
4. **Try a fix:** in the **Playground**, test a change (hybrid retrieval, reranking, a different chunk size) on a failing question.
5. **Evaluate the change:** start a new evaluation with that configuration.
6. **Compare:** select both runs in **Experiments** and check the deltas and **Largest Disagreements**.
7. **Gate it:** run the **Regression gate**. Promote the candidate to baseline only if it passes.
8. **Watch production behavior** in **Monitoring** (latency, failures, cost).
9. **Measure generative quality:** once retrieval is solid, rerun with the **Claude** generator and the **LLM judge**.

---

## Adding your own dataset

A dataset is one JSON file: a document corpus plus questions labelled with the documents that contain their answers.

```json
{
  "name": "my_dataset",
  "description": "Internal HR policies",
  "documents": [
    { "id": "doc-leave", "title": "Leave Policy", "text": "Employees receive 25 days of annual leave...\n\nUnused leave..." }
  ],
  "samples": [
    {
      "id": "q01",
      "category": "factual",
      "question": "How many days of annual leave do employees get?",
      "reference_answer": "Employees receive 25 days of annual leave.",
      "relevant_doc_ids": ["doc-leave"]
    }
  ]
}
```

Rules: `name` is lowercase letters, digits, `-` or `_`. Document and sample ids must be unique, and every `relevant_doc_ids` entry must match a document id. Blank lines (`\n\n`) in a document separate paragraphs for recursive chunking.

Register it in either of two ways:

- **Copy the file** into `backend/evaluation/` (as `my_dataset.json`). It appears immediately.
- **Use the API:**

  ```bash
  curl -X POST http://localhost:8000/datasets -H "Content-Type: application/json" -d @my_dataset.json
  ```

The dataset then shows up on **Datasets** and in the **New evaluation** form.

---

## Metrics reference

| Metric | Group | Meaning |
|---|---|---|
| Context Precision | Retrieval | Rank-weighted precision: relevant chunks ranked higher score better (Ragas definition) |
| Context Recall | Retrieval | Share of reference-answer statements supported by the retrieved context |
| Precision@K | Retrieval | Share of the top K chunks that come from a relevant document |
| Recall@K | Retrieval | Share of relevant documents found in the top K chunks |
| MRR | Retrieval | 1 / rank of the first relevant chunk |
| nDCG@K | Retrieval | Ranking quality with position discount (binary relevance) |
| Hit Rate | Retrieval | Share of questions with at least one relevant chunk retrieved |
| Faithfulness | Answer | Share of answer statements supported by the retrieved context |
| Answer Relevancy | Answer | How directly the answer addresses the question |
| Answer Correctness | Answer | Agreement with the reference answer (0.75 × token F1 + 0.25 × similarity) |

**Quality Index (0-100)** = context precision 15% + context recall 20% + MRR 15% + faithfulness 20% + answer relevancy 10% + answer correctness 20%.

Retrieval metrics come from the dataset's relevance labels, so they are exact. Answer metrics use the selected judge: **heuristic** (deterministic token overlap: free and reproducible) or **LLM judge** (Claude grades claims and ratings through a validated structured-output schema, recommended for generative answers).

---

## Example results

The bundled benchmark (`backend/evaluation/sample_dataset.json`) is documentation for a fictional cloud storage product: 22 documents, including distractors such as a changelog with outdated values, and 26 labelled questions. Reproduce the numbers below with:

```bash
cd backend
python -m scripts.run_evaluation --compare-defaults
```

Setup: offline stack, `local-hash-ngrams` embeddings, recursive 500/50 chunks, top-k 5, heuristic judge.

| Configuration | Quality Index | Context Precision | Context Recall | Recall@K | MRR | nDCG@K | Answer Correctness |
|---|---|---|---|---|---|---|---|
| A - Vector search (baseline) | 82.16 | 0.876 | 0.962 | 0.962 | 0.904 | 0.807 | 0.492 |
| **B - Hybrid search** | **82.82** | **0.909** | 0.962 | 0.962 | **0.942** | **0.837** | 0.471 |
| C - Hybrid + lexical reranking | 82.48 | 0.899 | 0.962 | 0.962 | 0.942 | 0.832 | 0.459 |
| D - Hybrid + rerank, sentence chunks (300) | 80.84 | 0.855 | 0.923 | 0.962 | 0.923 | 0.793 | 0.472 |

- Hybrid search beats pure vector search on ranking (MRR +0.038), because BM25 recovers exact identifiers like `ERR-4090`.
- The lexical reranker did **not** help on this corpus, which is exactly what the platform is meant to catch before shipping.
- Smaller sentence chunks raise Precision@K but lose context recall, and they fail the regression gate.
- Faithfulness is 1.0 in every run because the extractive generator only copies context. Run with the Claude generator and LLM judge to measure generative answer quality.

---

## API reference

Interactive documentation: **http://localhost:8000/docs**

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/evaluations` | Start an evaluation run (`202`, runs in the background) |
| GET | `/evaluations` | List runs (`status`, `dataset`, `limit`, `offset`) |
| GET | `/evaluations/{run_id}` | Run details, status and progress |
| GET | `/evaluations/{run_id}/metrics` | Aggregate metrics, operational stats, per-category breakdown |
| GET | `/evaluations/{run_id}/results` | Per-question answers, retrieved chunks, scores |
| GET | `/evaluations/{run_id}/insights` | Recommendations |
| POST | `/evaluations/{run_id}/baseline` | Mark as regression baseline |
| DELETE | `/evaluations/{run_id}` | Delete a run |
| POST | `/experiments/compare` | Compare 2-8 runs against a baseline |
| POST | `/experiments/regression-check` | Pass/fail gate for a candidate run |
| POST | `/query` | Run one traced question (playground) |
| GET / POST | `/datasets`, `/datasets/{name}` | List, view, register datasets |
| GET | `/traces`, `/traces/{trace_id}` | Query traces and spans |
| GET | `/monitoring/summary` | Latency, failures, tokens, cost, stage timings |
| GET | `/dashboard/overview` | Aggregated dashboard data |
| GET | `/config` | Enabled providers, models, integrations, metric definitions |
| GET | `/metrics` | Prometheus metrics |
| GET | `/health` | Health check |

Example: start a run and read its metrics.

```bash
curl -X POST http://localhost:8000/evaluations \
  -H "Content-Type: application/json" \
  -d '{"dataset": "sample_dataset", "retrieval_method": "hybrid", "embedding_model": "local-hash-ngrams", "top_k": 5, "reranking_enabled": true}'
# {"run_id": "8be516cb...", "status": "queued", "message": "Evaluation submitted successfully"}

curl http://localhost:8000/evaluations/8be516cb.../metrics
```

Optional request fields: `name`, `chunking_strategy`, `chunk_size`, `chunk_overlap`, `fusion`, `hybrid_alpha`, `reranker`, `rerank_candidates`, `llm_provider`, `llm_model`, `judge`, `sample_limit`, `tags`, `set_as_baseline`.

---

## Testing and regression gates

```bash
cd backend
pytest -v
```

The 41 tests cover metric math, chunking, BM25, embeddings, rank fusion, the pipeline, evaluation, comparison, the regression logic, recommendations and the full API lifecycle. A quality-floor test fails if a change drops the default configuration below a quality index of 78.

Command-line gates:

```bash
# Offline: fail (exit code 1) if any default experiment drops below the quality floor
python -m scripts.run_evaluation --compare-defaults --min-quality 78

# Against a running API: evaluate a candidate config and gate it against the baseline run
python -m scripts.regression_check --config '{"retrieval_method": "hybrid", "reranking_enabled": true}' --max-drop 0.02
```

Frontend checks:

```bash
cd frontend
npm run lint
npx tsc --noEmit
npm run build
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above on every push and pull request.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Sidebar shows **API offline** / pages show "Could not load data" | Start the backend (`uvicorn app.main:app --reload` in `backend/`) and check http://localhost:8000/health. If the API runs on another host or port, set `BACKEND_URL` for the frontend and restart it |
| `python` opens the Microsoft Store on Windows | Use the Python launcher instead: `py -m venv .venv` (`py --list` shows installed versions) |
| `Activate.ps1 cannot be loaded because running scripts is disabled` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `.venv\Scripts\activate.bat` from cmd |
| `pip install` fails on numpy | Python 3.12+ is required; check `python --version` inside the venv |
| Port 8000 or 3000 is already in use | `uvicorn app.main:app --port 8001` and `BACKEND_URL=http://localhost:8001 npm run dev`, or `npm run dev -- -p 3001` |
| **Claude** / **LLM judge** options are greyed out | Set `ANTHROPIC_API_KEY` in `backend/.env` and restart the backend; **Settings** shows the provider as available |
| A run is stuck or shows "Interrupted by a server restart" | Runs execute inside the API process; restarting the API marks unfinished runs as failed. Start the run again |
| Dashboard is empty | Seeding only happens on an empty database. Start an evaluation, or stop the API, delete `backend/raglens.db` and restart it |
| Want a clean slate | Stop the API, delete `backend/raglens.db` (and `mlflow.db` if used), start it again |
| MLflow run id says "not tracked" | Set `MLFLOW_TRACKING_URI` in `backend/.env` and restart |

---

## Project structure

```text
raglens-ai/
├── backend/                         # FastAPI service
│   ├── app/
│   │   ├── main.py                  # app factory, lifespan, request metrics middleware
│   │   ├── api/                     # evaluations, experiments, datasets, playground,
│   │   │                            # monitoring, dashboard, system routes
│   │   ├── core/                    # settings, logging, text utilities
│   │   ├── rag/                     # chunking, embeddings, vector store, BM25,
│   │   │                            # reranker, LLM generators, pipeline, pricing
│   │   ├── evaluation/              # dataset schema, metrics, evaluator, Claude judge
│   │   ├── experiments/             # run orchestrator, MLflow, comparison, insights
│   │   ├── monitoring/              # tracing (+OpenTelemetry), metrics (+Prometheus)
│   │   ├── database/                # SQLAlchemy models and async session
│   │   └── schemas/                 # request / response models
│   ├── evaluation/                  # datasets (*.json)
│   ├── scripts/                     # run_evaluation.py, regression_check.py
│   ├── tests/
│   ├── .env.example
│   ├── Dockerfile
│   ├── requirements.txt
│   └── requirements-optional.txt
├── frontend/                        # Next.js dashboard
│   ├── src/app/                     # pages: dashboard, evaluations, experiments,
│   │                                # monitoring, playground, datasets, settings
│   ├── src/components/              # layout, UI primitives, SVG charts, config form
│   ├── src/lib/                     # typed API client, formatters, hooks
│   ├── next.config.ts               # /api/* → backend proxy
│   └── Dockerfile
├── docs/
│   ├── RAGLens-AI-Technical-Design-Document.pdf   # detailed technical design document
│   ├── technical-design.md          # editable source of the PDF
│   ├── architecture.md              # architecture overview and request lifecycle
│   └── screenshots/
├── .github/workflows/ci.yml
├── docker-compose.yml
├── .gitignore
└── README.md
```

For the full design, see the [Technical Design Document (PDF)](docs/RAGLens-AI-Technical-Design-Document.pdf); [docs/architecture.md](docs/architecture.md) is a shorter overview.

---

## Limitations

- The default local embedders use feature hashing. They are fast, deterministic baselines but lexical in nature. Install `sentence-transformers` to evaluate a neural embedding model.
- Heuristic answer metrics measure lexical overlap. They are reproducible but under-reward correct paraphrases; use the LLM judge for generative answers.
- Metric definitions follow Ragas, but the `ragas` package itself is not used.
- Evaluations run as in-process background tasks. A production deployment would move them to a job queue.
- There is no authentication; run it locally or behind your own access control.

## Future improvements

- Scheduled evaluation against a fixed benchmark dataset
- Query rewriting and cross-encoder reranking experiments
- Regression alerts delivered to Slack or email
- Multi-user experiment management with authentication and role-based access control
- Dataset generation from production traces

---

## Author

**Suriya**

Software Engineer | AI Engineering Enthusiast

Interested in building reliable AI applications, RAG systems, scalable APIs, and production-ready LLM solutions.
