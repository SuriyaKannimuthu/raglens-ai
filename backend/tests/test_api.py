import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.database.session import init_db
from app.main import app


@pytest.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _wait_for_completion(client: AsyncClient, run_id: str, timeout: float = 60) -> dict:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        run = (await client.get(f"/evaluations/{run_id}")).json()
        if run["status"] in ("completed", "failed"):
            return run
        await asyncio.sleep(0.1)
    raise TimeoutError(run_id)


async def _start(client: AsyncClient, **payload) -> str:
    response = await client.post("/evaluations", json={"dataset": "sample_dataset", **payload})
    assert response.status_code == 202, response.text
    body = response.json()
    assert body["status"] == "queued"
    return body["run_id"]


async def test_health_and_config(client):
    health = (await client.get("/health")).json()
    assert health["status"] == "ok"
    config = (await client.get("/config")).json()
    assert config["llm"]["default_provider"] == "local"
    assert any(m["key"] == "faithfulness" for m in config["metrics"])


async def test_datasets(client):
    datasets = (await client.get("/datasets")).json()
    assert any(d["name"] == "sample_dataset" for d in datasets)
    assert (await client.get("/datasets/does-not-exist")).status_code == 404


async def test_upload_dataset_validation(client):
    bad = {"name": "Bad Name!", "documents": [{"id": "a", "title": "A", "text": "x"}],
           "samples": [{"id": "q", "question": "what?", "reference_answer": "x", "relevant_doc_ids": ["a"]}]}
    assert (await client.post("/datasets", json=bad)).status_code == 422


async def test_evaluation_lifecycle(client):
    run_id = await _start(client, retrieval_method="hybrid", reranking_enabled=True, top_k=5,
                          embedding_model="local-hash-ngrams", sample_limit=8, name="api-test")
    run = await _wait_for_completion(client, run_id)
    assert run["status"] == "completed", run["error"]
    assert run["completed_samples"] == 8
    assert 0 <= run["metrics"]["quality_index"] <= 100
    assert run["operational"]["latency_ms"]["p95"] is not None
    assert run["operational"]["tokens"]["estimated"] is True

    metrics = (await client.get(f"/evaluations/{run_id}/metrics")).json()
    assert metrics["by_category"]

    results = (await client.get(f"/evaluations/{run_id}/results")).json()
    assert len(results) == 8
    assert results[0]["retrieved"][0]["rank"] == 1
    assert results[0]["trace_id"]

    trace = (await client.get(f"/traces/{results[0]['trace_id']}")).json()
    assert {s["name"] for s in trace["spans"]} >= {"retrieval", "rerank", "generation", "evaluation"}

    insights = (await client.get(f"/evaluations/{run_id}/insights")).json()
    assert insights["recommendations"]

    listing = (await client.get("/evaluations", params={"status": "completed"})).json()
    assert any(item["id"] == run_id for item in listing["items"])


async def test_compare_and_regression_check(client):
    base_id = await _start(client, retrieval_method="vector", sample_limit=6)
    cand_id = await _start(client, retrieval_method="hybrid", sample_limit=6)
    await _wait_for_completion(client, base_id)
    await _wait_for_completion(client, cand_id)

    comparison = (await client.post("/experiments/compare", json={"run_ids": [base_id, cand_id]})).json()
    assert comparison["baseline_run_id"] == base_id
    assert len(comparison["runs"]) == 2
    assert comparison["winner_run_id"] in (base_id, cand_id)

    assert (await client.post(f"/evaluations/{base_id}/baseline")).json()["is_baseline"] is True
    report = (await client.post("/experiments/regression-check",
                                json={"candidate_run_id": cand_id, "default_max_drop": 1.0})).json()
    assert report["baseline_run_id"] == base_id
    assert report["passed"] is True

    overview = (await client.get("/dashboard/overview")).json()
    assert overview["counts"]["completed"] >= 2
    assert overview["radar"]["focus"] is not None

    summary = (await client.get("/monitoring/summary")).json()
    assert summary["latency_ms"]["p50"] is not None
    assert "retrieval" in summary["stages"]

    prom = await client.get("/metrics")
    assert "raglens_pipeline_queries_total" in prom.text


async def test_validation_errors(client):
    assert (await client.post("/evaluations", json={"dataset": "nope"})).status_code == 404
    assert (await client.post("/evaluations", json={"top_k": 0})).status_code == 422
    # Claude features are rejected cleanly when no API key is configured.
    response = await client.post("/evaluations", json={"judge": "llm"})
    assert response.status_code == 422
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]
    assert (await client.get("/evaluations/missing")).status_code == 404
    compare = await client.post("/experiments/compare", json={"run_ids": ["missing-a", "missing-b"]})
    assert compare.status_code == 404


async def test_playground_query(client):
    response = await client.post("/query", json={"question": "What does error ERR-4012 mean?",
                                                 "retrieval_method": "hybrid"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert "expired" in body["answer"]
    assert body["retrieved"][0]["relevant"] is True
    assert body["trace"]["source"] == "playground"
