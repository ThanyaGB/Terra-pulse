"""Low-cost sensor drift calibration and gap filling by spatiotemporal interpolation (T1.4)."""
from __future__ import annotations

from statistics import mean
from typing import Sequence

DRIFT_FLAG_RATIO = 0.25   # sensor mean deviates >25% from the reference mean -> flag


def drift_factor(sensor: Sequence[float | None], reference: Sequence[float | None]) -> float:
    """Multiplicative correction so the sensor's mean matches a co-located reference over paired valid samples."""
    pairs = [(s, r) for s, r in zip(sensor, reference) if s is not None and r is not None and s > 0]
    if len(pairs) < 3:
        return 1.0
    return mean(r for _, r in pairs) / mean(s for s, _ in pairs)


def is_drifting(sensor: Sequence[float | None], reference: Sequence[float | None]) -> bool:
    return abs(drift_factor(sensor, reference) - 1.0) > DRIFT_FLAG_RATIO


def calibrate(sensor: Sequence[float | None], factor: float) -> list[float | None]:
    return [None if v is None else round(v * factor, 2) for v in sensor]


def fill_gaps(series: Sequence[float | None], neighbours: Sequence[Sequence[float | None]] = (),
              weights: Sequence[float] = ()) -> tuple[list[float], list[bool]]:
    """Fill None values. Temporal: linear interpolation between the nearest valid samples. If the gap is at an
    edge, or neighbour series are provided, use the inverse-distance-weighted neighbour value at that hour.
    Returns (filled, was_interpolated)."""
    n = len(series)
    filled: list[float] = [0.0] * n
    flags = [False] * n
    valid = [i for i, v in enumerate(series) if v is not None]
    if not valid:
        raise ValueError("cannot gap-fill an entirely empty series")
    for i in range(n):
        v = series[i]
        if v is not None:
            filled[i] = float(v)
            continue
        flags[i] = True
        spatial = _spatial(i, neighbours, weights)
        prev = max((j for j in valid if j < i), default=None)
        nxt = min((j for j in valid if j > i), default=None)
        if prev is not None and nxt is not None:
            a, b = float(series[prev]), float(series[nxt])  # type: ignore[arg-type]
            temporal = a + (b - a) * (i - prev) / (nxt - prev)
            filled[i] = temporal if spatial is None else 0.5 * temporal + 0.5 * spatial
        elif spatial is not None:
            filled[i] = spatial
        else:
            filled[i] = float(series[prev if prev is not None else nxt])  # type: ignore[index,arg-type]
    return [round(v, 2) for v in filled], flags


def _spatial(i: int, neighbours: Sequence[Sequence[float | None]], weights: Sequence[float]) -> float | None:
    num = den = 0.0
    for k, nb in enumerate(neighbours):
        if i < len(nb) and nb[i] is not None:
            w = weights[k] if k < len(weights) else 1.0
            num += w * float(nb[i])  # type: ignore[arg-type]
            den += w
    return num / den if den else None
