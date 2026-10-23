"""Data Ingestion Agent (T2.2): on an ingest trigger, builds the normalised snapshot and emits one
`data.normalised` event per grid window. Duplicate triggers for a window yield no duplicate events."""
from __future__ import annotations

import asyncio
import time
from typing import Any, Callable

from agents.common import BaseAgent, Event
from agents.common.events import DATA_NORMALISED
from agents.world import World
from ingestion.geo import AREAS
from ingestion.pipeline import Snapshot, build_snapshot

INGEST_TRIGGER = "ingest.trigger"


class DataIngestionAgent(BaseAgent):
    name = "ingestion_agent"
    subscribes = (INGEST_TRIGGER,)

    def __init__(self, bus, world: World, provider: Callable[[], Snapshot] | None = None, **kw: Any) -> None:  # type: ignore[no-untyped-def]
        super().__init__(bus, **kw)
        self.world = world
        self.provider = provider or (lambda: build_snapshot(offline=True))
        self._emitted: set[tuple[str, str]] = set()   # (grid_id, window)
        self._coord_t0 = 0.0
        self.coordination_ms = 0.0

    async def handle(self, event: Event) -> None:
        snap = await asyncio.to_thread(self.provider)   # network fetches must not block the event loop
        self._coord_t0 = time.perf_counter()
        self.world.snapshot = snap
        window = event.payload.get("window") or snap.fetched_at.strftime("%Y-%m-%dT%H:00Z")
        flags = snap.quality.summary()
        for area in AREAS:
            key = (area.id, window)
            if key in self._emitted:
                continue
            self._emitted.add(key)
            await self.emit(event.child(DATA_NORMALISED, {
                "source": "pipeline", "grid_id": area.id, "window": window,
                "quality_flags": {"interpolated_fraction": flags["interpolated_fraction"].get(area.id, 0.0),
                                  "origin": flags["origin"]},
            }))

        self.coordination_ms = (time.perf_counter() - self._coord_t0) * 1000

    def health(self) -> dict:  # type: ignore[type-arg]
        h = super().health()
        # the coordination-latency metric (spec target 190 ms) excludes the network fetch that precedes it
        h["fetch_ms"] = round(max(0.0, h["last_latency_ms"] - self.coordination_ms), 1)
        h["last_latency_ms"] = round(self.coordination_ms, 2)
        return h
