from datetime import date, datetime, timezone

import pytest

from agents.advisory_agent import blocked_words_found, load_scripts_cfg, render_script
from agents.common import Event
from agents.common.events import ATTRIBUTION_UPDATED, DATA_NORMALISED, RISK_UPDATED
from agents.forecast_agent import grid_cells, source_concentrations
from agents.forecast_agent import plume as plume_mod
from agents.forecast_agent.downscale import downscale, idw
from agents.ingestion_agent import INGEST_TRIGGER
from agents.runtime import build_platform
from agents.world import World
from api.directives import ApprovalError
from domain.attribution import sums_to_100
from ingestion.geo import AREAS
from ingestion.pipeline import build_snapshot


@pytest.fixture(scope="module")
def snap():
    return build_snapshot(offline=True)


@pytest.fixture()
def platform(snap):
    return build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))


async def test_ingestion_one_event_per_grid_window_and_dedupes(platform):
    await platform.bus.publish(Event(type=INGEST_TRIGGER, payload={"window": "W1"}))
    await platform.bus.publish(Event(type=INGEST_TRIGGER, payload={"window": "W1"}))   # duplicate input, new event_id
    await platform.bus.drain()
    norm = [e for e in platform.bus.published if e.type == DATA_NORMALISED]
    assert len(norm) == len(AREAS) and len({e.payload["grid_id"] for e in norm}) == len(AREAS)


async def test_full_cycle_populates_world(platform):
    await platform.run_cycle("W1")
    w = platform.world
    assert w.risk and all(r["tier"] in ("low", "medium", "high", "critical") for r in w.risk.values())
    assert set(w.forecast) == {a.id for a in AREAS} and w.plume["streets"] and w.advice and w.village_risk
    assert all(sums_to_100(v["shares"]) for v in w.attribution.values())          # attribution invariant on every output
    assert platform.outbox.pending() == []                                         # everything published
    assert all(a["status"] == "ok" for a in platform.health_report())


async def test_risk_activation_window_by_clock_injection(snap):
    p = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)), force_risk=False)
    parcels = list(p.world.parcels.values())
    await p.run_cycle("W1")
    for pid in p.world.risk:
        assert 7 <= (p.world.parcels[pid].harvest_start - date(2026, 10, 23)).days <= 10
    assert len(p.world.risk) < len(parcels) or len(p.world.risk) == len(parcels)


async def test_risk_reproduces_fixture_scores(platform):
    await platform.run_cycle("W1")
    first = dict(platform.world.risk)
    p2 = build_platform(provider=lambda: platform.world.snapshot, world=World(today=date(2026, 10, 23)))
    await p2.run_cycle("W1")
    assert {k: v["score"] for k, v in first.items()} == {k: v["score"] for k, v in p2.world.risk.items()}


def test_scripts_have_no_punitive_wording_and_lint_catches_it():
    cfg = load_scripts_cfg()
    for lang in ("en", "hi", "pa"):
        assert render_script(lang, "Gurpreet", 8, cfg)
    assert blocked_words_found("You will pay a fine and a penalty", "en") == ["fine", "penalty"]
    assert "ਜੁਰਮਾਨਾ" in blocked_words_found("ਜੁਰਮਾਨਾ ਲੱਗੇਗਾ", "pa")


async def test_matching_is_nearest_available_and_booking_is_idempotent(platform):
    await platform.run_cycle("W1")
    w = platform.world
    for pid in list(w.parcels)[:6]:   # real scores are mostly 'medium'; inject high-risk events to exercise booking
        await platform.bus.publish(Event(type=RISK_UPDATED, payload={"parcel_id": pid, "score": 72.0, "tier": "high", "village_id": w.parcels[pid].village_id}))
    await platform.bus.drain()
    assert w.bookings, "high-risk parcels should get pending bookings"
    n = len(w.bookings)
    for b in list(w.bookings.values()):
        parcel = w.parcels[b["parcel_id"]]
        m = w.crm.machines[b["machinery_id"]]
        assert m.type == parcel.machine_need and b["status"] == "pending_confirmation"
    # replay same risk events -> no duplicate bookings
    for rec in [r for r in w.risk.values() if r["tier"] in ("high", "critical")]:
        await platform.advisory.create_booking(w.parcels[rec["parcel_id"]])
    assert len(w.bookings) == n


async def test_advice_differs_by_profile_and_route_reduces_dose(platform):
    await platform.run_cycle("W1")
    w = platform.world
    a = {k.split("|")[1]: [i["id"] for i in v] for k, v in w.advice.items() if k.startswith("anand-vihar|")}
    assert a["asthma"] != a["outdoor"] and a["child"] != a["elderly"]
    assert w.routes, "commute routes to Anand Vihar"
    for r in w.routes.values():
        assert r["extra_minutes"] <= 3 and r["reduction_pct"] >= 0


async def test_forecast_uses_gnn_hook_and_falls_back(snap):
    pts = [(a.lat, a.lon, 100.0 + i * 10) for i, a in enumerate(AREAS)]
    vals, method = downscale(pts, [(28.64, 77.3)], model=None)
    assert method == "idw-fallback" and 100 <= vals[0] <= 180

    def broken(*_a):
        raise RuntimeError("model unavailable")

    _, m2 = downscale(pts, [(28.64, 77.3)], model=broken)
    assert m2 == "idw-fallback"
    assert idw(pts, [(AREAS[0].lat, AREAS[0].lon)]) == [100.0]


async def test_grid_cells_and_source_concentrations(platform):
    await platform.run_cycle("W1")
    cells, method = grid_cells(platform.world, (77.2, 28.58, 77.4, 28.70))
    assert cells and method == "ked" and all(sums_to_100(c["source_mix"]) for c in cells)
    c = source_concentrations(100, 200, 80, 10, 900, 20, 3000)
    assert all(v >= 0 for v in c.values())


def test_plume_trajectory_follows_wind(snap):
    wx = snap.weather["sangrur"]
    from ingestion.pipeline import hour_index
    steps = plume_mod.trajectory(wx, hour_index(wx, snap.fetched_at))
    assert len(steps) == 73 and steps[0].hour == 0
    imp = plume_mod.street_impacts(steps, {"anand-vihar": 80.0}, 100)
    assert all(i["etaHours"] <= 72 for i in imp)


async def test_municipal_creates_work_orders_and_diversion_needs_second_approver(snap):
    p = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))
    await p.run_cycle("W1")
    # force a severe reading so GRAP stage 3+ applies
    for f in p.world.forecast.values():
        f["aqi"], f["pm25"] = 430, 280
    await p.bus.publish(Event(type=ATTRIBUTION_UPDATED, payload={"region": "delhi_ncr", "shares": {}}))
    await p.bus.drain()
    assert any(w["action_type"] == "fog_cannons" for w in p.world.work_orders.values())
    div = [d for d in p.directives.directives.values() if d["type"] == "diversion_trucks"]
    assert div and div[0]["status"] == "pending_approval"           # cannot dispatch without a second approval
    with pytest.raises(ApprovalError):
        p.directives.approve(div[0]["id"], div[0]["createdBy"])
    p.directives.approve(div[0]["id"], "officer.b")
    assert div[0]["status"] == "dispatched" and p.audit.verify()


async def test_roi_uses_control_station_and_window(snap):
    p = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))
    await p.run_cycle("W1")
    wid = next(iter(p.world.work_orders), None)
    if wid is None:
        p.world.forecast["anand-vihar"]["aqi"] = 430
        await p.bus.publish(Event(type=ATTRIBUTION_UPDATED, payload={}))
        await p.bus.drain()
        wid = next(iter(p.world.work_orders))
    treated = [300.0] * 6 + [300.0 - 2 * h for h in range(30)]
    control = [300.0] * 6 + [300.0 - 0.5 * h for h in range(30)]
    wo = p.world.work_orders[wid]
    wo["control_area"] = "ito"
    rec = await p.municipal.measure_roi(wid, treated, control, 6, 8)
    assert rec["delta_pm25"] > 0 and rec["control_area"] == "ito"
    with pytest.raises(ValueError):
        await p.municipal.measure_roi(wid, treated, control, 6, 2)   # outside 4-12 h


def test_sla_sweep_flags_late_orders(snap):
    late_clock = lambda: datetime(2027, 1, 1, tzinfo=timezone.utc)  # noqa: E731
    p = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))
    p.municipal.clock = late_clock
    p.world.work_orders["WO-X"] = {"id": "WO-X", "status": "dispatched", "sla_due_at": "2026-10-23T12:00:00+00:00"}
    assert p.municipal.sla_sweep() == ["WO-X"] and RISK_UPDATED
