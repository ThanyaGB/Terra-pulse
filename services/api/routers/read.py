"""Read endpoints (T3.2): aqi, plume, attribution, roi, pipeline, machinery, advice, routes."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from agents.forecast_agent import grid_cells
from agents.forecast_agent import plume as plume_mod
from agents.forecast_agent.downscale import downscale
from agents.health_agent import build_advice, route_options_between
from api.pagination import paginate
from api.problem import ProblemError
from api.security import Principal, require_roles
from domain import aqi as aqi_domain
from domain import roi as roi_domain
from domain.config import load_yaml
from domain.dose import average_exposure, dose, exposure_reduction
from domain.grap import grap_tier
from domain.routing import recommend
from ingestion.geo import AREAS, NEIGHBOURHOODS, SANGRUR, Place
from ingestion.pipeline import hour_index

router = APIRouter()
AREA_IDS = {a.id for a in AREAS}
STRAW_TARGET_TONNES = 5000.0   # pilot season target, a placeholder until set with the FPO


def platform(request: Request) -> Any:
    return request.app.state.platform


NEIGHBOURHOOD = {p.id: (p, detail, parent) for p, detail, parent in NEIGHBOURHOODS}


def _area(request: Request, area_id: str) -> dict[str, Any]:
    """A monitored area, or a pilot neighbourhood downscaled from the monitored areas around it."""
    w = platform(request).world
    f = w.forecast.get(area_id)
    if f is not None:
        return f  # type: ignore[no-any-return]
    if area_id in NEIGHBOURHOOD and w.forecast:
        place, _, parent = NEIGHBOURHOOD[area_id]
        pts = [(v["lat"], v["lng"], v["pm25"]) for v in w.forecast.values()]
        (pm,), _method = downscale(pts, [(place.lat, place.lon)])
        base = w.forecast[parent]
        return {**base, "area_id": area_id, "name": place.name, "lat": place.lat, "lng": place.lon, "pm25": round(pm, 1),
                "aqi": aqi_domain.pm25_to_aqi(pm), "parent": parent}
    raise ProblemError(404, "Community not found", f"No community {area_id!r}. Known: {', '.join(sorted(AREA_IDS | set(NEIGHBOURHOOD)))}.")


def _need_data(request: Request) -> None:
    if platform(request).world.snapshot is None:
        raise ProblemError(503, "Data not ready", "The first ingestion cycle has not completed yet.", headers={"Retry-After": "10"})


def _windows(request: Request) -> list[dict[str, Any]]:
    """Time-windowed alerts from real forecast weather at Anand Vihar: low boundary layer = inversion, high = ventilation."""
    w = platform(request).world
    snap = w.snapshot
    if snap is None or "anand-vihar" not in snap.weather:
        return []
    wx = snap.weather["anand-vihar"]
    i0 = hour_index(wx, snap.fetched_at)
    day_start = i0 - int(wx.times[i0][11:13])   # index of today's 00:00 local
    out: list[dict[str, Any]] = []

    def run(pred: Any, lo: int, hi: int) -> tuple[int, int] | None:
        hrs = [h for h in range(lo, hi) if (v := wx.at("boundary_layer_height", day_start + h)) is not None and pred(v, wx.at("wind_speed_10m", day_start + h) or 0)]
        return (hrs[0], hrs[-1] + 1) if hrs else None

    inv = run(lambda pbl, ws: pbl < 400 and ws < 8, 5, 12)
    if inv:
        out.append({"id": "inversion", "kind": "inversion", "title": "Morning inversion: smoke is trapped near the ground",
                    "body": "Boundary layer is shallow and winds are light. Avoid outdoor exercise until it lifts.",
                    "startMin": inv[0] * 60, "endMin": inv[1] * 60, "severity": "warning"})
    ven = run(lambda pbl, ws: pbl > 900 and ws >= 6, 11, 18)
    if ven:
        out.append({"id": "ventilation", "kind": "ventilation", "title": "Ventilation window: air is clearing",
                    "body": "The boundary layer deepens and the wind picks up. Best time to air out rooms and run errands.",
                    "startMin": ven[0] * 60, "endMin": ven[1] * 60, "severity": "info"})
    out.append({"id": "traffic", "kind": "peak_traffic", "title": "Evening traffic peak", "body": "Avoid arterial roads; prefer inner lanes.",
                "startMin": 17 * 60 + 30, "endMin": 20 * 60 + 30, "severity": "warning"})
    return out


@router.get("/aqi/grid", summary="1 km grid AQI with source mix")
def aqi_grid(request: Request, bbox: str = Query(..., description="min_lon,min_lat,max_lon,max_lat"), time: str | None = None,
             limit: int = Query(500, ge=1, le=2500), cursor: str | None = None,
             _: Principal = Depends(require_roles("citizen", "policy_officer"))) -> dict[str, Any]:
    _need_data(request)
    try:
        b = tuple(float(x) for x in bbox.split(","))
        if len(b) != 4 or not (b[0] < b[2] and b[1] < b[3]):
            raise ValueError
    except ValueError as exc:
        raise ProblemError(400, "Invalid bbox", "Use min_lon,min_lat,max_lon,max_lat with min < max.") from exc
    cells, method = grid_cells(platform(request).world, b)
    page = paginate(cells, limit, cursor)
    return {"bbox": list(b), "grid_resolution_km": 1.0, "method": method, "time": time or "now", **page}


@router.get("/aqi/communities", summary="Monitored communities (extension)")
def communities(request: Request, _: Principal = Depends(require_roles("citizen", "policy_officer"))) -> list[dict[str, Any]]:
    return [{"id": p.id, "name": p.name, "detail": d} for p, d, _ in NEIGHBOURHOODS] +            [{"id": a.id, "name": a.name, "detail": f"Delhi-NCR · {a.lat:.3f}, {a.lon:.3f}"} for a in AREAS]


@router.get("/aqi/community/{community_id}", summary="Community AQI card and source mix")
def community(request: Request, community_id: str, time: str | None = None, _: Principal = Depends(require_roles("citizen"))) -> dict[str, Any]:
    _need_data(request)
    f = _area(request, community_id)
    shares = platform(request).world.attribution[f.get("parent", community_id)]["shares"]
    g = grap_tier(f["aqi"], shares)
    return {"community_id": community_id, "name": f["name"], "location": {"lat": f["lat"], "lng": f["lng"]}, "pm25": f["pm25"], "aqi": f["aqi"],
            "band": aqi_domain.band(f["aqi"]), "source_mix": shares, "grap_tier": g.tier, "alerts": _windows(request),
            "forecast_24h": f["series"][:25], "health_advice_url": f"/v1/health/advice?community_id={community_id}", "updated_at": f["updated_at"]}


@router.get("/plume/projection", summary="Plume arrival timeline per street")
def plume_projection(request: Request, origin: str = Query("sangrur"), hours: int = Query(72, ge=1, le=72),
                     _: Principal = Depends(require_roles("policy_officer"))) -> dict[str, Any]:
    _need_data(request)
    w = platform(request).world
    if origin in ("sangrur", "") or origin == SANGRUR.id:
        out = dict(w.plume)
    else:
        try:
            lat, lon = (float(x) for x in origin.split(","))
        except ValueError as exc:
            raise ProblemError(400, "Invalid origin", "Use 'sangrur' or 'lat,lon'.") from exc
        snap = w.snapshot
        assert snap is not None
        wx = snap.weather["sangrur"]   # the only upwind wind source recorded; custom origins reuse its winds
        steps = plume_mod.trajectory(wx, hour_index(wx, snap.fetched_at), Place("custom", "custom", lat, lon))
        base = {k: v["pm25"] for k, v in w.forecast.items()}
        out = {**w.plume, "corridor": [[round(s.lon, 4), round(s.lat, 4)] for s in steps[::6]],
               "hoursToReachNcr": plume_mod.hours_to_reach_ncr(steps), "streets": plume_mod.street_impacts(steps, base, 100.0)}
    out["horizonHours"] = hours
    out["streets"] = [s for s in out["streets"]]
    return out


@router.get("/attribution/summary", summary="Source attribution matrix")
def attribution_summary(request: Request, region: str = Query("delhi_ncr"), _: Principal = Depends(require_roles("policy_officer"))) -> dict[str, Any]:
    _need_data(request)
    w = platform(request).world
    key = "ncr" if region in ("delhi_ncr", "ncr") else region
    if key not in w.attribution:
        raise ProblemError(404, "Region not found", f"Use 'delhi_ncr' or one of: {', '.join(sorted(AREA_IDS))}.")
    cells = [{"id": a.id, "label": a.name, "lat": a.lat, "lng": a.lon} for a in AREAS]
    return {"region": region, "shares": w.attribution[key]["shares"], "dominant_source": w.attribution[key]["dominant"],
            "ncr_shares": w.attribution["ncr"]["shares"], "cells": cells, "method": "proxy-model (FIRMS upwind FRP, NO2, PM10-PM2.5, SO2/CO)",
            "computed_at": w.forecast[next(iter(w.forecast))]["updated_at"]}


@router.get("/health/advice", summary="Profile-specific advice")
def health_advice(request: Request, profile: str = Query("general"), community_id: str = Query("anand-vihar"), time: str | None = None,
                  _: Principal = Depends(require_roles("citizen"))) -> dict[str, Any]:
    _need_data(request)
    cfg = load_yaml("health_advice_v1.yaml")
    if profile not in cfg["profile_base"]:
        raise ProblemError(400, "Unknown profile", f"Use one of: {', '.join(cfg['profile_base'])}.")
    f = _area(request, community_id)
    try:
        hour = datetime.fromisoformat(time).hour + datetime.fromisoformat(time).minute / 60 if time else (datetime.now(timezone.utc) + timedelta(hours=5.5)).hour
    except ValueError:
        try:
            hour = float(time)  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise ProblemError(400, "Invalid time", "Use an ISO timestamp or a local hour 0-23.") from exc
    return {**build_advice(profile, hour, f["aqi"], cfg), "community_id": community_id, "aqi": f["aqi"]}


@router.get("/routes/clean", summary="Clean commute options")
def routes_clean(request: Request, from_: str = Query(..., alias="from"), to: str = Query(...), profile: str = "general",
                 _: Principal = Depends(require_roles("citizen"))) -> dict[str, Any]:
    _need_data(request)
    _area(request, from_)
    _area(request, to)
    if from_ == to:
        raise ProblemError(400, "Invalid route", "'from' and 'to' must differ.")
    opts = route_options_between(_area(request, from_), _area(request, to))
    cfg = load_yaml("health_advice_v1.yaml")["route"]
    activity = {"outdoor": "cycling", "child": "walking"}.get(profile, cfg["activity"])
    ch = recommend(opts, activity, float(cfg["max_extra_minutes"]))
    base = dose(ch.baseline.segments, activity)
    return {"from": from_, "to": to, "recommended": ch.recommended.id, "extra_minutes": ch.extra_minutes, "reduction_pct": ch.reduction_pct,
            "options": [{"id": o.id, "name": o.name, "minutes": round(o.minutes), "avg_pm25": round(average_exposure(o.segments), 1),
                         "avg_aqi": aqi_domain.pm25_to_aqi(average_exposure(o.segments)),
                         "reduction_pct": exposure_reduction(base, dose(o.segments, activity)),
                         "segments": [{"minutes": round(s.minutes), "pm25": round(s.pm25), "aqi": aqi_domain.pm25_to_aqi(s.pm25), "label": s.label} for s in o.segments]}
                        for o in opts]}


@router.get("/machinery/status", summary="Machinery status and utilisation")
def machinery_status(request: Request, _: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    ms = platform(request).world.crm.list_machines()
    labels = {"super_seeder": "Super Seeder", "baler": "Baler", "happy_seeder": "Happy Seeder"}
    types = []
    for t, label in labels.items():
        mine = [m for m in ms if m.type == t]
        in_use = sum(1 for m in mine if m.status == "in_use")
        types.append({"type": t, "label": label, "total": len(mine), "in_use": in_use, "utilisation_pct": round(in_use / len(mine) * 100) if mine else 0})
    return {"types": types, "machines": [{"id": m.id, "type": m.type, "status": m.status, "pto_hours": m.pto_hours, "lat": round(m.lat, 4), "lon": round(m.lon, 4),
                                          "operator_name": m.operator_name, "operator_phone": m.operator_phone, "version": m.version} for m in ms],
            "conflicts": [c.__dict__ for c in platform(request).advisory.sync.fpo_queue]}


@router.get("/roi/summary", summary="ROI and compliance metrics per pilot area")
def roi_summary(request: Request, _: Principal = Depends(require_roles("policy_officer", "admin"))) -> dict[str, Any]:
    p = platform(request)
    w = p.world
    ledger = p.advisory.partner.ledger
    ms = w.crm.list_machines()
    fog = [x for x in w.work_orders.values() if x["action_type"] == "fog_cannons"]
    recs = [roi_domain.RoiRecord(r["work_order_id"], r["area"], r["delta_pm25"]) for r in w.roi]
    streets = []
    for aid, f in w.forecast.items():
        later = f["series"][min(12, len(f["series"]) - 1)]["pm25"] if f["series"] else f["pm25"]
        streets.append({"id": aid, "name": f["name"], "beforePm25": round(f["pm25"]), "afterPm25": round(later)})
    return {"by_area": roi_domain.aggregate(recs), "measurements": w.roi,
            "compliance": {"strawCollectedTonnes": round(sum(e.tonnes for e in ledger), 1), "strawTargetTonnes": STRAW_TARGET_TONNES,
                           "chc": {"utilisationPct": round(100 * sum(1 for m in ms if m.status == "in_use") / max(1, len(ms))),
                                   "machinesInUse": sum(1 for m in ms if m.status == "in_use"), "machinesTotal": len(ms)},
                           "fogCannons": {"inTransit": sum(1 for x in fog if x["status"] in ("created", "accepted")), "deployed": sum(1 for x in fog if x["status"] == "completed"),
                                          "planned": len(fog)},
                           "monitoredStreets": streets, "note": "after = model projection 12 h ahead until measured ROI exists"},
            "work_orders": list(w.work_orders.values()), "sla_breached": sum(1 for x in w.work_orders.values() if x.get("sla_breached"))}


@router.get("/pipeline/health", summary="Ingestion and agent status")
def pipeline_health(request: Request, _: Principal = Depends(require_roles("policy_officer", "admin"))) -> dict[str, Any]:
    p = platform(request)
    snap = p.world.snapshot
    q = snap.quality.summary() if snap else {}
    return {"quality": q, "agents": p.health_report(),
            "fires": {"active": len(snap.hotspots) if snap else 0, "clusters": len(snap.clusters) if snap else 0},
            "telephony": {"active_provider": request.app.state.telephony.active}}
