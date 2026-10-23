"""Exposure dose (spec 5.3): Dose = integral of PM2.5(position) x ventilation_rate(activity) dt, discretised."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

# Litres of air per minute (typical values from exposure literature; callers may override).
VENTILATION_L_PER_MIN = {"rest": 7.5, "walking": 20.0, "cycling": 35.0, "vigorous": 60.0}
STEP_S = 60


@dataclass(frozen=True)
class Segment:
    minutes: float
    pm25: float
    label: str = ""


def dose(segments: Sequence[Segment], activity: str = "walking", step_s: int = STEP_S,
         ventilation: dict[str, float] | None = None) -> float:
    """Inhaled PM2.5 mass in ug, summed over fixed time steps."""
    vent = ventilation or VENTILATION_L_PER_MIN
    if activity not in vent:
        raise ValueError(f"unknown activity {activity!r}")
    litres_per_step = vent[activity] * step_s / 60.0
    total = 0.0
    for seg in segments:
        if seg.minutes < 0 or seg.pm25 < 0:
            raise ValueError("segment minutes and pm25 must be non-negative")
        steps = max(0, round(seg.minutes * 60 / step_s))
        total += steps * seg.pm25 * litres_per_step / 1000.0  # ug/m3 x L -> ug (1 m3 = 1000 L)
    return total


def exposure_reduction(baseline: float, recommended: float) -> float:
    """Percent reduction; 0 when the baseline is zero."""
    if baseline <= 0:
        return 0.0
    return round((baseline - recommended) / baseline * 100, 1)


def average_exposure(segments: Sequence[Segment]) -> float:
    total_min = sum(s.minutes for s in segments)
    return sum(s.minutes * s.pm25 for s in segments) / total_min if total_min else 0.0
