"""Clean commute routing (spec 5.6): largest dose reduction with added time under a limit."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from .dose import Segment, average_exposure, dose, exposure_reduction

DEFAULT_MAX_EXTRA_MIN = 3.0


@dataclass(frozen=True)
class RouteOption:
    id: str
    name: str
    segments: Sequence[Segment]

    @property
    def minutes(self) -> float:
        return sum(s.minutes for s in self.segments)


@dataclass(frozen=True)
class RouteChoice:
    baseline: RouteOption
    recommended: RouteOption
    extra_minutes: float
    reduction_pct: float
    avg_pm25_baseline: float
    avg_pm25_recommended: float


def recommend(options: Sequence[RouteOption], activity: str = "walking",
              max_extra_min: float = DEFAULT_MAX_EXTRA_MIN) -> RouteChoice:
    if not options:
        raise ValueError("no route options")
    baseline = min(options, key=lambda o: o.minutes)  # the fastest route is the default choice
    base_dose = dose(baseline.segments, activity)
    best, best_red = baseline, 0.0
    for o in options:
        if o.minutes - baseline.minutes > max_extra_min:
            continue
        red = exposure_reduction(base_dose, dose(o.segments, activity))
        if red > best_red:
            best, best_red = o, red
    return RouteChoice(baseline, best, round(best.minutes - baseline.minutes, 1), best_red,
                       round(average_exposure(baseline.segments), 1), round(average_exposure(best.segments), 1))
