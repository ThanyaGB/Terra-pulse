"""Builds one normalised Snapshot of the world from the public sources, falling back per item to recorded
fixtures so the platform still runs offline or when a provider is down. Quality metrics record which origin served."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import cpcb, firms, geo, ndvi, openmeteo
from .calibration import fill_gaps
from .clustering import FireCluster, cluster, fires_by_village
from .quality import QualityTracker
from .rawstore import RawStore

log = logging.getLogger("ingestion")


@dataclass
class Snapshot:
    fetched_at: datetime
    hotspots: list[firms.Hotspot]
    clusters: list[FireCluster]
    air: dict[str, openmeteo.Series]               # area id -> hourly air series (past 2 d + 3 d forecast)
    weather: dict[str, openmeteo.Series]           # source point / village id -> hourly weather
    ndvi: dict[str, list[ndvi.NdviObs]]            # village id -> recent observations (newest first)
    quality: QualityTracker = field(default_factory=QualityTracker)
    fires_by_village: dict[str, int] = field(default_factory=dict)

    def now_index(self, series: openmeteo.Series) -> int:
        return hour_index(series, self.fetched_at)


def _local_hour_prefix(now: datetime) -> str:
    # Open-Meteo is requested in Asia/Kolkata (UTC+5:30)
    from datetime import timedelta
    return (now.astimezone(timezone.utc) + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%dT%H:00")


def _try_air(place: geo.Place, raw: RawStore | None, offline: bool) -> tuple[openmeteo.Series, str]:
    if not offline:
        try:
            return openmeteo.fetch_air(place, raw), "live"
        except Exception as exc:  # noqa: BLE001
            log.warning("air fetch failed for %s: %s", place.id, exc)
    return openmeteo.load_fixture(f"openmeteo_aq_{place.id}.json"), "fixture"


def _try_wx(place: geo.Place, raw: RawStore | None, offline: bool) -> tuple[openmeteo.Series, str]:
    if not offline:
        try:
            return openmeteo.fetch_weather(place, raw), "live"
        except Exception as exc:  # noqa: BLE001
            log.warning("weather fetch failed for %s: %s", place.id, exc)
    return openmeteo.load_fixture(f"openmeteo_wx_{place.id}.json"), "fixture"


def build_snapshot(raw: RawStore | None = None, *, offline: bool = False, live_ndvi: bool = False,
                   data_gov_key: str | None = None, now: datetime | None = None) -> Snapshot:
    now = now or datetime.now(timezone.utc)
    q = QualityTracker()

    hotspots, origin = firms.fetch(raw, offline=offline)
    q.record("firms", origin, now)
    clusters = cluster(hotspots)

    wx_places = geo.PUNJAB_SOURCE_POINTS + geo.VILLAGES[:3] + [geo.AREAS[0]]
    with ThreadPoolExecutor(8) as pool:
        air_res = list(pool.map(lambda p: _try_air(p, raw, offline), geo.AREAS))
        wx_res = list(pool.map(lambda p: _try_wx(p, raw, offline), wx_places))
    air = {p.id: s for p, (s, _) in zip(geo.AREAS, air_res)}
    weather = {p.id: s for p, (s, _) in zip(wx_places, wx_res)}
    # villages without their own weather series use the nearest recorded point
    for v in geo.VILLAGES:
        if v.id not in weather:
            near, _ = geo.nearest([p for p in wx_places], v.lat, v.lon)
            weather[v.id] = weather[near.id]
    q.record("cpcb", "live" if all(o == "live" for _, o in air_res) else "fixture", now)  # modelled CAMS stands in for CAAQMS
    q.record("weather", "live" if all(o == "live" for _, o in wx_res) else "fixture", now)

    # sensor/station availability, interpolation fraction (spec 6.3)
    for p, (s, _) in zip(geo.AREAS, air_res):
        pm = s.values.get("pm2_5", [])
        q.stations[p.id] = any(v is not None for v in pm[-48:])
        gaps = sum(v is None for v in pm)
        q.interpolated_fraction[p.id] = round(gaps / len(pm), 3) if pm else 1.0
        if gaps and gaps < len(pm):
            s.values["pm2_5"], _ = fill_gaps(pm)  # type: ignore[assignment]

    if data_gov_key and not offline:
        try:
            cpcb.fetch(data_gov_key)
            q.record("cpcb", "live", now)
        except Exception as exc:  # noqa: BLE001
            log.warning("CPCB data.gov.in failed: %s", exc)

    if live_ndvi and not offline:
        try:
            with ThreadPoolExecutor(6) as pool:
                nd = dict(zip([v.id for v in geo.VILLAGES], pool.map(lambda v: ndvi.observe(v), geo.VILLAGES)))
            q.record("sentinel2", "live", now)
        except Exception as exc:  # noqa: BLE001
            log.warning("Sentinel-2 live failed (%s); using recorded NDVI", exc)
            nd = ndvi.load_fixture()
            q.record("sentinel2", "fixture", now)
    else:
        nd = ndvi.load_fixture()
        q.record("sentinel2", "fixture", now)

    return Snapshot(now, hotspots, clusters, air, weather, nd, q, fires_by_village(clusters))


def hour_index(series: openmeteo.Series, now: datetime | None = None) -> int:
    return series.now_index(_local_hour_prefix(now or datetime.now(timezone.utc)))
