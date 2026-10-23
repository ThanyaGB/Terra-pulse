"""Data quality metrics for the pipeline health monitor (spec 6.3)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

# max acceptable age before a source is "degraded" / "down" (minutes), from the ingestion cadences in spec 6.1
SLA_MIN = {"firms": 30, "cpcb": 30, "weather": 120, "sentinel2": 8 * 24 * 60, "crm": 15, "iot": 15}


@dataclass
class QualityTracker:
    last_ok: dict[str, datetime] = field(default_factory=dict)
    last_source: dict[str, str] = field(default_factory=dict)       # live | fixture | simulated
    stations: dict[str, bool] = field(default_factory=dict)         # station id -> online
    drift_flags: dict[str, bool] = field(default_factory=dict)
    interpolated_fraction: dict[str, float] = field(default_factory=dict)  # grid cell -> fraction

    def record(self, source: str, origin: str, when: datetime | None = None) -> None:
        self.last_ok[source] = when or datetime.now(timezone.utc)
        self.last_source[source] = origin

    def freshness_min(self, source: str, now: datetime | None = None) -> float | None:
        ts = self.last_ok.get(source)
        return None if ts is None else ((now or datetime.now(timezone.utc)) - ts).total_seconds() / 60

    def status(self, source: str, now: datetime | None = None) -> str:
        age = self.freshness_min(source, now)
        if age is None:
            return "down"
        sla = SLA_MIN.get(source, 60)
        return "ok" if age <= sla else "degraded" if age <= 3 * sla else "down"

    def summary(self, now: datetime | None = None) -> dict[str, Any]:
        online = sum(1 for v in self.stations.values() if v)
        return {
            "freshness_min": {s: round(m, 1) for s in self.last_ok if (m := self.freshness_min(s, now)) is not None},
            "status": {s: self.status(s, now) for s in SLA_MIN if s in self.last_ok},
            "origin": dict(self.last_source),
            "stations": {"online": online, "total": len(self.stations)},
            "drift_flagged": sorted(k for k, v in self.drift_flags.items() if v),
            "interpolated_fraction": dict(self.interpolated_fraction),
        }
