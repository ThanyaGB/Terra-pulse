"""Wires the six agents onto one bus. In production each agent is its own deployment on a Redis bus; in dev and in the
API process they share an in-memory bus so the whole platform runs from one command."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from agents.advisory_agent import FarmerAdvisoryAgent
from agents.common import BaseAgent, Bus, Event, InMemoryBus, SqliteOutbox
from agents.forecast_agent import ForecastAttributionAgent
from agents.health_agent import HealthAdvisoryAgent
from agents.ingestion_agent import INGEST_TRIGGER, DataIngestionAgent
from agents.municipal_agent import MunicipalActionAgent
from agents.risk_agent import StubbleRiskAgent
from agents.world import World
from api.audit import AuditLog
from api.directives import DirectiveService
from ingestion.pipeline import Snapshot


@dataclass
class Platform:
    bus: Bus
    world: World
    audit: AuditLog
    directives: DirectiveService
    outbox: SqliteOutbox
    ingestion: DataIngestionAgent
    risk: StubbleRiskAgent
    forecast: ForecastAttributionAgent
    advisory: FarmerAdvisoryAgent
    health: HealthAdvisoryAgent
    municipal: MunicipalActionAgent

    @property
    def agents(self) -> list[BaseAgent]:
        return [self.ingestion, self.risk, self.forecast, self.advisory, self.health, self.municipal]

    def health_report(self) -> list[dict[str, Any]]:
        return [a.health() for a in self.agents]

    async def run_cycle(self, window: str | None = None) -> None:
        """One ingest -> risk/forecast -> advisory/health/municipal pass."""
        payload = {"window": window} if window else {}
        await self.bus.publish(Event(type=INGEST_TRIGGER, payload=payload))
        await self.bus.drain()


def build_platform(provider: Callable[[], Snapshot] | None = None, bus: Bus | None = None, world: World | None = None,
                   audit: AuditLog | None = None, directives: DirectiveService | None = None, force_risk: bool = True,
                   outbox_path: str = ":memory:") -> Platform:
    bus = bus or InMemoryBus()
    world = world or World()
    audit = audit or AuditLog()
    directives = directives or DirectiveService(audit)
    outbox = SqliteOutbox(outbox_path)
    return Platform(
        bus, world, audit, directives, outbox,
        ingestion=DataIngestionAgent(bus, world, provider, outbox=outbox),
        risk=StubbleRiskAgent(bus, world, force=force_risk, outbox=outbox),
        forecast=ForecastAttributionAgent(bus, world, outbox=outbox),
        advisory=FarmerAdvisoryAgent(bus, world, outbox=outbox),
        health=HealthAdvisoryAgent(bus, world, outbox=outbox),
        municipal=MunicipalActionAgent(bus, world, directives, outbox=outbox),
    )
