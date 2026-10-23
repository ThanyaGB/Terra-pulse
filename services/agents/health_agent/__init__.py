"""Personalised Health Advisory Agent (T2.6): profile advice (versioned config), dose along routes (spec 5.3), clean
commute selection with a configurable time limit. Subscribes to forecast.updated; publishes advice.updated and
route.computed."""
from __future__ import annotations

from typing import Any

from agents.common import BaseAgent, Event
from agents.common.events import ADVICE_UPDATED, FORECAST_UPDATED, ROUTE_COMPUTED
from agents.world import World
from domain.config import load_yaml
from domain.dose import Segment
from domain.routing import RouteOption, recommend
from ingestion.geo import AREAS, haversine_km

PROFILES = ("asthma", "child", "elderly", "outdoor", "general")
WALK_KMH = 4.8
SENSITIVE = {"asthma", "child", "elderly"}


def period_for(hour: float, cfg: dict[str, Any]) -> str:
    h = hour % 24
    for name, (a, b) in cfg["periods"].items():
        if (a <= h < b) if a < b else (h >= a or h < b):
            return str(name)
    return "morning"


def build_advice(profile: str, hour: float, aqi: float, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_yaml("health_advice_v1.yaml")
    period = period_for(hour, cfg)
    items: list[dict[str, Any]] = []
    for it in cfg["period_items"].get(period, []):
        it = dict(it)
        if profile in SENSITIVE and "title_sensitive" in it:
            it["title"] = it["title_sensitive"]
        it.pop("title_sensitive", None)
        if it["level"] == "ok" and aqi >= cfg["cautious_aqi"]:
            it["level"] = "caution"        # even the clearest window is not 'ok' when the whole day is Very Poor
        items.append(it)
    items.extend(dict(i) for i in cfg["profile_base"][profile])
    if aqi < cfg["clean_air_aqi"]:         # clean day: relax the blanket restrictions
        items = [{**i, "level": "ok" if i["level"] == "avoid" else i["level"]} for i in items]
    return {"profile": profile, "period": period, "items": items, "version": cfg["version"]}


def route_options(world: World, a_id: str, b_id: str) -> list[RouteOption]:
    """Two realistic options between two monitored areas: the main road (fast, traffic-exposed) and a greenway
    through lower-exposure lanes (+2 min). Segment PM2.5 interpolates between the two endpoint readings."""
    return route_options_between(world.forecast[a_id], world.forecast[b_id])


def route_options_between(fa: dict[str, Any], fb: dict[str, Any]) -> list[RouteOption]:
    km = haversine_km(fa["lat"], fa["lng"], fb["lat"], fb["lng"]) * 1.3
    base_min = max(6.0, km / WALK_KMH * 60)
    pa, pb = fa["pm25"], fb["pm25"]
    mid = (pa + pb) / 2
    third = base_min / 3
    main = RouteOption("A", "Route A · Main road", [Segment(third, pa * 1.1, "Arterial road"), Segment(third, mid * 1.2, "Flyover / junction"), Segment(third, pb * 1.1, "Arterial road")])
    green = RouteOption("B", "Route B · Park greenway", [Segment(third + 1, pa * 0.85, "Colony lanes"), Segment(third, mid * 0.7, "Greenway"), Segment(third + 1, pb * 0.85, "Cross road")])
    return [main, green]


class HealthAdvisoryAgent(BaseAgent):
    name = "health_agent"
    subscribes = (FORECAST_UPDATED,)

    def __init__(self, bus, world: World, **kw: Any) -> None:  # type: ignore[no-untyped-def]
        super().__init__(bus, **kw)
        self.world = world
        self.cfg = load_yaml("health_advice_v1.yaml")

    async def handle(self, event: Event) -> None:
        area_id, aqi = event.payload["grid_id"], event.payload["aqi"]
        for profile in PROFILES:
            adv = build_advice(profile, 12, aqi, self.cfg)   # hour-specific advice is computed on request from the same rules
            self.world.advice[f"{area_id}|{profile}"] = adv["items"]
            await self.emit(event.child(ADVICE_UPDATED, {"community_id": area_id, "profile": profile, "advice": adv["items"]}))
        if area_id != "anand-vihar" or "anand-vihar" not in self.world.forecast:
            return
        # commute options from every other monitored area to Anand Vihar (the pilot neighbourhood) once forecasts exist
        for other in AREAS:
            if other.id not in self.world.forecast or other.id == area_id:
                continue
            opts = route_options(self.world, other.id, area_id)
            ch = recommend(opts, self.cfg["route"]["activity"], float(self.cfg["route"]["max_extra_minutes"]))
            payload = {"from": other.id, "to": area_id, "options": [_option_json(o, ch) for o in opts], "recommended": ch.recommended.id,
                       "reduction_pct": ch.reduction_pct, "extra_minutes": ch.extra_minutes}
            self.world.routes[f"{other.id}|{area_id}"] = payload
            await self.emit(event.child(ROUTE_COMPUTED, payload))


def _option_json(o: RouteOption, choice: Any) -> dict[str, Any]:
    from domain.dose import average_exposure, dose, exposure_reduction
    base = dose(choice.baseline.segments, "walking")
    return {"id": o.id, "name": o.name, "minutes": round(o.minutes), "avg_pm25": round(average_exposure(o.segments), 1),
            "reduction_pct": exposure_reduction(base, dose(o.segments, "walking")),
            "segments": [{"minutes": round(s.minutes), "pm25": round(s.pm25), "label": s.label} for s in o.segments]}
