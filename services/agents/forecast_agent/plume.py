"""72 h plume projection (T2.4). NOAA HYSPLIT is a native binary; when it is not installed this wrapper runs a
simple forward Lagrangian advection of the plume centroid with real hourly winds (Open-Meteo NWP, 100 m level),
then derives arrival time per street segment. Same output contract as a HYSPLIT run."""
from __future__ import annotations

import shutil
from dataclasses import dataclass
from typing import Any

from ingestion.geo import AREAS, SANGRUR, Place, haversine_km, move
from ingestion.openmeteo import Series

HORIZON_H = 72
NCR_CENTRE = (28.65, 77.2)


@dataclass(frozen=True)
class Step:
    hour: int
    lat: float
    lon: float


def hysplit_available() -> bool:
    return shutil.which("hycs_std") is not None


def trajectory(wind: Series, start_idx: int, origin: Place = SANGRUR, hours: int = HORIZON_H) -> list[Step]:
    """Forward trajectory: each hour the centroid moves with the local wind (direction is where wind blows FROM)."""
    lat, lon = origin.lat, origin.lon
    steps = [Step(0, lat, lon)]
    for h in range(1, hours + 1):
        i = min(start_idx + h - 1, len(wind.times) - 1)
        speed = wind.at("wind_speed_100m", i) or wind.at("wind_speed_10m", i) or 0.0
        frm = wind.at("wind_direction_100m", i)
        if frm is None:
            frm = wind.at("wind_direction_10m", i) or 0.0
        lat, lon = move(lat, lon, (frm + 180) % 360, speed)   # km/h x 1 h = km
        steps.append(Step(h, lat, lon))
    return steps


def plume_radius_km(hour: int) -> float:
    """The plume spreads as it travels: 15 km at release growing 0.5 km/h (matches the broad corridor width)."""
    return 15 + 0.5 * hour


def arrival_hour(steps: list[Step], lat: float, lon: float) -> int | None:
    for s in steps:
        if haversine_km(lat, lon, s.lat, s.lon) <= plume_radius_km(s.hour):
            return s.hour
    return None


def street_impacts(steps: list[Step], baseline: dict[str, float], source_strength: float) -> list[dict[str, Any]]:
    """source_strength: PM2.5 ug/m3 the plume adds at its core (scaled by upwind fire activity)."""
    out = []
    for a in AREAS:
        eta = arrival_hour(steps, a.lat, a.lon)
        base = baseline.get(a.id, 60.0)
        reached = eta is not None
        dist = min(haversine_km(a.lat, a.lon, s.lat, s.lon) for s in steps)
        falloff = max(0.15, 1 - dist / 120)
        out.append({"id": a.id, "name": a.name, "lat": a.lat, "lng": a.lon, "etaHours": eta if reached else HORIZON_H,
                    "reached": reached, "peakPm25": round(base + source_strength * falloff * (1.0 if reached else 0.3)),
                    "hoursToPeak": 6 if reached else 0, "baselinePm25": round(base)})
    return out


def hours_to_reach_ncr(steps: list[Step]) -> int | None:
    return arrival_hour(steps, *NCR_CENTRE)
