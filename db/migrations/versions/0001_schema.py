"""PostGIS + TimescaleDB extensions, spatial tables, hypertables, operational tables, hash-chained audit log.

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SPATIAL = """
CREATE TABLE village (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, district TEXT NOT NULL DEFAULT 'Sangrur',
    geom geometry(MultiPolygon, 4326), centroid geometry(Point, 4326) NOT NULL, harvest_start DATE
);
CREATE TABLE parcel (
    id TEXT PRIMARY KEY, village_id TEXT NOT NULL REFERENCES village(id), farmer_name TEXT NOT NULL,
    farmer_phone_enc BYTEA NOT NULL,                       -- encrypted at rest; only ever served masked (ADR-06)
    acres NUMERIC(6,2) NOT NULL CHECK (acres > 0), machine_need TEXT NOT NULL,
    geom geometry(Polygon, 4326), centroid geometry(Point, 4326) NOT NULL
);
CREATE TABLE grid_cell_1km (
    id TEXT PRIMARY KEY, geom geometry(Polygon, 4326) NOT NULL, centroid geometry(Point, 4326) NOT NULL
);
CREATE TABLE street_segment (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, grid_cell_id TEXT REFERENCES grid_cell_1km(id), geom geometry(LineString, 4326) NOT NULL
);
CREATE TABLE station (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('caaqms', 'low_cost')),
    geom geometry(Point, 4326) NOT NULL, grid_cell_id TEXT REFERENCES grid_cell_1km(id)
);
CREATE INDEX parcel_geom_gix ON parcel USING GIST (geom);
CREATE INDEX parcel_centroid_gix ON parcel USING GIST (centroid);
CREATE INDEX village_geom_gix ON village USING GIST (geom);
CREATE INDEX grid_geom_gix ON grid_cell_1km USING GIST (geom);
CREATE INDEX street_geom_gix ON street_segment USING GIST (geom);
CREATE INDEX station_geom_gix ON station USING GIST (geom);
"""

# (table, DDL columns, time column)
HYPERTABLES = [
    ("aqi_reading", "station_id TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL, pm25 REAL, pm10 REAL, no2 REAL, so2 REAL, co REAL, source TEXT NOT NULL, interpolated BOOLEAN NOT NULL DEFAULT FALSE", "ts"),
    ("sensor_reading", "sensor_id TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL, pm25 REAL, drift_flag BOOLEAN NOT NULL DEFAULT FALSE", "ts"),
    ("fire_hotspot", "id BIGSERIAL, ts TIMESTAMPTZ NOT NULL, geom geometry(Point, 4326) NOT NULL, frp REAL, confidence TEXT, satellite TEXT, village_id TEXT, cluster_id TEXT", "ts"),
    ("machine_telemetry", "machine_id TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL, geom geometry(Point, 4326), pto_hours REAL, status TEXT", "ts"),
    ("weather_obs", "grid_cell_id TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL, wind_speed_kmh REAL, wind_dir_deg REAL, pbl_height_m REAL, inversion BOOLEAN, soil_moisture REAL", "ts"),
]

OPERATIONAL = """
CREATE TABLE risk_score (
    parcel_id TEXT NOT NULL REFERENCES parcel(id), scored_at TIMESTAMPTZ NOT NULL, score REAL NOT NULL CHECK (score BETWEEN 0 AND 100),
    tier TEXT NOT NULL CHECK (tier IN ('low','medium','high','critical')), components JSONB NOT NULL, weights_version INT NOT NULL,
    PRIMARY KEY (parcel_id, scored_at)
);
CREATE TABLE call (
    id TEXT PRIMARY KEY, parcel_id TEXT NOT NULL REFERENCES parcel(id), provider TEXT NOT NULL, status TEXT NOT NULL,
    lang TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), transcript JSONB NOT NULL DEFAULT '[]', intent TEXT
);
CREATE INDEX call_parcel_started ON call (parcel_id, started_at DESC);   -- backs the per-parcel rate limit audit
CREATE TABLE booking (
    id TEXT PRIMARY KEY, parcel_id TEXT NOT NULL REFERENCES parcel(id), machinery_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending_confirmation','confirmed','dispatched','cancelled')),
    distance_km REAL, rental_rate_inr_per_acre INT NOT NULL, version INT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX booking_parcel_machine_open ON booking (parcel_id, machinery_id) WHERE status <> 'cancelled';  -- idempotent on parcel + machinery
CREATE TABLE collection_request (
    id TEXT PRIMARY KEY, parcel_id TEXT NOT NULL REFERENCES parcel(id), estimated_tonnes NUMERIC(8,2) NOT NULL,
    floor_price_inr INT NOT NULL, status TEXT NOT NULL, received_tonnes NUMERIC(8,2), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE work_order (
    id TEXT PRIMARY KEY, area_id TEXT NOT NULL, action_type TEXT NOT NULL, grap_tier TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('created','dispatched','completed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sla_due_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ, gps JSONB, control_station_id TEXT
);
CREATE TABLE directive (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, area_ids TEXT[] NOT NULL, created_by TEXT NOT NULL, approved_by TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued','pending_approval','dispatched')), issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT directive_no_self_approval CHECK (approved_by IS NULL OR approved_by <> created_by)         -- ADR-07
);
CREATE TABLE roi_measurement (
    id BIGSERIAL PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_order(id), delta_pm25 REAL NOT NULL, raw_delta_pm25 REAL,
    control_station_id TEXT, measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE citizen_report (
    reference_id TEXT PRIMARY KEY, category TEXT NOT NULL, grid_ref TEXT, area_id TEXT, object_key TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()          -- no personal identifiers, no raw GPS (ADR-12)
);
CREATE TABLE outbox (
    event_id UUID PRIMARY KEY, type TEXT NOT NULL, body JSONB NOT NULL, published BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE audit_event (
    seq BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), actor TEXT NOT NULL, action TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}',
    prev_hash CHAR(64) NOT NULL, hash CHAR(64) NOT NULL UNIQUE
);
-- append-only: block UPDATE and DELETE; the chain is verified by recomputing hashes (api.audit.AuditLog.verify)
CREATE FUNCTION audit_event_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'audit_event is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
"""

OPERATIONAL_TABLES = ["audit_event", "outbox", "citizen_report", "roi_measurement", "directive", "work_order", "collection_request",
                      "booking", "call", "risk_score"]
SPATIAL_TABLES = ["station", "street_segment", "grid_cell_1km", "parcel", "village"]


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
    op.execute(SPATIAL)
    for name, cols, tcol in HYPERTABLES:
        op.execute(f"CREATE TABLE {name} ({cols})")
        op.execute(f"SELECT create_hypertable('{name}', '{tcol}')")
    op.execute("CREATE INDEX fire_hotspot_geom_gix ON fire_hotspot USING GIST (geom)")
    op.execute("CREATE INDEX aqi_reading_station_ts ON aqi_reading (station_id, ts DESC)")
    op.execute(OPERATIONAL)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_event_no_update ON audit_event")
    op.execute("DROP FUNCTION IF EXISTS audit_event_immutable()")
    for t in OPERATIONAL_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
    for name, _, _ in reversed(HYPERTABLES):
        op.execute(f"DROP TABLE IF EXISTS {name} CASCADE")
    for t in SPATIAL_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
