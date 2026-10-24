# ADR-23: Pilot baseline and control selection (spec ADR-21, T1.6)

**Status:** Method accepted. Numerical results pending the archive downloads.

## Decision

- Fire baseline: NASA FIRMS hotspots for the 14 Sangrur villages, October and November of 2023, 2024 and 2025. A hotspot counts toward the nearest village within 12 km. Low-confidence detections are dropped.
- Air-quality baseline: CPCB history for Anand Vihar and Patparganj.
- Controls: unaffected Delhi stations. Candidates are listed in `config/baseline.yaml`. A candidate is kept only if its pre-period daily-mean PM2.5 trend is within 1.5 ug/m3 per day of the treated mean's slope and the daily correlation is at least 0.6, over at least 14 days.
- No Sangrur ground station is read anywhere. `read_cpcb_history` raises for any station outside Delhi.
- Every build produces a snapshot ID (`BL-` plus 12 hex of the SHA-256 of the canonical snapshot body, which includes the config and the SHA-256 of each input file). The same inputs and config give the same ID, and `baseline.verify` detects an edited snapshot.

## Implementation

`services/ingestion/baseline.py`, `scripts/load_baseline.py`, `config/baseline.yaml`, tests in `tests/integration/test_data_sources.py` (synthetic archive files).

## Open item

The FIRMS archive and the CPCB history export are downloads that a person must make; neither is in the repo, and no snapshot has been built from real data yet. When one is built, record here: the snapshot ID, the control stations kept, and the pre-period check numbers for each candidate.
