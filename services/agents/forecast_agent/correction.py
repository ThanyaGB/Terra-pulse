"""CPCB correction of the CAMS forecast (ADR-16): station observations scale the coarse forecast at their area, and the
correction fades over the forecast horizon. Areas without a CPCB station get half the median correction of the others."""
from __future__ import annotations

import re
from statistics import median
from typing import Any, Mapping, Sequence

from ingestion.cpcb import StationReading


def _norm(name: str) -> str:
    return re.sub(r"[^a-z ]", " ", name.lower()).replace("  ", " ").strip()


def station_area(station: str, aliases: Mapping[str, str]) -> str | None:
    s = " ".join(_norm(station).split())
    return next((area for alias, area in aliases.items() if alias in s), None)


def area_ratios(readings: Sequence[StationReading] | None, cams_now: Mapping[str, float], cfg: Mapping[str, Any]) -> dict[str, tuple[float, str]]:
    """area id -> (ratio observed/forecast clamped to the configured range, 'station' | 'regional'). Empty when no readings."""
    if not readings:
        return {}
    lo, hi = float(cfg["min_ratio"]), float(cfg["max_ratio"])
    direct: dict[str, float] = {}
    for r in readings:
        if r.pollutant.upper().replace("_", ".") not in ("PM2.5", "PM25") or r.avg is None:
            continue
        area = station_area(r.station, cfg["station_aliases"])
        base = cams_now.get(area or "")
        if area and base and base > 0:
            direct[area] = min(max(r.avg / base, lo), hi)
    if not direct:
        return {}
    regional = 1.0 + 0.5 * (median(direct.values()) - 1.0)
    out = {a: (regional, "regional") for a in cams_now}
    out.update({a: (v, "station") for a, v in direct.items()})
    return out


def correct_series(pm25: Sequence[float], ratio: float, decay_hours: float) -> list[float]:
    """Apply the ratio at hour 0 and let it relax to 1 with an exponential decay."""
    import math
    return [round(v * (1.0 + (ratio - 1.0) * math.exp(-i / decay_hours)), 1) for i, v in enumerate(pm25)]
