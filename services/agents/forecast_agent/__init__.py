"""Forecast and Attribution Agent (T2.4).

- Downscales coarse PM2.5 to the 1 km grid (GNN artifact if present, else IDW fallback).
- Source apportionment: a transparent proxy model, NOT a receptor model. Inputs are real pollutant signals:
    straw_plume = fire radiative power in the upwind sector (NASA FIRMS) scaled by wind alignment
    vehicle     = NO2 (traffic tracer)
    dust        = coarse fraction (PM10 - PM2.5) plus CAMS dust
    industrial  = SO2 and CO excess
  Percentages always sum to 100 through domain.attribution.
- 72 h plume arrival per street segment from real forecast winds."""
from __future__ import annotations

from typing import Any

from agents.common import BaseAgent, Event
from agents.common.events import ATTRIBUTION_UPDATED, DATA_NORMALISED, FORECAST_UPDATED
from agents.world import World
from domain import aqi as aqi_domain
from domain.attribution import attribution, dominant
from ingestion.geo import AREAS, PUNJAB_SOURCE_POINTS, bearing_deg, haversine_km
from ingestion.openmeteo import Series
from ingestion.pipeline import Snapshot, hour_index

from . import plume as plume_mod
from .downscale import Downscaler, downscale, load_model

HORIZON = 72
UPWIND_MAX_KM = 450
SECTOR_DEG = 45


def upwind_frp(snap: Snapshot, lat: float, lon: float, wind_from_deg: float) -> float:
    """Total FRP (MW) of hotspots within UPWIND_MAX_KM whose bearing from the area falls inside the upwind sector."""
    total = 0.0
    for h in snap.hotspots:
        d = haversine_km(lat, lon, h.lat, h.lon)
        if d > UPWIND_MAX_KM or d < 5:
            continue
        diff = abs((bearing_deg(lat, lon, h.lat, h.lon) - wind_from_deg + 180) % 360 - 180)
        if diff <= SECTOR_DEG:
            total += h.frp * (1 - d / UPWIND_MAX_KM)
    return total


def source_concentrations(pm25: float, pm10: float, no2: float, so2: float, co: float, dust: float, frp: float) -> dict[str, float]:
    straw = min(0.6 * pm25, frp * 0.1)
    vehicle = max(0.0, no2 * 0.45)
    coarse = max(0.0, pm10 - pm25)
    dust_c = coarse * 0.35 + dust * 0.5
    industrial = so2 * 0.6 + max(0.0, co - 600) * 0.01
    return {"straw_plume": straw, "vehicle": vehicle, "dust": dust_c, "industrial_waste": industrial}


class ForecastAttributionAgent(BaseAgent):
    name = "forecast_agent"
    subscribes = (DATA_NORMALISED,)

    def __init__(self, bus, world: World, model: Downscaler | None = None, **kw: Any) -> None:  # type: ignore[no-untyped-def]
        super().__init__(bus, **kw)
        self.world = world
        self.model = model if model is not None else load_model()
        self.method = "idw-fallback" if self.model is None else "gnn"
        self._done: set[str] = set()

    async def handle(self, event: Event) -> None:
        window = event.payload["window"]
        snap = self.world.snapshot
        if snap is None or window in self._done:
            return
        self._done.add(window)
        wx = snap.weather["sangrur"]
        wi = hour_index(wx, snap.fetched_at)
        wind_from = wx.at("wind_direction_100m", wi) or wx.at("wind_direction_10m", wi) or 315.0

        ncr_conc = {"straw_plume": 0.0, "vehicle": 0.0, "dust": 0.0, "industrial_waste": 0.0}
        baseline: dict[str, float] = {}
        for a in AREAS:
            s = snap.air[a.id]
            i = hour_index(s, snap.fetched_at)
            def g(v: str, idx: int = i, s: Series = s) -> float:
                return s.at(v, idx) or 0.0

            pm25 = g("pm2_5")
            baseline[a.id] = pm25
            series = [{"t": s.times[j], "pm25": round(s.at("pm2_5", j) or 0.0, 1)} for j in range(i, min(i + HORIZON + 1, len(s.times)))]
            frp = upwind_frp(snap, a.lat, a.lon, wind_from)
            conc = source_concentrations(pm25, g("pm10"), g("nitrogen_dioxide"), g("sulphur_dioxide"), g("carbon_monoxide"), g("dust"), frp)
            shares = attribution(conc)
            aqi = aqi_domain.pm25_to_aqi(pm25)
            self.world.forecast[a.id] = {"area_id": a.id, "name": a.name, "lat": a.lat, "lng": a.lon, "pm25": round(pm25, 1),
                                         "pm10": round(g("pm10"), 1), "no2": round(g("nitrogen_dioxide"), 1), "aqi": aqi,
                                         "series": series, "updated_at": event.emitted_at, "wind_from_deg": wind_from}
            self.world.attribution[a.id] = {"shares": shares, "dominant": dominant(shares), "upwind_frp_mw": round(frp, 1)}
            for k, v in conc.items():
                ncr_conc[k] += v
            await self.emit(event.child(FORECAST_UPDATED, {"grid_id": a.id, "horizon_h": HORIZON, "pm25_series": [p["pm25"] for p in series],
                                                           "aqi": aqi, "method": self.method}))

        ncr_shares = attribution(ncr_conc)
        self.world.attribution["ncr"] = {"shares": ncr_shares, "dominant": dominant(ncr_shares), "region": "delhi_ncr"}
        await self.emit(event.child(ATTRIBUTION_UPDATED, {"region": "delhi_ncr", "shares": ncr_shares, "area_shares": {k: v["shares"] for k, v in self.world.attribution.items() if k != "ncr"}}))

        # 72 h plume
        steps = plume_mod.trajectory(wx, wi)
        fires = sum(1 for _ in snap.hotspots)
        strength = min(250.0, 30 + sum(h.frp for h in snap.hotspots) / max(1, fires) * fires * 0.01)
        impacts = plume_mod.street_impacts(steps, baseline, strength)
        self.world.plume = {
            "generatedAt": event.emitted_at, "horizonHours": HORIZON, "model": "HYSPLIT" if plume_mod.hysplit_available() else "lagrangian-advection",
            "windSpeedKmh": round(wx.at("wind_speed_100m", wi) or 0.0, 1), "windFromDeg": wind_from,
            "sources": [{"id": p.id, "name": f"{p.name} cluster", "lat": p.lat, "lng": p.lon,
                         "fires": sum(1 for h in snap.hotspots if haversine_km(p.lat, p.lon, h.lat, h.lon) <= 40)} for p in PUNJAB_SOURCE_POINTS],
            "corridor": [[round(s.lon, 4), round(s.lat, 4)] for s in steps[::6]],
            "hoursToReachNcr": plume_mod.hours_to_reach_ncr(steps), "streets": impacts,
        }
        self.world.grid = []   # invalidate cached grid


def grid_cells(world: World, bbox: tuple[float, float, float, float], model: Downscaler | None = None, step_km: float = 1.0,
               max_cells: int = 2500) -> tuple[list[dict[str, Any]], str]:
    """1 km grid for bbox (min_lon, min_lat, max_lon, max_lat): AQI and source mix per cell."""
    pts = [(f["lat"], f["lng"], f["pm25"]) for f in world.forecast.values()]
    if not pts:
        return [], "none"
    min_lon, min_lat, max_lon, max_lat = bbox
    dlat = step_km / 111.0
    cells: list[tuple[float, float]] = []
    lat = min_lat + dlat / 2
    while lat < max_lat and len(cells) < max_cells:
        import math
        dlon = step_km / (111.0 * math.cos(math.radians(lat)))
        lon = min_lon + dlon / 2
        while lon < max_lon and len(cells) < max_cells:
            cells.append((lat, lon))
            lon += dlon
        lat += dlat
    vals, method = downscale(pts, cells, model)
    out = []
    keys = list(world.attribution.keys())
    area_pts = [(f["lat"], f["lng"], i) for i, f in enumerate(world.forecast.values())]
    for (clat, clon), pm in zip(cells, vals):
        nearest = min(area_pts, key=lambda p: haversine_km(clat, clon, p[0], p[1]))
        a_id = list(world.forecast.keys())[nearest[2]]
        shares = world.attribution.get(a_id, world.attribution.get(keys[0], {})).get("shares", {})
        out.append({"cell_id": f"{clat:.3f},{clon:.3f}", "lat": round(clat, 4), "lon": round(clon, 4), "pm25": round(pm, 1),
                    "aqi": aqi_domain.pm25_to_aqi(pm), "source_mix": shares})
    return out, method
