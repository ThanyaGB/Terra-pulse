"""ROI measurement (spec 5.5): PM2.5 change 4-12 h after an action versus a matched control station."""
from __future__ import annotations

from dataclasses import dataclass
from statistics import mean
from typing import Iterable, Sequence

MIN_H, MAX_H = 4, 12


def delta_pm25(pre: Sequence[float], post: Sequence[float]) -> float:
    """mean_pre - mean_post. Positive means the air improved."""
    if not pre or not post:
        raise ValueError("pre and post windows must be non-empty")
    return round(mean(pre) - mean(post), 2)


def in_window(hours_after_completion: float) -> bool:
    return MIN_H <= hours_after_completion <= MAX_H


def net_effect(treated_pre: Sequence[float], treated_post: Sequence[float],
               control_pre: Sequence[float], control_post: Sequence[float]) -> float:
    """Treated change minus control change, removing the background (weather-driven) trend."""
    return round(delta_pm25(treated_pre, treated_post) - delta_pm25(control_pre, control_post), 2)


@dataclass(frozen=True)
class RoiRecord:
    work_order_id: str
    area: str
    delta_pm25: float


def aggregate(records: Iterable[RoiRecord]) -> dict[str, dict[str, float]]:
    out: dict[str, list[float]] = {}
    for r in records:
        out.setdefault(r.area, []).append(r.delta_pm25)
    return {a: {"actions": len(v), "mean_delta_pm25": round(mean(v), 2), "total_delta_pm25": round(sum(v), 2)}
            for a, v in out.items()}
