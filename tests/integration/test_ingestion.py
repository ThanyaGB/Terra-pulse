"""Connector integration tests against recorded real-data fixtures; `-m live` ones hit the public APIs."""
from datetime import datetime, timezone

import pytest

from ingestion import calibration, clustering, firms, geo, ndvi, openmeteo
from ingestion.clustering import cluster
from ingestion.pipeline import build_snapshot, hour_index
from ingestion.quality import QualityTracker
from ingestion.rawstore import FileRawStore

FIX = firms.FIXTURE.read_text(encoding="utf8")


def test_firms_parse_filters_region_and_confidence():
    hs = firms.parse(FIX)
    assert hs, "fixture should contain hotspots inside Punjab/Haryana/Delhi window"
    assert all(geo.REGION_BBOX[1] <= h.lat <= geo.REGION_BBOX[3] and geo.REGION_BBOX[0] <= h.lon <= geo.REGION_BBOX[2] for h in hs)
    assert all(h.confidence in firms.CONFIDENCE_OK for h in hs)


def test_fire_clustering_is_deterministic_and_assigns_villages():
    hs = firms.parse(FIX)
    a, b = cluster(hs), cluster(list(reversed(hs)))
    assert a == b
    assert sum(c.fires for c in a) == len(hs)
    assert all(c.village_id is None or c.village_distance_km <= clustering.VILLAGE_RADIUS_KM for c in a)


def test_cluster_assignment_synthetic():
    v = geo.VILLAGES[0]
    pts = [firms.Hotspot(v.lat + d, v.lon, "2026-10-22T08:00:00Z", 5.0, "nominal", "D") for d in (0.0, 0.004, 0.008)]
    far = firms.Hotspot(31.9, 77.0, "2026-10-22T08:00:00Z", 5.0, "nominal", "D")
    cs = cluster(pts + [far])
    assert len(cs) == 2 and cs[0].fires == 3 and cs[0].village_id == v.id and cs[1].village_id is None


def test_openmeteo_fixture_has_pm25_and_winds():
    aq = openmeteo.load_fixture("openmeteo_aq_anand-vihar.json")
    wx = openmeteo.load_fixture("openmeteo_wx_sangrur.json")
    assert len(aq.times) >= 100 and "pm2_5" in aq.values and "wind_direction_100m" in wx.values
    assert any(v is not None and v > 0 for v in aq.values["pm2_5"])


def test_recorded_ndvi_and_slope():
    nd = ndvi.load_fixture()
    assert set(nd) == {v.id for v in geo.VILLAGES}
    assert all(-1 <= o.ndvi <= 1 for obs in nd.values() for o in obs)
    assert ndvi.slope_per_day([ndvi.NdviObs("2026-10-01", 0.6, "a"), ndvi.NdviObs("2026-10-11", 0.4, "b")]) == pytest.approx(-0.02)
    assert ndvi.ndvi(red=1000, nir=3000) == 0.5


def test_gap_filling_and_drift():
    filled, flags = calibration.fill_gaps([10, None, 30, None, None, 60])
    assert filled[1] == 20 and flags == [False, True, False, True, True, False] and filled[3] == pytest.approx(40, abs=0.01)
    f, _ = calibration.fill_gaps([None, 5.0], neighbours=[[8.0, 9.0]])
    assert f[0] == 8.0
    assert calibration.is_drifting([10, 11, 12, 13], [20, 21, 22, 23])
    assert calibration.calibrate([10, None], 2.0) == [20.0, None]


def test_quality_metrics():
    q = QualityTracker()
    now = datetime(2026, 10, 23, 12, 0, tzinfo=timezone.utc)
    q.record("firms", "live", now)
    q.stations = {"a": True, "b": False}
    s = q.summary(now)
    assert s["status"]["firms"] == "ok" and s["stations"] == {"online": 1, "total": 2}
    assert q.status("firms", datetime(2026, 10, 23, 14, 0, tzinfo=timezone.utc)) == "down"


def test_offline_snapshot_writes_raw_and_reports_quality(tmp_path):
    raw = FileRawStore(tmp_path)
    snap = build_snapshot(raw, offline=True)
    assert snap.clusters and len(snap.air) == len(geo.AREAS) and snap.fires_by_village is not None
    assert snap.quality.summary()["origin"]["firms"] == "fixture"
    assert raw.list("firms")
    assert 0 <= hour_index(snap.air["anand-vihar"], snap.fetched_at) < len(snap.air["anand-vihar"].times)


@pytest.mark.live
def test_live_firms_and_openmeteo():
    hs, origin = firms.fetch()
    assert origin == "live" and hs
    s = openmeteo.fetch_air(geo.AREAS[0])
    assert s.values["pm2_5"]
