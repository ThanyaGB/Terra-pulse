"""Base class for the six agents. They talk only through the bus (ADR-01) and are idempotent on event_id."""
from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Any

from .bus import Bus
from .events import Event
from .idempotency import IdempotencyStore, MemoryIdempotency
from .outbox import SqliteOutbox

_TRACE: dict[str, str] = {}


class TraceAdapter(logging.LoggerAdapter):  # type: ignore[type-arg]
    def process(self, msg: str, kwargs: Any) -> tuple[str, Any]:
        extra = kwargs.setdefault("extra", {})
        extra.setdefault("trace_id", _TRACE.get("current", "-"))
        extra.setdefault("agent", self.extra["agent"] if self.extra else "-")
        return msg, kwargs


class BaseAgent(ABC):
    name: str = "agent"
    subscribes: tuple[str, ...] = ()

    def __init__(self, bus: Bus, idempotency: IdempotencyStore | None = None, outbox: SqliteOutbox | None = None) -> None:
        self.bus = bus
        self.idem = idempotency or MemoryIdempotency()
        self.outbox = outbox
        self.log = TraceAdapter(logging.getLogger(f"agent.{self.name}"), {"agent": self.name})
        self.started_at = time.time()
        self.events_processed = 0
        self.duplicates_skipped = 0
        self.errors = 0
        self.last_event_at: float | None = None
        self.last_latency_ms = 0.0
        if self.subscribes:
            bus.subscribe(self.name, list(self.subscribes), self._dispatch)

    async def _dispatch(self, event: Event) -> None:
        key = f"{self.name}:{event.event_id}"
        if self.idem.seen(key):
            self.duplicates_skipped += 1
            return
        _TRACE["current"] = event.trace_id
        t0 = time.perf_counter()
        try:
            await self.handle(event)
        except Exception:
            self.errors += 1
            raise
        finally:
            _TRACE.pop("current", None)
        self.idem.mark(key)  # only after success, so a crash mid-handler is redelivered and completes
        self.events_processed += 1
        self.last_event_at = time.time()
        self.last_latency_ms = (time.perf_counter() - t0) * 1000

    async def emit(self, event: Event) -> None:
        if self.outbox is not None:
            self.outbox.add(event)
        await self.bus.publish(event)
        if self.outbox is not None:
            self.outbox.mark_published(event.event_id)

    @abstractmethod
    async def handle(self, event: Event) -> None: ...

    def health(self) -> dict[str, Any]:
        degraded = self.errors > 0 and self.events_processed == 0
        return {
            "agent": self.name,
            "status": "down" if degraded else "ok",
            "uptime_s": round(time.time() - self.started_at, 1),
            "events_processed": self.events_processed,
            "duplicates_skipped": self.duplicates_skipped,
            "errors": self.errors,
            "last_latency_ms": round(self.last_latency_ms, 2),
        }
