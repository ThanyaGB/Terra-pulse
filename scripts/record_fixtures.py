"""Record real public-data responses as test fixtures (tests/integration/fixtures). Run when refreshing fixtures:
    python scripts/record_fixtures.py
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "services"), str(ROOT / "packages")]

import httpx  # noqa: E402

from ingestion import firms, geo, ndvi, openmeteo  # noqa: E402

FIX = ROOT / "tests" / "integration" / "fixtures"
FIX.mkdir(parents=True, exist_ok=True)


def main() -> None:
    r = httpx.get(firms.URL, timeout=60, follow_redirects=True)
    r.raise_for_status()
    (FIX / "firms_viirs_south_asia_24h.csv").write_text(r.text, encoding="utf8")
    for place in geo.AREAS:
        d = httpx.get(openmeteo.AQ_URL, params={"latitude": place.lat, "longitude": place.lon, "hourly": openmeteo.AQ_VARS, "past_days": 2,
                                                "forecast_days": 3, "timezone": "Asia/Kolkata"}, timeout=40).json()
        (FIX / f"openmeteo_aq_{place.id}.json").write_text(json.dumps(d), encoding="utf8")
    for place in geo.PUNJAB_SOURCE_POINTS + geo.VILLAGES[:3] + [geo.AREAS[0]]:
        d = httpx.get(openmeteo.WX_URL, params={"latitude": place.lat, "longitude": place.lon, "hourly": openmeteo.WX_VARS, "past_days": 2,
                                                "forecast_days": 4, "timezone": "Asia/Kolkata", "wind_speed_unit": "kmh"}, timeout=40).json()
        (FIX / f"openmeteo_wx_{place.id}.json").write_text(json.dumps(d), encoding="utf8")

    def one(v: geo.Place) -> tuple[str, list[dict[str, object]]]:
        try:
            return v.id, [asdict(o) for o in ndvi.observe(v, scenes=4)]
        except Exception as exc:  # noqa: BLE001
            print("ndvi failed", v.id, exc)
            return v.id, []

    with ThreadPoolExecutor(6) as pool:
        res = dict(pool.map(one, geo.VILLAGES))
    (FIX / "ndvi_sangrur.json").write_text(json.dumps(res, indent=1), encoding="utf8")
    print("recorded", len(list(FIX.iterdir())), "fixtures")


if __name__ == "__main__":
    main()
