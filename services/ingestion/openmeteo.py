"""Open-Meteo connectors (keyless). Air quality is the CAMS global model (PM2.5, PM10, NO2, SO2, CO, dust);
weather gives winds, boundary-layer height and soil moisture from NWP. Used for the CPCB/IoT/IMD gaps that
need credentials (see docs/data-sources.md and open question 8)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

from .geo import Place
from .rawstore import RawStore

AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WX_URL = "https://api.open-meteo.com/v1/forecast"
FIXTURE_DIR = Path(__file__).resolve().parents[2] / "tests" / "integration" / "fixtures"
AQ_VARS = "pm2_5,pm10,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,dust,us_aqi"
WX_VARS = "wind_speed_10m,wind_direction_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,soil_moisture_0_to_1cm,temperature_2m,temperature_850hPa"


@dataclass
class Series:
    times: list[str]
    values: dict[str, list[float | None]] = field(default_factory=dict)

    def at(self, var: str, idx: int) -> float | None:
        v = self.values.get(var)
        return v[idx] if v is not None and 0 <= idx < len(v) else None

    def now_index(self, now_iso_prefix: str | None = None) -> int:
        """Index of the latest hour that is not in the future (times are local ISO strings)."""
        if now_iso_prefix:
            for i, t in enumerate(self.times):
                if t >= now_iso_prefix:
                    return i
        return min(len(self.times) - 1, 24)


def _parse(payload: dict[str, Any]) -> Series:
    h = payload["hourly"]
    return Series(h["time"], {k: v for k, v in h.items() if k != "time"})


def _get(url: str, params: dict[str, Any], raw: RawStore | None, tag: str, client: httpx.Client | None) -> dict[str, Any]:
    r = (client or httpx).get(url, params=params, timeout=40)
    r.raise_for_status()
    data: dict[str, Any] = r.json()
    if raw is not None:
        raw.put("open-meteo", f"{tag}.json", json.dumps(data).encode())
    return data


def fetch_air(place: Place, raw: RawStore | None = None, past_days: int = 2, forecast_days: int = 3,
              client: httpx.Client | None = None) -> Series:
    data = _get(AQ_URL, {"latitude": place.lat, "longitude": place.lon, "hourly": AQ_VARS, "past_days": past_days,
                         "forecast_days": forecast_days, "timezone": "Asia/Kolkata"}, raw, f"aq_{place.id}", client)
    return _parse(data)


def fetch_weather(place: Place, raw: RawStore | None = None, past_days: int = 2, forecast_days: int = 4,
                  client: httpx.Client | None = None) -> Series:
    data = _get(WX_URL, {"latitude": place.lat, "longitude": place.lon, "hourly": WX_VARS, "past_days": past_days,
                         "forecast_days": forecast_days, "timezone": "Asia/Kolkata", "wind_speed_unit": "kmh"}, raw, f"wx_{place.id}", client)
    return _parse(data)


def load_fixture(name: str) -> Series:
    return _parse(json.loads((FIXTURE_DIR / name).read_text(encoding="utf8")))
