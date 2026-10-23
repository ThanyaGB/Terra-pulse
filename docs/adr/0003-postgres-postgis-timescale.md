# ADR-03: PostgreSQL with PostGIS and TimescaleDB

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

PostGIS stores spatial geometry (parcels, villages, grid cells, streets); TimescaleDB stores sensor and AQI time series. Migrations enable both extensions and create hypertables.

## Implementation

`db/migrations/versions/0001_schema.py` (Alembic). Verified statically in CI; the up/down test against a real database runs when `VAYU_TEST_DATABASE_URL` is set. The running API still uses in-memory repositories: wiring the SQL repositories is the next step.
