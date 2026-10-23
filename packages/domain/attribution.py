"""Source attribution (spec 5.2): C_total = C_straw_plume + C_vehicle + C_dust + C_industrial_waste."""
from __future__ import annotations

from typing import Mapping

SOURCES = ("straw_plume", "vehicle", "dust", "industrial_waste")
TOLERANCE = 0.5


def attribution(concentrations: Mapping[str, float]) -> dict[str, float]:
    """Convert per-source concentrations (ug/m3) to percentages that sum to 100 (within 0.5)."""
    vals = {s: max(0.0, float(concentrations.get(s, 0.0))) for s in SOURCES}
    total = sum(vals.values())
    if total <= 0:
        return {s: 25.0 for s in SOURCES}
    out = {s: round(v / total * 100, 1) for s, v in vals.items()}
    # push the rounding residue into the largest share so the total is exactly 100.0
    top = max(out, key=lambda k: out[k])
    out[top] = round(out[top] + (100.0 - sum(out.values())), 1)
    return out


def sums_to_100(shares: Mapping[str, float]) -> bool:
    return abs(sum(shares.values()) - 100.0) <= TOLERANCE


def dominant(shares: Mapping[str, float]) -> str:
    return max(shares, key=lambda k: shares[k])
