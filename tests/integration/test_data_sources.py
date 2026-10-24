"""T1.7 / T1.4 / T1.6: the registry gates every connector; CAMS and ERA5 run from recorded fixtures; the baseline is reproducible."""
import importlib.util
import json
import random
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

from domain.data_sources import SEED, DataSource, SourceNotRegistered, SourceRegistry, default_registry, licences_markdown
from ingestion import baseline, cams, cpcb, crm, era5, firms, ndvi
from ingestion.geo import AREAS, SANGRUR, VILLAGES

ROOT = Path(__file__).resolve().parents[2]
EMPTY = SourceRegistry([])


def test_every_spec_source_is_registered():
    reg = default_registry()
    for sid in ("firms", "sentinel2", "cpcb", "cams", "era5", "osm", "iot", "crm"):
        assert reg.require(sid).attribution
    assert reg.get("imd") is None          # raw IMD feeds are not used in v2.0


@pytest.mark.parametrize("call", [
    lambda: firms.fetch(None, offline=True, registry=EMPTY),
    lambda: cpcb.fetch("key", registry=EMPTY),
    lambda: cams.fetch_air(AREAS[0], offline=True, registry=EMPTY),
    lambda: era5.fetch(SANGRUR, offline=True, registry=EMPTY),
    lambda: ndvi.observe(VILLAGES[0], registry=EMPTY),
    lambda: ndvi.load_fixture(registry=EMPTY),
    lambda: crm.SimulatedCrm(registry=EMPTY),
])
def test_connector_refuses_unregistered_source(call):
    with pytest.raises(SourceNotRegistered):
        call()


def test_connector_refuses_when_only_its_own_row_is_missing():
    reg = SourceRegistry(r for r in SEED if r.source_id != "cams")
    with pytest.raises(SourceNotRegistered):
        cams.fetch_air(AREAS[0], offline=True, registry=reg)
    assert cams.fetch_air(AREAS[0], offline=True, registry=SourceRegistry(SEED))[1] == "fixture"


def test_cams_and_era5_connectors_return_recorded_fixtures():
    air, origin = cams.fetch_air(AREAS[0], offline=True)
    assert origin == "fixture" and "pm2_5" in air.values and len(air.times) > 48
    met, origin = era5.fetch(SANGRUR, offline=True)
    assert origin == "fixture" and {"boundary_layer_height", "wind_speed_10m", "temperature_2m"} <= set(met.values)


def test_attribution_lines_cover_shown_sources_only():
    lines = default_registry().attribution_lines(["firms", "cams", "era5", "osm", "crm"])
    assert "Copernicus Atmosphere Monitoring Service" in lines and "© OpenStreetMap contributors" in lines and "Internal" not in lines


def test_migration_seed_matches_the_registry_seed():
    spec = importlib.util.spec_from_file_location("m0002", ROOT / "db/migrations/versions/0002_v2_scope.py")
    m = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(m)  # type: ignore[union-attr]
    want = [(r.source_id, r.name, r.data, r.cadence, r.licence, r.attribution, r.redistribution, r.shown_in_ui) for r in SEED]
    assert m.DATA_SOURCES == want
    assert "CREATE TABLE data_source" in m.DDL and "CREATE TABLE partner_contract" in m.DDL and "CREATE TABLE work_order_event" in m.DDL


def test_data_licences_doc_is_generated_from_the_registry():
    doc = (ROOT / "docs" / "data-licences.md").read_text(encoding="utf8").replace("\r\n", "\n")
    assert doc == licences_markdown()
    r = subprocess.run([sys.executable, "scripts/gen_data_licences.py", "--check"], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout


# ---------- baseline (T1.6) with synthetic archive files ----------
def _firms_csv(rng: random.Random) -> str:
    rows = ["latitude,longitude,acq_date,acq_time,confidence,frp,daynight"]
    for year in (2022, 2023, 2024, 2025):
        for _ in range(30):
            v = rng.choice(VILLAGES)
            rows.append(f"{v.lat + rng.uniform(-0.03, 0.03):.4f},{v.lon + rng.uniform(-0.03, 0.03):.4f},{year}-{rng.choice([9, 10, 11])}-{rng.randint(1, 28):02d},0830,nominal,12.5,D")
    rows.append("19.0,72.8,2024-10-10,0830,nominal,9,D")      # Mumbai: outside every village radius
    rows.append(f"{VILLAGES[0].lat},{VILLAGES[0].lon},2024-10-11,0830,low,9,D")   # low confidence: dropped
    return "\n".join(rows) + "\n"


def _cpcb_csv(rng: random.Random, city: str = "Delhi") -> str:
    rows = ["station,city,ts,pm25"]
    start = date(2025, 8, 1)
    for i in range(60):
        base = 80 + 0.5 * i
        for st, off, noise in (("anand-vihar", 20, 3), ("patparganj", 10, 3), ("dwarka", 0, 3), ("rohini", 5, 3), ("ito", -10, 25)):
            d = (start + timedelta(days=i)).isoformat()
            wiggle = 15 * ((i * 7) % 5) / 5 if st == "ito" else 0
            rows.append(f"{st},{city},{d}T12:00,{base + off + rng.uniform(-noise, noise) + wiggle:.1f}")
    return "\n".join(rows) + "\n"


def test_baseline_is_reproducible_and_filters_correctly(tmp_path):
    f, c = _firms_csv(random.Random(1)), _cpcb_csv(random.Random(2))
    a = baseline.build_baseline(f, c, pre_end="2025-09-30")
    b = baseline.build_baseline(f, c, pre_end="2025-09-30")
    assert a["snapshot_id"] == b["snapshot_id"] and a["snapshot_id"].startswith("BL-")
    fire = a["body"]["fire"]
    assert set(fire["total_by_year"]) == {"2023", "2024", "2025"}          # 2022 excluded
    assert all(d[5:7] in ("10", "11") for d in fire["per_day"])             # September excluded
    assert sum(fire["total_by_year"].values()) == sum(fire["per_day"].values())
    pre = a["body"]["air"]["pre_period"]
    assert {"dwarka", "rohini"} <= set(pre["selected"])
    path = baseline.save(a, tmp_path)
    assert baseline.verify(path)
    path.write_text(path.read_text(encoding="utf8").replace("anand-vihar", "tampered", 1), encoding="utf8")
    assert not baseline.verify(path)
    assert baseline.build_baseline(f, c, pre_end="2025-09-29")["snapshot_id"] != a["snapshot_id"]


def test_baseline_rejects_non_delhi_stations_and_unregistered_sources():
    with pytest.raises(baseline.BaselineError, match="Delhi stations only"):
        baseline.build_baseline(_firms_csv(random.Random(1)), _cpcb_csv(random.Random(2), city="Sangrur"), "2025-09-30")
    with pytest.raises(SourceNotRegistered):
        baseline.build_baseline("", "", "2025-09-30", registry=SourceRegistry([DataSource("x", "x", "x", "x", "x", "x", "x")]))


def test_baseline_needs_enough_pre_period_days():
    with pytest.raises(baseline.BaselineError, match="pre-period days"):
        baseline.build_baseline(_firms_csv(random.Random(1)), _cpcb_csv(random.Random(2)), pre_end="2025-08-05")


def test_baseline_config_names_no_sangrur_station():
    from domain.config import load_yaml
    cfg = load_yaml("baseline.yaml")["cpcb"]
    assert cfg["city"] == "Delhi" and not any("sangrur" in s for s in cfg["treated"] + cfg["control_candidates"])
    json.dumps(cfg)
