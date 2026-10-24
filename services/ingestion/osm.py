"""OpenStreetMap covariates for kriging with external drift (ADR-16): road density and built-up fraction. The monthly OSM
extract job (T1.4) is not built yet, so this reads a recorded file. That file is currently a PLACEHOLDER (see its
`provenance` field), so `is_placeholder()` is True and forecasts carry `osm_covariates: placeholder` in their quality flags."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from domain.data_sources import SourceRegistry, default_registry

from .geo import haversine_km

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "integration" / "fixtures" / "osm_covariates.json"
KEYS = ("road_density_km_per_km2", "builtup_fraction")


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf8"))
    return data


def is_placeholder() -> bool:
    return str(_load().get("provenance", "")).startswith("PLACEHOLDER")


def covariates_at(lat: float, lon: float, keys: tuple[str, ...] = KEYS, registry: SourceRegistry | None = None) -> list[float]:
    """Covariate vector at a location: the nearest recorded point's values, blended by inverse distance over the 3 nearest."""
    (registry or default_registry()).require("osm")
    pts = list(_load()["points"].values())
    near = sorted(((haversine_km(lat, lon, p["lat"], p["lon"]), p) for p in pts), key=lambda t: t[0])[:3]
    if near[0][0] < 0.05:
        return [float(near[0][1][k]) for k in keys]
    w = [1.0 / d ** 2 for d, _ in near]
    return [sum(wi * float(p[k]) for wi, (_, p) in zip(w, near)) / sum(w) for k in keys]
