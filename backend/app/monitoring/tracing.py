"""Request tracing.

Every RAG query produces a :class:`Trace` made of timed spans (retrieval, rerank,
generation, evaluation). Traces are persisted to the database for the dashboard and, when
``OTEL_ENABLED=true`` and the OpenTelemetry SDK is installed, mirrored as OpenTelemetry
spans so they can be exported to any OTLP backend (Jaeger, Grafana Tempo, Langfuse, ...).
"""

import logging
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

from app.core.config import Settings

logger = logging.getLogger(__name__)

_otel_tracer: Any = None


def setup_opentelemetry(settings: Settings) -> bool:
    """Configure an OpenTelemetry tracer provider. Returns True when tracing is active."""
    global _otel_tracer
    if not settings.otel_enabled:
        return False
    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    except ImportError:
        logger.warning("OTEL_ENABLED is set but opentelemetry-sdk is not installed")
        return False

    provider = TracerProvider(resource=Resource.create({"service.name": settings.otel_service_name}))
    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        exporter = OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint)
    else:
        exporter = ConsoleSpanExporter()
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _otel_tracer = trace.get_tracer("raglens")
    logger.info("OpenTelemetry tracing enabled")
    return True


def otel_active() -> bool:
    return _otel_tracer is not None


@dataclass
class Span:
    name: str
    start_ms: float
    duration_ms: float = 0.0
    status: str = "ok"
    error: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)

    def set(self, **attributes: Any) -> None:
        self.attributes.update(attributes)


class Trace:
    def __init__(self, name: str, **attributes: Any) -> None:
        self.id = uuid.uuid4().hex
        self.name = name
        self.attributes = attributes
        self.spans: list[Span] = []
        self._t0 = time.perf_counter()
        self.duration_ms = 0.0
        self.status = "ok"
        self.error: str | None = None

    @contextmanager
    def span(self, name: str, **attributes: Any) -> Iterator[Span]:
        start = time.perf_counter()
        span = Span(name=name, start_ms=(start - self._t0) * 1000, attributes=dict(attributes))
        otel_cm = _otel_tracer.start_as_current_span(f"{self.name}.{name}") if _otel_tracer else None
        otel_span = otel_cm.__enter__() if otel_cm else None
        try:
            yield span
        except Exception as exc:
            span.status, span.error = "error", str(exc)
            raise
        finally:
            span.duration_ms = (time.perf_counter() - start) * 1000
            self.spans.append(span)
            if otel_cm:
                for key, value in span.attributes.items():
                    if isinstance(value, (str, int, float, bool)):
                        otel_span.set_attribute(f"raglens.{key}", value)
                otel_span.set_attribute("raglens.trace_id", self.id)
                otel_cm.__exit__(None, None, None)

    def span_duration(self, name: str) -> float:
        return sum(s.duration_ms for s in self.spans if s.name == name)

    def finish(self, status: str = "ok", error: str | None = None) -> float:
        self.duration_ms = (time.perf_counter() - self._t0) * 1000
        self.status, self.error = status, error
        return self.duration_ms

    def spans_as_dicts(self) -> list[dict[str, Any]]:
        return [
            {
                "name": s.name,
                "start_ms": round(s.start_ms, 3),
                "duration_ms": round(s.duration_ms, 3),
                "status": s.status,
                "error": s.error,
                "attributes": s.attributes,
            }
            for s in self.spans
        ]
