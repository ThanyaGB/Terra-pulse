"""Event bus (ADR-02). InMemoryBus for tests/dev, RedisStreamsBus for deployments.

Both give consumer-group semantics: a message is acknowledged only after the handler succeeds; an unacknowledged
message is redelivered (so a crash mid-handler is retried). Handlers must therefore be idempotent on event_id.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any, Awaitable, Callable, Protocol

from .events import Event

log = logging.getLogger("bus")
Handler = Callable[[Event], Awaitable[None]]


class Bus(Protocol):
    async def publish(self, event: Event) -> None: ...
    def subscribe(self, group: str, types: list[str], handler: Handler) -> None: ...
    async def drain(self, max_rounds: int = 20) -> None: ...


class InMemoryBus:
    def __init__(self) -> None:
        self._subs: dict[str, list[tuple[str, set[str], Handler]]] = defaultdict(list)
        self._pending: dict[str, list[Event]] = defaultdict(list)   # group -> unacknowledged events
        self._groups: list[tuple[str, set[str], Handler]] = []
        self.published: list[Event] = []
        self.taps: list[Callable[[Event], None]] = []

    def subscribe(self, group: str, types: list[str], handler: Handler) -> None:
        self._groups.append((group, set(types), handler))

    async def publish(self, event: Event) -> None:
        self.published.append(event)
        for tap in self.taps:
            tap(event)
        for group, types, _ in self._groups:
            if event.type in types:
                self._pending[group].append(event)

    async def drain(self, max_rounds: int = 20) -> None:
        """Deliver until quiet. Events whose handler raised stay pending and are retried on the next drain."""
        for _ in range(max_rounds):
            progressed = False
            for group, types, handler in self._groups:
                batch, self._pending[group] = self._pending[group], []
                for ev in batch:
                    if ev.type not in types:
                        continue
                    try:
                        await handler(ev)
                        progressed = True
                    except Exception:  # noqa: BLE001 - redeliver on the next drain
                        log.exception("handler failed, will redeliver", extra={"group": group, "event": ev.event_id})
                        self._pending[group].append(ev)
            if not progressed:
                return
            await asyncio.sleep(0)

    def pending_count(self) -> int:
        return sum(len(v) for v in self._pending.values())


class RedisStreamsBus:
    """Redis Streams: one stream per event type, one consumer group per agent."""

    def __init__(self, url: str, consumer: str = "worker-1", prefix: str = "vayu:events:") -> None:
        import redis.asyncio as aioredis

        self.r = aioredis.from_url(url, decode_responses=True)
        self.consumer = consumer
        self.prefix = prefix
        self._subs: list[tuple[str, list[str], Handler]] = []

    def subscribe(self, group: str, types: list[str], handler: Handler) -> None:
        self._subs.append((group, types, handler))

    async def publish(self, event: Event) -> None:
        await self.r.xadd(self.prefix + event.type, {"data": event.model_dump_json()})

    async def _ensure_groups(self) -> None:
        for group, types, _ in self._subs:
            for t in types:
                try:
                    await self.r.xgroup_create(self.prefix + t, group, id="0", mkstream=True)
                except Exception as exc:  # noqa: BLE001 - BUSYGROUP means it already exists
                    if "BUSYGROUP" not in str(exc):
                        raise

    async def drain(self, max_rounds: int = 20) -> None:
        await self._ensure_groups()
        for _ in range(max_rounds):
            handled = 0
            for group, types, handler in self._subs:
                streams = {self.prefix + t: ">" for t in types}
                # pending (delivered, never acked) first, then new messages
                for start in ("0", ">"):
                    res: Any = await self.r.xreadgroup(group, self.consumer, {k: start for k in streams}, count=100)
                    for stream, msgs in res:
                        for msg_id, fields in msgs:
                            ev = Event.model_validate_json(fields["data"])
                            try:
                                await handler(ev)
                                await self.r.xack(stream, group, msg_id)
                                handled += 1
                            except Exception:  # noqa: BLE001
                                log.exception("handler failed, left pending")
            if not handled:
                return

    async def close(self) -> None:
        await self.r.aclose()
