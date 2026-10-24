# ADR-16: Open-licence forecast inputs with kriging downscaling

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

CAMS grids and ERA5 meteorology feed the forecast, CPCB observations correct it, and kriging with external drift on OpenStreetMap covariates downscales to 1 km. No GNN, no WRF-Chem in the pilot.

## Implementation

`ingestion/cams.py`, `ingestion/era5.py`, `ingestion/osm.py`, `agents/forecast_agent` (`kriging.py`, `correction.py`, `downscale.py`), `config/forecast.yaml`. The GNN path stays in the code behind `FORECAST_GNN_ENABLED` (default OFF). The OSM covariate file is a placeholder until the extract job exists.
