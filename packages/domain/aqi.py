"""CPCB National AQI from PM2.5 (24 h-average breakpoints, applied here to hourly values as an indicative index)."""
from __future__ import annotations

# (pm_lo, pm_hi, aqi_lo, aqi_hi)
_PM25_BREAKS = [(0, 30, 0, 50), (30, 60, 51, 100), (60, 90, 101, 200), (90, 120, 201, 300), (120, 250, 301, 400), (250, 380, 401, 500)]

BANDS = [(50, "good"), (100, "satisfactory"), (200, "moderate"), (300, "poor"), (400, "very_poor"), (450, "severe"), (10_000, "severe_plus")]


def pm25_to_aqi(pm25: float) -> int:
    if pm25 < 0:
        raise ValueError("pm25 must be non-negative")
    for lo, hi, a_lo, a_hi in _PM25_BREAKS:
        if pm25 <= hi:
            return round(a_lo + (a_hi - a_lo) * (pm25 - lo) / (hi - lo))
    return round(500 + (pm25 - 380) * 500 / 380 * 0.2)  # beyond the scale: keep monotonic


def band(aqi: float) -> str:
    return next(name for limit, name in BANDS if aqi <= limit)
