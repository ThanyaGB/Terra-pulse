"""ERA5 reanalysis meteorology connector (ADR-16): hourly wind, temperature and boundary-layer height. ERA5 lags real time
by about five days, so it supplies recent observed meteorology (regime check, and the fallback when the NWP forecast
winds are unavailable); the 72 h look-ahead comes from the 'nwp' source. Live path: Open-Meteo's ERA5 archive endpoint.
Fixtures in tests/integration/fixtures/era5_*.json are saved archive responses (27-30 Oct 2025)."""
from __future__ import annotations

import logging
from datetime import date, timedelta

import httpx

from domain.data_sources import SourceRegistry, default_registry

from . import openmeteo
from .geo import Place
from .rawstore import RawStore

log = logging.getLogger("ingestion.era5")
URL = "https://archive-api.open-meteo.com/v1/archive"
VARS = "wind_speed_10m,wind_direction_10m,wind_speed_100m,wind_direction_100m,temperature_2m,boundary_layer_height"
LAG_DAYS = 6


def fetch(place: Place, raw: RawStore | None = None, *, offline: bool = False, today: date | None = None, days: int = 4,
          client: httpx.Client | None = None, registry: SourceRegistry | None = None) -> tuple[openmeteo.Series, str]:
    """Returns (series, origin). Refuses to run if 'era5' is not registered (ADR-20)."""
    (registry or default_registry()).require("era5")
    if not offline:
        end = (today or date.today()) - timedelta(days=LAG_DAYS)
        try:
            data = openmeteo._get(URL, {"latitude": place.lat, "longitude": place.lon, "hourly": VARS, "models": "era5", "timezone": "Asia/Kolkata",
                                        "start_date": (end - timedelta(days=days - 1)).isoformat(), "end_date": end.isoformat(),
                                        "wind_speed_unit": "kmh"}, raw, f"era5_{place.id}", client)
            return openmeteo._parse(data), "live"
        except Exception as exc:  # noqa: BLE001
            log.warning("ERA5 fetch failed for %s: %s", place.id, exc)
    return openmeteo.load_fixture(f"era5_{place.id}.json"), "fixture"
