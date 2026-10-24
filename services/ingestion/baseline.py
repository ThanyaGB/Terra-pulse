"""Pilot baseline loader (T1.6, ADR-21). Fire baseline: FIRMS hotspots for the Sangrur villages in October-November of
2023-2025. Air-quality baseline: CPCB history for Anand Vihar and Patparganj plus Delhi control stations, with a
pre-period trend check on the controls. Nothing here needs a Sangrur ground station.

Inputs are archive files (FIRMS archive CSV, CPCB history CSV with columns station,city,ts,pm25) that a person downloads;
this module never invents data. The output is a versioned snapshot whose ID is a hash of the canonical content, so the same
inputs and config always give the same ID and a stored snapshot can be re-verified."""
from __future__ import annotations

import csv
import hashlib
import io
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean
from typing import Any, Sequence

from domain.config import load_yaml
from domain.data_sources import SourceRegistry, default_registry

from .firms import CONFIDENCE_OK
from .geo import VILLAGES, Place, haversine_km


class BaselineError(ValueError):
    pass


def fire_baseline(csv_text: str, cfg: dict[str, Any], villages: Sequence[Place] = VILLAGES) -> dict[str, Any]:
    """Counts of nominal/high-confidence hotspots per village and year in the configured months, plus per-day totals."""
    years, months, radius = set(cfg["years"]), set(cfg["months"]), float(cfg["village_radius_km"])
    per_village: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    per_day: dict[str, int] = defaultdict(int)
    for row in csv.DictReader(io.StringIO(csv_text)):
        try:
            d = datetime.strptime(row["acq_date"], "%Y-%m-%d")
            if d.year not in years or d.month not in months or row["confidence"].strip().lower() not in CONFIDENCE_OK:
                continue
            lat, lon = float(row["latitude"]), float(row["longitude"])
        except (KeyError, ValueError):
            continue
        dist, v = min(((haversine_km(lat, lon, p.lat, p.lon), p) for p in villages), key=lambda t: t[0])
        if dist <= radius:
            per_village[v.id][str(d.year)] += 1
            per_day[row["acq_date"]] += 1
    return {"per_village_year": {k: dict(sorted(v.items())) for k, v in sorted(per_village.items())}, "per_day": dict(sorted(per_day.items())),
            "total_by_year": {str(y): sum(c.get(str(y), 0) for c in per_village.values()) for y in sorted(years)}}


def read_cpcb_history(csv_text: str, city: str = "Delhi") -> dict[str, dict[str, float]]:
    """station -> {date: daily mean PM2.5}. Rejects any station outside `city`: the baseline never depends on Sangrur stations."""
    acc: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in csv.DictReader(io.StringIO(csv_text)):
        if row["city"].strip().lower() != city.lower():
            raise BaselineError(f"station {row['station']!r} is in {row['city']!r}; the baseline uses {city} stations only (ADR-21)")
        if row["pm25"] in ("", "NA"):
            continue
        acc[row["station"]][row["ts"][:10]].append(float(row["pm25"]))
    return {s: {d: round(mean(v), 2) for d, v in sorted(days.items())} for s, days in acc.items()}


def _slope(ys: Sequence[float]) -> float:
    n = len(ys)
    mx, my = (n - 1) / 2, mean(ys)
    den = sum((i - mx) ** 2 for i in range(n))
    return sum((i - mx) * (y - my) for i, y in enumerate(ys)) / den if den else 0.0


def _corr(a: Sequence[float], b: Sequence[float]) -> float:
    ma, mb = mean(a), mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = (sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b)) ** 0.5
    return num / den if den else 0.0


def pre_period_check(daily: dict[str, dict[str, float]], treated: Sequence[str], candidates: Sequence[str], pre_end: str, cfg: dict[str, Any]) -> dict[str, Any]:
    """Keep controls whose pre-period (dates <= pre_end) daily-mean trend matches the treated mean."""
    chk = cfg["pre_period_check"]
    missing = [s for s in treated if s not in daily]
    if missing:
        raise BaselineError(f"no CPCB history for treated stations: {missing}")
    days = sorted(d for d in set.intersection(*(set(daily[s]) for s in treated)) if d <= pre_end)
    if len(days) < chk["min_days"]:
        raise BaselineError(f"only {len(days)} common pre-period days for the treated stations; need {chk['min_days']}")
    tmean = [mean(daily[s][d] for s in treated) for d in days]
    results: dict[str, Any] = {}
    for c in candidates:
        common = [d for d in days if d in daily.get(c, {})]
        if len(common) < chk["min_days"]:
            results[c] = {"kept": False, "reason": f"{len(common)} overlapping days"}
            continue
        t = [mean(daily[s][d] for s in treated) for d in common]
        y = [daily[c][d] for d in common]
        diff, r = abs(_slope(t) - _slope(y)), _corr(t, y)
        kept = diff <= chk["max_slope_diff_ug_per_day"] and r >= chk["min_correlation"]
        results[c] = {"kept": kept, "slope_diff": round(diff, 3), "correlation": round(r, 3), "days": len(common)}
    return {"pre_end": pre_end, "treated_slope": round(_slope(tmean), 3), "controls": results, "selected": sorted(k for k, v in results.items() if v["kept"])}


def snapshot_id(body: dict[str, Any]) -> str:
    return "BL-" + hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:12]


def build_baseline(firms_csv: str, cpcb_csv: str, pre_end: str, cfg: dict[str, Any] | None = None, registry: SourceRegistry | None = None) -> dict[str, Any]:
    """Returns {'snapshot_id', 'body'}. Refuses to run unless both sources are registered (ADR-20)."""
    cfg = cfg or load_yaml("baseline.yaml")
    reg = registry or default_registry()
    reg.require(cfg["fire"]["source"])
    reg.require(cfg["cpcb"]["source"])
    daily = read_cpcb_history(cpcb_csv, cfg["cpcb"]["city"])
    body = {"config": cfg, "inputs": {"firms_sha256": hashlib.sha256(firms_csv.encode()).hexdigest(), "cpcb_sha256": hashlib.sha256(cpcb_csv.encode()).hexdigest()},
            "fire": fire_baseline(firms_csv, cfg["fire"]),
            "air": {"stations": sorted(daily), "daily_mean_pm25": {s: daily[s] for s in cfg["cpcb"]["treated"] if s in daily},
                    "pre_period": pre_period_check(daily, cfg["cpcb"]["treated"], cfg["cpcb"]["control_candidates"], pre_end, cfg["cpcb"])}}
    return {"snapshot_id": snapshot_id(body), "body": body}


def save(snapshot: dict[str, Any], directory: str | Path = "var/baseline") -> Path:
    path = Path(directory) / f"{snapshot['snapshot_id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(snapshot, sort_keys=True, indent=1), encoding="utf8")
    return path


def verify(path: str | Path) -> bool:
    """A stored snapshot is intact if its ID is still the hash of its body."""
    snap = json.loads(Path(path).read_text(encoding="utf8"))
    return bool(snap["snapshot_id"] == snapshot_id(snap["body"]))
