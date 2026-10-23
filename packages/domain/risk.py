"""Stubble fire risk score (spec 5.1). Weights and thresholds come from config, never from code."""
from __future__ import annotations

import copy
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from typing import Any

from .config import load_yaml

TIERS = ("low", "medium", "high", "critical")


@dataclass(frozen=True)
class RiskInputs:
    ndvi_decay_slope: float                 # NDVI units per day (negative when vegetation is declining)
    sowing_window_days_remaining: float     # working days between harvest completion and latest safe sowing
    soil_moisture_index: float              # 0 (dry) .. 1 (saturated)
    historical_fire_density: float          # fires per km2 per season
    local_machinery_shortfall: float        # 0 (plenty) .. 1 (none available)


@dataclass(frozen=True)
class RiskResult:
    score: float
    tier: str
    components: dict[str, float]


@lru_cache(maxsize=1)
def _load_cached() -> dict[str, Any]:
    cfg = load_yaml("risk_weights.yaml")
    total = sum(cfg["weights"].values())
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"risk weights must sum to 1, got {total}")
    return cfg


def load_weights() -> dict[str, Any]:
    return copy.deepcopy(_load_cached())


def _clamp(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def normalise(inputs: RiskInputs, cfg: dict[str, Any]) -> dict[str, float]:
    n = cfg["normalisation"]
    return {
        "ndvi_decay_slope": _clamp(-inputs.ndvi_decay_slope / n["ndvi_slope_full_scale"]),
        "sowing_window_days_remaining": _clamp(1 - inputs.sowing_window_days_remaining / n["sowing_window_max_days"]),
        "soil_moisture_index": _clamp(inputs.soil_moisture_index),
        "historical_fire_density": _clamp(inputs.historical_fire_density / n["fire_density_full_scale"]),
        "local_machinery_shortfall": _clamp(inputs.local_machinery_shortfall),
    }


def tier_for(score: float, cfg: dict[str, Any]) -> str:
    t = cfg["tiers"]
    if score >= t["critical"]:
        return "critical"
    if score >= t["high"]:
        return "high"
    if score >= t["medium"]:
        return "medium"
    return "low"


def risk_score(inputs: RiskInputs, weights: dict[str, Any] | None = None) -> RiskResult:
    cfg = weights or _load_cached()
    comps = normalise(inputs, cfg)
    score = round(100 * sum(cfg["weights"][k] * v for k, v in comps.items()), 1)
    return RiskResult(score=score, tier=tier_for(score, cfg), components=comps)


def sowing_window_days(harvest_complete: date, latest_sowing: date) -> int:
    """Working days (Mon-Sat) between complete paddy harvest and the latest safe wheat sowing date."""
    days, d = 0, harvest_complete
    while d < latest_sowing:
        d += timedelta(days=1)
        if d.weekday() != 6:
            days += 1
    return days


def is_active(today: date, harvest_start: date, weights: dict[str, Any] | None = None) -> bool:
    """The agent scores a village 7-10 days before harvest starts."""
    a = (weights or load_weights())["activation"]
    lead = (harvest_start - today).days
    return bool(a["days_before_harvest_min"] <= lead <= a["days_before_harvest_max"])
