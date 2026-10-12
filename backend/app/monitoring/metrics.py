"""In-process operational metrics (HTTP and pipeline), exposed as JSON and in the
Prometheus text exposition format at ``/metrics``."""

import threading
import time
from collections import defaultdict, deque

from app.evaluation.metrics import percentile

_LATENCY_BUCKETS_MS = (5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000)


class MetricsRegistry:
    def __init__(self, window: int = 2000) -> None:
        self._lock = threading.Lock()
        self.started_at = time.time()
        self.http_requests: dict[tuple[str, str, int], int] = defaultdict(int)
        self.http_latency: deque[float] = deque(maxlen=window)
        self.http_buckets: dict[float, int] = defaultdict(int)
        self.http_latency_sum = 0.0
        self.http_latency_count = 0
        self.pipeline_queries = 0
        self.pipeline_failures = 0
        self.pipeline_latency: deque[float] = deque(maxlen=window)
        self.tokens_input = 0
        self.tokens_output = 0
        self.cost_usd = 0.0

    def record_http(self, method: str, route: str, status: int, latency_ms: float) -> None:
        with self._lock:
            self.http_requests[(method, route, status)] += 1
            self.http_latency.append(latency_ms)
            self.http_latency_sum += latency_ms
            self.http_latency_count += 1
            for bucket in _LATENCY_BUCKETS_MS:
                if latency_ms <= bucket:
                    self.http_buckets[bucket] += 1

    def record_query(self, latency_ms: float, ok: bool, input_tokens: int, output_tokens: int, cost: float) -> None:
        with self._lock:
            self.pipeline_queries += 1
            if not ok:
                self.pipeline_failures += 1
            self.pipeline_latency.append(latency_ms)
            self.tokens_input += input_tokens
            self.tokens_output += output_tokens
            self.cost_usd += cost

    def snapshot(self) -> dict:
        with self._lock:
            http_lat, pipe_lat = list(self.http_latency), list(self.pipeline_latency)
            total_http = sum(self.http_requests.values())
            errors = sum(c for (_, _, s), c in self.http_requests.items() if s >= 500)
            return {
                "uptime_seconds": round(time.time() - self.started_at, 1),
                "http": {
                    "requests_total": total_http,
                    "server_errors_total": errors,
                    "latency_ms": _latency_summary(http_lat),
                },
                "pipeline": {
                    "queries_total": self.pipeline_queries,
                    "failures_total": self.pipeline_failures,
                    "failure_rate": (self.pipeline_failures / self.pipeline_queries) if self.pipeline_queries else 0.0,
                    "latency_ms": _latency_summary(pipe_lat),
                    "input_tokens_total": self.tokens_input,
                    "output_tokens_total": self.tokens_output,
                    "estimated_cost_usd_total": round(self.cost_usd, 6),
                },
            }

    def prometheus(self) -> str:
        lines = [
            "# HELP raglens_http_requests_total HTTP requests by method, route and status.",
            "# TYPE raglens_http_requests_total counter",
        ]
        with self._lock:
            for (method, route, status), count in sorted(self.http_requests.items()):
                lines.append(f'raglens_http_requests_total{{method="{method}",route="{route}",status="{status}"}} {count}')
            lines += ["# HELP raglens_http_request_duration_ms HTTP request latency.",
                      "# TYPE raglens_http_request_duration_ms histogram"]
            for bucket in _LATENCY_BUCKETS_MS:
                lines.append(f'raglens_http_request_duration_ms_bucket{{le="{bucket}"}} {self.http_buckets[bucket]}')
            lines.append(f'raglens_http_request_duration_ms_bucket{{le="+Inf"}} {self.http_latency_count}')
            lines.append(f"raglens_http_request_duration_ms_sum {self.http_latency_sum:.3f}")
            lines.append(f"raglens_http_request_duration_ms_count {self.http_latency_count}")
            lines += [
                "# TYPE raglens_pipeline_queries_total counter",
                f"raglens_pipeline_queries_total {self.pipeline_queries}",
                "# TYPE raglens_pipeline_failures_total counter",
                f"raglens_pipeline_failures_total {self.pipeline_failures}",
                "# TYPE raglens_llm_tokens_total counter",
                f'raglens_llm_tokens_total{{direction="input"}} {self.tokens_input}',
                f'raglens_llm_tokens_total{{direction="output"}} {self.tokens_output}',
                "# TYPE raglens_llm_estimated_cost_usd_total counter",
                f"raglens_llm_estimated_cost_usd_total {self.cost_usd:.6f}",
            ]
        return "\n".join(lines) + "\n"


def _latency_summary(values: list[float]) -> dict:
    return {
        "count": len(values),
        "avg": round(sum(values) / len(values), 3) if values else None,
        "p50": _r(percentile(values, 50)),
        "p95": _r(percentile(values, 95)),
        "p99": _r(percentile(values, 99)),
    }


def _r(value: float | None) -> float | None:
    return round(value, 3) if value is not None else None


registry = MetricsRegistry()
