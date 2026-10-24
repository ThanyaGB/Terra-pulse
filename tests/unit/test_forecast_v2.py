"""T2.3 / T2.4 / T2.8: weights from config, kriging with external drift, CPCB correction, degraded mode, GNN off, calibration."""
import hashlib
import importlib.util
import json
import random
from datetime import date
from pathlib import Path

import pytest

from agents.forecast_agent import ForecastAttributionAgent
from agents.forecast_agent import correction as corr
from agents.forecast_agent.downscale import downscale, load_model
from agents.forecast_agent.kriging import KrigingError, ked, leave_one_out_rmse, rmse
from agents.runtime import build_platform
from agents.world import World
from domain import risk
from domain.calibration import calibration_report
from domain.config import ROOT_CONFIG_DIR, load_yaml
from domain.features import FeatureFlags
from ingestion import osm
from ingestion.cpcb import StationReading
from ingestion.geo import AREAS
from ingestion.pipeline import build_snapshot

ROOT = Path(__file__).resolve().parents[2]
KCFG = load_yaml("forecast.yaml")["kriging"]


def _field(lat: float, lon: float) -> float:
    cov = osm.covariates_at(lat, lon)
    return 40 + 6 * cov[0] + 30 * cov[1]


PTS = [(a.lat, a.lon, _field(a.lat, a.lon)) for a in AREAS]
DRIFT = [osm.covariates_at(p[0], p[1]) for p in PTS]


# ---------- risk weights (T2.3) ----------
def test_risk_weights_load_from_root_config_and_match_spec_priors():
    cfg = risk.load_weights()
    assert (ROOT_CONFIG_DIR / "risk_weights.yaml").exists() and not (ROOT / "packages/domain/config/risk_weights.yaml").exists()
    assert cfg["weights"] == {"sowing_window_days_remaining": 0.30, "ndvi_decay_slope": 0.25, "local_machinery_shortfall": 0.20,
                              "historical_fire_density": 0.15, "soil_moisture_index": 0.10}
    assert cfg["tiers"] == {"medium": 35, "high": 60, "critical": 80}


def test_risk_score_follows_config_not_code():
    cfg = risk.load_weights()
    cfg["weights"] = {k: 0.0 for k in cfg["weights"]} | {"soil_moisture_index": 1.0}
    assert risk.risk_score(risk.RiskInputs(-0.03, 0, 0.5, 1.0, 1.0), cfg).score == 50.0


# ---------- kriging (T2.4) ----------
def test_ked_recovers_a_covariate_driven_field_better_than_idw():
    targets = [(28.62, 77.26), (28.70, 77.10), (28.58, 77.30)]
    want = [_field(*t) for t in targets]
    got, method = downscale(PTS, targets, drift=(DRIFT, [osm.covariates_at(*t) for t in targets]))
    idw_vals, idw_method = downscale(PTS, targets)
    assert method == "ked" and idw_method == "idw-fallback"
    assert rmse(got, want) < rmse(idw_vals, want)


def test_ked_reproduces_observations_at_their_own_locations():
    got = ked(PTS, DRIFT, [(p[0], p[1]) for p in PTS[:3]], DRIFT[:3], KCFG)
    assert all(abs(g - p[2]) < 1e-6 for g, p in zip(got, PTS[:3]))


def test_ked_falls_back_to_idw_when_unsolvable():
    few = PTS[:3]
    with pytest.raises(KrigingError):
        ked(few, DRIFT[:3], [(28.6, 77.2)], [DRIFT[0]], KCFG)
    vals, method = downscale(few, [(28.6, 77.2)], drift=(DRIFT[:3], [DRIFT[0]]))
    assert method == "idw-fallback" and vals[0] > 0
    flat = [[1.0, 1.0]] * len(PTS)
    assert downscale(PTS, [(28.6, 77.2)], drift=(flat, [[1.0, 1.0]]))[1] == "idw-fallback"


def test_leave_one_out_rmse_is_reported():
    assert 0 <= leave_one_out_rmse(PTS, DRIFT, KCFG) < 60
    assert rmse([1, 2, 3], [1, 2, 3]) == 0.0


def test_osm_covariates_are_flagged_as_placeholders():
    assert osm.is_placeholder()


# ---------- CPCB correction ----------
def test_cpcb_correction_scales_station_areas_and_fades():
    cfg = load_yaml("forecast.yaml")["cpcb_correction"]
    now = {a.id: 100.0 for a in AREAS}
    ratios = corr.area_ratios([StationReading("Anand Vihar, Delhi - DPCC", "Delhi", "PM2.5", 150.0, "x"),
                               StationReading("Patparganj, Delhi - DPCC", "Delhi", "PM2.5", 120.0, "x"),
                               StationReading("Anand Vihar, Delhi - DPCC", "Delhi", "NO2", 10.0, "x")], now, cfg)
    assert ratios["anand-vihar"] == (1.5, "station") and ratios["patparganj"] == (1.2, "station")
    assert ratios["rohini"][1] == "regional" and 1.0 < ratios["rohini"][0] < 1.2
    s = corr.correct_series([100.0] * 80, 1.5, 24)
    assert s[0] == 150.0 and s[-1] < 105 and s == sorted(s, reverse=True)
    assert corr.area_ratios(None, now, cfg) == {}
    assert corr.area_ratios([StationReading("Anand Vihar", "Delhi", "PM2.5", 900.0, "x")], now, cfg)["anand-vihar"][0] == 2.0   # clamped


# ---------- GNN off by default ----------
def test_gnn_path_is_off_by_default_even_with_an_artifact(tmp_path, monkeypatch):
    art = tmp_path / "m.pt"
    art.write_bytes(b"x")
    monkeypatch.setenv("VAYU_GNN_ARTIFACT", str(art))
    assert load_model() is None and load_model(enabled=False) is None
    assert FeatureFlags.load().enabled("FORECAST_GNN_ENABLED") is False
    plat = build_platform(provider=lambda: build_snapshot(offline=True))
    assert plat.forecast.model is None and plat.forecast.method == "ked"

    def sentinel(points, targets):
        return [1.0] * len(targets)

    assert ForecastAttributionAgent(plat.bus, World(), model=sentinel).model is None                       # flag off: injected model ignored
    assert ForecastAttributionAgent(plat.bus, World(), model=sentinel, gnn_enabled=True).method == "gnn"


# ---------- agent: fallback flag and last good grid ----------
async def test_degraded_mode_reuses_last_good_grid_and_sets_fallback_flag():
    snap = build_snapshot(offline=True)
    snap.quality.record("cams", "live")
    plat = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))
    await plat.run_cycle("W1")
    good = {k: v["pm25"] for k, v in plat.world.forecast.items()}
    assert all(v["fallback_flag"] is False for v in plat.world.forecast.values())
    late = build_snapshot(offline=True)            # CAMS late: origin is the recorded fixture
    for a_id in late.air:
        late.air[a_id].values["pm2_5"] = [999.0] * len(late.air[a_id].times)
    plat.ingestion.provider = lambda: late
    await plat.run_cycle("W2")
    assert {k: v["pm25"] for k, v in plat.world.forecast.items()} == good
    assert all(v["fallback_flag"] is True for v in plat.world.forecast.values())


async def test_cpcb_readings_correct_the_forecast():
    snap = build_snapshot(offline=True)
    plat0 = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))
    await plat0.run_cycle("W1")
    base = plat0.world.forecast["anand-vihar"]["pm25"]
    snap2 = build_snapshot(offline=True)
    snap2.cpcb_readings = [StationReading("Anand Vihar, Delhi - DPCC", "Delhi", "PM2.5", base * 1.4, "x")]
    plat = build_platform(provider=lambda: snap2, world=World(today=date(2026, 10, 23)))
    await plat.run_cycle("W1")
    f = plat.world.forecast["anand-vihar"]
    assert f["cpcb_corrected"] == "station" and f["pm25"] == pytest.approx(base * 1.4, rel=0.02)


# ---------- calibration (T2.8) ----------
def _samples(n: int = 120, seed: int = 7) -> str:
    rnd = random.Random(seed)
    rows = ["sowing_window_days_remaining,ndvi_decay_slope,local_machinery_shortfall,historical_fire_density,soil_moisture_index,burned"]
    for _ in range(n):
        sow, ndvi, mach, fire, soil = rnd.uniform(0, 21), rnd.uniform(-0.03, 0), rnd.random(), rnd.uniform(0, 0.5), rnd.random()
        p = 0.1 + 0.8 * (0.6 * mach + 0.4 * (1 - sow / 21))
        rows.append(f"{sow:.2f},{ndvi:.4f},{mach:.3f},{fire:.3f},{soil:.3f},{1 if rnd.random() < p else 0}")
    return "\n".join(rows) + "\n"


def test_calibration_report_is_reproducible_and_leaves_config_alone():
    path = ROOT_CONFIG_DIR / "risk_weights.yaml"
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    a, b = calibration_report(_samples()), calibration_report(_samples())
    assert a == b and a["applied"] is False and a["r2_proposed"] >= a["r2_current"] - 1e-9
    assert abs(sum(a["proposed_weights"].values()) - 1) < 1e-3 and min(a["proposed_weights"].values()) >= 0
    assert a["proposed_weights"]["local_machinery_shortfall"] > a["proposed_weights"]["soil_moisture_index"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    with pytest.raises(ValueError, match="at least 30"):
        calibration_report(_samples(10))


def test_calibration_script_needs_calibration_mode_and_writes_only_a_report(tmp_path):
    spec = importlib.util.spec_from_file_location("calibrate_risk", ROOT / "scripts/calibrate_risk.py")
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    samples = tmp_path / "s.csv"
    samples.write_text(_samples(), encoding="utf8")
    cfg_hash = hashlib.sha256((ROOT_CONFIG_DIR / "risk_weights.yaml").read_bytes()).hexdigest()
    with pytest.raises(SystemExit, match="CALIBRATION_MODE is off"):
        mod.run(samples, tmp_path / "r.json", FeatureFlags.load())
    assert not (tmp_path / "r.json").exists()
    flags = FeatureFlags.load()
    flags.change("CALIBRATION_MODE", True, "admin-a")
    rep = mod.run(samples, tmp_path / "r.json", flags)
    assert json.loads((tmp_path / "r.json").read_text(encoding="utf8")) == rep
    assert hashlib.sha256((ROOT_CONFIG_DIR / "risk_weights.yaml").read_bytes()).hexdigest() == cfg_hash
