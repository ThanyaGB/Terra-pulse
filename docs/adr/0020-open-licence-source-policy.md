# ADR-20: Open-licence source policy

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Only sources with an open or permissive licence are ingested. Each is registered with its licence, attribution and redistribution rule, and attribution is shown wherever derived data appears.

## Implementation

`domain/data_sources.py` (registry and seed), `data_source` table in migration 0002, `docs/data-licences.md` (generated), `design-system/DataAttribution.tsx`. Every connector calls `require()` and refuses an unregistered source. The Open-Meteo NWP forecast is registered as `nwp` because the 72 h plume needs forecast winds that ERA5 cannot give.
