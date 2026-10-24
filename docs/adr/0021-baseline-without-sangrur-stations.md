# ADR-21: Baseline does not depend on Sangrur ground stations

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

The fire baseline comes from FIRMS, the air-quality baseline from CPCB stations in Delhi, and effects are estimated by difference-in-differences against unaffected Delhi stations.

## Implementation

`ingestion/baseline.py`, `scripts/load_baseline.py`, `config/baseline.yaml`; details and the open data item in ADR-23.
