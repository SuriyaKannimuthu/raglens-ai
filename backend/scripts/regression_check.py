"""CI regression gate against a running RAGLens API.

Starts an evaluation with the given configuration, waits for it to finish, and checks it
against the baseline run. Exits 1 when any metric regresses beyond its threshold.

    python -m scripts.regression_check --api http://localhost:8000 \
        --config '{"retrieval_method": "hybrid", "reranking_enabled": true}' --max-drop 0.02
"""

import argparse
import json
import sys
import time

import httpx


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default="http://localhost:8000")
    parser.add_argument("--dataset", default="sample_dataset")
    parser.add_argument("--config", default="{}", help="JSON pipeline configuration for the candidate run")
    parser.add_argument("--baseline-run-id", help="Defaults to the run marked as baseline")
    parser.add_argument("--max-drop", type=float, default=0.02, help="Allowed absolute drop per metric (0-1)")
    parser.add_argument("--timeout", type=float, default=900)
    args = parser.parse_args()

    with httpx.Client(base_url=args.api, timeout=30) as client:
        payload = {"dataset": args.dataset, "name": "CI regression candidate",
                   "tags": {"source": "ci"}, **json.loads(args.config)}
        response = client.post("/evaluations", json=payload)
        response.raise_for_status()
        run_id = response.json()["run_id"]
        print(f"Started candidate run {run_id}")

        deadline = time.monotonic() + args.timeout
        while True:
            run = client.get(f"/evaluations/{run_id}").json()
            if run["status"] in ("completed", "failed"):
                break
            if time.monotonic() > deadline:
                print("Timed out waiting for the evaluation", file=sys.stderr)
                return 2
            time.sleep(2)
        if run["status"] == "failed":
            print(f"Candidate run failed: {run['error']}", file=sys.stderr)
            return 2

        report = client.post("/experiments/regression-check", json={
            "candidate_run_id": run_id,
            "baseline_run_id": args.baseline_run_id,
            "default_max_drop": args.max_drop,
        })
        report.raise_for_status()
        result = report.json()

    for check in result["checks"]:
        mark = "PASS" if check["passed"] else "FAIL"
        print(f"[{mark}] {check['metric']:<20} baseline={check['baseline']:<10.4g} "
              f"candidate={check['candidate']:<10.4g} delta={check['delta']:+.4f}")
    print("Regression check", "PASSED" if result["passed"] else f"FAILED: {', '.join(result['regressions'])}")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
