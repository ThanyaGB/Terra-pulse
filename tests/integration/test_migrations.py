"""T1.1. Static checks always run; the up/down + hypertable + spatial-index test needs a real PostGIS/TimescaleDB
(`docker compose up -d postgres`, then VAYU_TEST_DATABASE_URL=postgresql+psycopg://vayu:vayu@localhost:5432/vayu)."""
import importlib.util
import os
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("m0001", ROOT / "db/migrations/versions/0001_schema.py")
m = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
spec.loader.exec_module(m)  # type: ignore[union-attr]

SPEC_TABLES = {"parcel", "village", "grid_cell_1km", "street_segment", "station", "aqi_reading", "sensor_reading", "fire_hotspot", "machine_telemetry",
               "weather_obs", "risk_score", "call", "booking", "collection_request", "work_order", "directive", "roi_measurement", "citizen_report", "audit_event"}


def test_migration_declares_every_table_in_spec_6_2():
    ddl = m.SPATIAL + m.OPERATIONAL + " ".join(f"CREATE TABLE {n} (" for n, _, _ in m.HYPERTABLES)
    created = set(re.findall(r"CREATE TABLE (\w+)", ddl))
    assert SPEC_TABLES <= created, SPEC_TABLES - created


def test_hypertables_and_spatial_indexes_are_declared():
    assert {n for n, _, _ in m.HYPERTABLES} == {"aqi_reading", "sensor_reading", "fire_hotspot", "machine_telemetry", "weather_obs"}
    assert len(re.findall(r"USING GIST", m.SPATIAL)) >= 5


def test_audit_table_is_append_only_and_chained():
    assert "prev_hash CHAR(64) NOT NULL" in m.OPERATIONAL and "BEFORE UPDATE OR DELETE ON audit_event" in m.OPERATIONAL


def test_two_person_rule_is_enforced_in_the_schema_too():
    assert "approved_by <> created_by" in m.OPERATIONAL


def test_every_downgrade_table_is_created_by_upgrade():
    created = set(re.findall(r"CREATE TABLE (\w+)", m.SPATIAL + m.OPERATIONAL)) | {n for n, _, _ in m.HYPERTABLES}
    dropped = set(m.OPERATIONAL_TABLES) | set(m.SPATIAL_TABLES) | {n for n, _, _ in m.HYPERTABLES}
    assert dropped <= created


@pytest.mark.skipif(not os.environ.get("VAYU_TEST_DATABASE_URL"), reason="needs PostGIS + TimescaleDB (docker compose up -d postgres)")
def test_migrations_up_and_down_on_a_clean_database():
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import create_engine, text
    os.environ["VAYU_DATABASE_URL"] = os.environ["VAYU_TEST_DATABASE_URL"]
    cfg = Config(str(ROOT / "db/alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "db/migrations"))
    eng = create_engine(os.environ["VAYU_TEST_DATABASE_URL"])
    command.upgrade(cfg, "head")
    with eng.connect() as c:
        hts = {r[0] for r in c.execute(text("SELECT hypertable_name FROM timescaledb_information.hypertables"))}
        assert hts == {"aqi_reading", "sensor_reading", "fire_hotspot", "machine_telemetry", "weather_obs"}
        idx = {r[0] for r in c.execute(text("SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%gist%'"))}
        assert {"parcel_geom_gix", "village_geom_gix", "grid_geom_gix"} <= idx
    command.downgrade(cfg, "base")
    with eng.connect() as c:
        assert c.execute(text("SELECT to_regclass('parcel')")).scalar() is None
