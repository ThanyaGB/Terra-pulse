"""CPCB CAAQMS connector via the data.gov.in open API (real-time AQI by station). It needs a free API key
(DATA_GOV_IN_KEY); without one this connector reports 'unavailable' and the pipeline uses the modelled CAMS series
from Open-Meteo instead. Resource id is configurable because data.gov.in occasionally republishes it."""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from domain.data_sources import SourceRegistry, default_registry

URL = "https://api.data.gov.in/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69"


@dataclass(frozen=True)
class StationReading:
    station: str
    city: str
    pollutant: str
    avg: float | None
    last_update: str


def parse(payload: dict[str, object]) -> list[StationReading]:
    out: list[StationReading] = []
    for r in payload.get("records", []):  # type: ignore[attr-defined]
        try:
            avg = None if r.get("avg_value") in (None, "NA", "") else float(r["avg_value"])
            out.append(StationReading(r["station"], r["city"], r["pollutant_id"], avg, r["last_update"]))
        except (KeyError, ValueError):
            continue
    return out


def fetch(api_key: str | None, states: tuple[str, ...] = ("Delhi", "Punjab", "Haryana"),
          client: httpx.Client | None = None, registry: SourceRegistry | None = None) -> list[StationReading] | None:
    (registry or default_registry()).require("cpcb")   # ADR-20
    if not api_key:
        return None
    readings: list[StationReading] = []
    for state in states:
        r = (client or httpx).get(URL, params={"api-key": api_key, "format": "json", "limit": 500, "filters[state]": state}, timeout=40)
        r.raise_for_status()
        readings.extend(parse(r.json()))
    return readings
