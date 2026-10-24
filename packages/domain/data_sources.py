"""Data source registry (ADR-20, T1.7). The rows below are the spec 7.1 table and are the seed for the `data_source`
table (migration 0002; a test keeps the two identical). Every ingestion connector calls `require()` and refuses to run
for a source that is not registered. Redistribution wording is a working summary: gate G5 (licence check) is where the
data lead verifies each licence and attribution text."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


class SourceNotRegistered(RuntimeError):
    pass


@dataclass(frozen=True)
class DataSource:
    source_id: str
    name: str
    data: str
    cadence: str
    licence: str
    attribution: str
    redistribution: str
    shown_in_ui: bool = True      # False for internal sources that never reach a screen


SEED: tuple[DataSource, ...] = (
    DataSource("firms", "NASA FIRMS", "VIIRS 375 m, MODIS 1 km hotspots", "Poll every 15 min", "NASA open data policy",
               "NASA FIRMS", "Open; attribution requested"),
    DataSource("sentinel2", "Sentinel-2", "Surface reflectance to NDVI", "Every 5 days per tile", "Copernicus open licence",
               "Contains modified Copernicus Sentinel data", "Free, full and open; attribution required"),
    DataSource("cpcb", "CPCB CAAQMS", "Station PM2.5, PM10, NO2", "Every 15 min", "Government Open Data Licence - India, via data.gov.in",
               "Source: CPCB via data.gov.in", "Redistribution allowed with attribution"),
    DataSource("cams", "CAMS", "Global atmospheric forecast grids", "Every 12 h", "Copernicus licence",
               "Copernicus Atmosphere Monitoring Service", "Free, full and open; attribution required"),
    DataSource("era5", "ERA5", "Reanalysis meteorology (PBL, wind, temperature)", "Hourly", "Copernicus licence",
               "Copernicus Climate Change Service", "Free, full and open; attribution required"),
    DataSource("nwp", "Open-Meteo NWP forecast", "Forecast winds and boundary-layer height for the 72 h plume (ERA5 is reanalysis and cannot look ahead)",
               "Hourly", "CC BY 4.0 (Open-Meteo)", "Weather data by Open-Meteo.com", "Attribution required"),
    DataSource("osm", "OpenStreetMap", "Roads, land use", "Monthly extract", "ODbL",
               "© OpenStreetMap contributors", "Share-alike for derived databases; attribution required"),
    DataSource("iot", "Low-cost IoT sensors", "Sensor PM2.5", "1-5 min", "Owned or contracted per deployment",
               "Per contract", "Per contract", shown_in_ui=False),
    DataSource("crm", "Machinery CRM", "Machine status, PTO and GPS hours", "Event-driven + 5 min", "Partner data agreement",
               "Internal", "Internal only; not redistributed", shown_in_ui=False),
)


class SourceRegistry:
    def __init__(self, rows: Iterable[DataSource] = SEED) -> None:
        self.rows = {r.source_id: r for r in rows}

    def get(self, source_id: str) -> DataSource | None:
        return self.rows.get(source_id)

    def require(self, source_id: str) -> DataSource:
        row = self.rows.get(source_id)
        if row is None:
            raise SourceNotRegistered(f"data source {source_id!r} is not in the data_source registry; register its licence and attribution first (ADR-20)")
        return row

    def attribution_lines(self, source_ids: Iterable[str] | None = None) -> list[str]:
        """Attribution text for the sources a screen shows (UI footer, ADR-20). Internal sources are skipped."""
        ids = list(source_ids) if source_ids is not None else list(self.rows)
        out: list[str] = []
        for i in ids:
            r = self.require(i)
            if r.shown_in_ui and r.attribution not in out:
                out.append(r.attribution)
        return out


_default = SourceRegistry()


def default_registry() -> SourceRegistry:
    return _default


def licences_markdown(rows: Iterable[DataSource] = SEED) -> str:
    """docs/data-licences.md, generated from the registry rows."""
    lines = ["# Data licences", "",
             "Generated from the `data_source` registry by `scripts/gen_data_licences.py`. Do not edit by hand.",
             "Only open-licence sources are ingested (ADR-20). Attribution is shown in every UI that displays derived data.",
             "Gate G5 (licence check) is not passed until the data lead has verified each row below.", "",
             "| Source | ID | Data | Cadence | Licence | Attribution shown | Redistribution |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        lines.append(f"| {r.name} | `{r.source_id}` | {r.data} | {r.cadence} | {r.licence} | {r.attribution} | {r.redistribution} |")
    lines += ["", "Raw IMD feeds are not used in v2.0.", ""]
    return "\n".join(lines)
