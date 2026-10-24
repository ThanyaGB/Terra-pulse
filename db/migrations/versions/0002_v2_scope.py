"""v2.0 tables: data_source (seeded from spec 7.1), partner_contract, partner_rate, work_order_event, forecast_grid,
baseline_snapshot; supervisor workflow columns on work_order; 'approved' directive status.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# (source_id, name, data, cadence, licence, attribution, redistribution, shown_in_ui) - identical to domain.data_sources.SEED
DATA_SOURCES = [
    ('firms', 'NASA FIRMS', 'VIIRS 375 m, MODIS 1 km hotspots', 'Poll every 15 min', 'NASA open data policy', 'NASA FIRMS', 'Open; attribution requested', True),
    ('sentinel2', 'Sentinel-2', 'Surface reflectance to NDVI', 'Every 5 days per tile', 'Copernicus open licence', 'Contains modified Copernicus Sentinel data', 'Free, full and open; attribution required', True),
    ('cpcb', 'CPCB CAAQMS', 'Station PM2.5, PM10, NO2', 'Every 15 min', 'Government Open Data Licence - India, via data.gov.in', 'Source: CPCB via data.gov.in', 'Redistribution allowed with attribution', True),
    ('cams', 'CAMS', 'Global atmospheric forecast grids', 'Every 12 h', 'Copernicus licence', 'Copernicus Atmosphere Monitoring Service', 'Free, full and open; attribution required', True),
    ('era5', 'ERA5', 'Reanalysis meteorology (PBL, wind, temperature)', 'Hourly', 'Copernicus licence', 'Copernicus Climate Change Service', 'Free, full and open; attribution required', True),
    ('nwp', 'Open-Meteo NWP forecast', 'Forecast winds and boundary-layer height for the 72 h plume (ERA5 is reanalysis and cannot look ahead)', 'Hourly', 'CC BY 4.0 (Open-Meteo)', 'Weather data by Open-Meteo.com', 'Attribution required', True),
    ('osm', 'OpenStreetMap', 'Roads, land use', 'Monthly extract', 'ODbL', '© OpenStreetMap contributors', 'Share-alike for derived databases; attribution required', True),
    ('iot', 'Low-cost IoT sensors', 'Sensor PM2.5', '1-5 min', 'Owned or contracted per deployment', 'Per contract', 'Per contract', False),
    ('crm', 'Machinery CRM', 'Machine status, PTO and GPS hours', 'Event-driven + 5 min', 'Partner data agreement', 'Internal', 'Internal only; not redistributed', False),
]

DDL = """
CREATE TABLE data_source (
    source_id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, cadence TEXT NOT NULL, licence TEXT NOT NULL,
    attribution TEXT NOT NULL, redistribution TEXT NOT NULL, shown_in_ui BOOLEAN NOT NULL DEFAULT TRUE,
    verified_at TIMESTAMPTZ                     -- set by the data lead at gate G5
);
CREATE TABLE partner_contract (
    contract_id TEXT PRIMARY KEY, partner TEXT NOT NULL, area_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','unconfirmed','expired')), valid_from DATE, valid_to DATE
);
CREATE TABLE partner_rate (
    contract_id TEXT NOT NULL REFERENCES partner_contract(contract_id), rate_key TEXT NOT NULL, value NUMERIC(12,2) NOT NULL,
    PRIMARY KEY (contract_id, rate_key)
);
CREATE TABLE work_order_event (
    id BIGSERIAL PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_order(id), at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX work_order_event_wo ON work_order_event (work_order_id, at);
CREATE TABLE baseline_snapshot (
    snapshot_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), body JSONB NOT NULL    -- ADR-21, T1.6
);
ALTER TABLE work_order DROP CONSTRAINT IF EXISTS work_order_status_check;
ALTER TABLE work_order ADD CONSTRAINT work_order_status_check CHECK (status IN ('created','dispatched','accepted','completed'));
ALTER TABLE work_order ADD COLUMN accepted_by TEXT, ADD COLUMN accepted_at TIMESTAMPTZ, ADD COLUMN completed_by TEXT,
    ADD COLUMN completion_grid_ref TEXT, ADD COLUMN completion_object_key TEXT;
ALTER TABLE booking ALTER COLUMN rental_rate_inr_per_acre DROP NOT NULL, ADD COLUMN rate_source TEXT;          -- rates only from an active contract (ADR-17)
ALTER TABLE collection_request ALTER COLUMN floor_price_inr DROP NOT NULL, ADD COLUMN rate_source TEXT;
ALTER TABLE directive ADD COLUMN approved_at TIMESTAMPTZ;
ALTER TABLE directive DROP CONSTRAINT IF EXISTS directive_status_check;
ALTER TABLE directive ADD CONSTRAINT directive_status_check CHECK (status IN ('queued','pending_approval','approved','dispatched'));
"""

HYPERTABLES = [
    ("forecast_grid", "grid_cell_id TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL, horizon_h INT NOT NULL, pm25 REAL, method TEXT NOT NULL, fallback_flag BOOLEAN NOT NULL DEFAULT FALSE", "ts"),
]

NEW_TABLES = ["baseline_snapshot", "work_order_event", "partner_rate", "partner_contract", "data_source"]


def upgrade() -> None:
    op.execute(DDL)
    for name, cols, tcol in HYPERTABLES:
        op.execute(f"CREATE TABLE {name} ({cols})")
        op.execute(f"SELECT create_hypertable('{name}', '{tcol}')")
    for row in DATA_SOURCES:
        vals = ", ".join("TRUE" if v is True else "FALSE" if v is False else "'" + str(v).replace("'", "''") + "'" for v in row)
        op.execute(f"INSERT INTO data_source (source_id, name, data, cadence, licence, attribution, redistribution, shown_in_ui) VALUES ({vals})")


def downgrade() -> None:
    op.execute("ALTER TABLE directive DROP COLUMN IF EXISTS approved_at")
    op.execute("UPDATE collection_request SET floor_price_inr = 0 WHERE floor_price_inr IS NULL")
    op.execute("ALTER TABLE collection_request ALTER COLUMN floor_price_inr SET NOT NULL, DROP COLUMN IF EXISTS rate_source")
    op.execute("UPDATE booking SET rental_rate_inr_per_acre = 0 WHERE rental_rate_inr_per_acre IS NULL")
    op.execute("ALTER TABLE booking ALTER COLUMN rental_rate_inr_per_acre SET NOT NULL, DROP COLUMN IF EXISTS rate_source")
    for name, _, _ in HYPERTABLES:
        op.execute(f"DROP TABLE IF EXISTS {name} CASCADE")
    op.execute("ALTER TABLE directive DROP CONSTRAINT IF EXISTS directive_status_check")
    op.execute("ALTER TABLE directive ADD CONSTRAINT directive_status_check CHECK (status IN ('queued','pending_approval','dispatched'))")
    op.execute("ALTER TABLE work_order DROP COLUMN IF EXISTS accepted_by, DROP COLUMN IF EXISTS accepted_at, DROP COLUMN IF EXISTS completed_by, "
               "DROP COLUMN IF EXISTS completion_grid_ref, DROP COLUMN IF EXISTS completion_object_key")
    op.execute("ALTER TABLE work_order DROP CONSTRAINT IF EXISTS work_order_status_check")
    op.execute("ALTER TABLE work_order ADD CONSTRAINT work_order_status_check CHECK (status IN ('created','dispatched','completed'))")
    for t in NEW_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
