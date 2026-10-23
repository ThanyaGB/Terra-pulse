"""NASA FIRMS connector. Uses the public, keyless VIIRS (Suomi-NPP, 375 m) 24 h CSV for South Asia.
Poll every 15 min (spec 6.1). With a MAP_KEY configured, the area API can be used instead (not needed here)."""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .geo import REGION_BBOX
from .rawstore import RawStore

URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_South_Asia_24h.csv"
FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "integration" / "fixtures" / "firms_viirs_south_asia_24h.csv"
CONFIDENCE_OK = {"nominal", "high", "n", "h"}


@dataclass(frozen=True)
class Hotspot:
    lat: float
    lon: float
    acquired_at: str   # ISO UTC
    frp: float         # fire radiative power, MW
    confidence: str
    daynight: str


def parse(csv_text: str, bbox: tuple[float, float, float, float] = REGION_BBOX) -> list[Hotspot]:
    min_lon, min_lat, max_lon, max_lat = bbox
    out: list[Hotspot] = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        try:
            lat, lon = float(row["latitude"]), float(row["longitude"])
            if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
                continue
            conf = row["confidence"].strip().lower()
            if conf not in CONFIDENCE_OK:
                continue  # drop low-confidence detections
            hhmm = row["acq_time"].zfill(4)
            ts = datetime.strptime(f"{row['acq_date']} {hhmm}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
            out.append(Hotspot(lat, lon, ts.isoformat().replace("+00:00", "Z"), float(row.get("frp") or 0), conf, row.get("daynight", "")))
        except (KeyError, ValueError):
            continue
    return out


def fetch(raw: RawStore | None = None, *, offline: bool = False, client: httpx.Client | None = None) -> tuple[list[Hotspot], str]:
    """Returns (hotspots, source) where source is 'live' or 'fixture'."""
    text, source = None, "fixture"
    if not offline:
        try:
            r = (client or httpx).get(URL, timeout=45, follow_redirects=True)
            r.raise_for_status()
            text, source = r.text, "live"
        except httpx.HTTPError:
            text = None
    if text is None:
        text = FIXTURE.read_text(encoding="utf8")
    if raw is not None:
        raw.put("firms", f"viirs_{datetime.now(timezone.utc):%H%M}.csv", text.encode())
    return parse(text), source
