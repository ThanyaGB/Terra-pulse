"""CAMS global atmospheric forecast connector (ADR-16). Coarse PM2.5/PM10/NO2/SO2/CO/dust grids at each monitored area.
The live path reads the CAMS global model through Open-Meteo's air-quality API (keyless, same Copernicus data); the
recorded fixtures are saved responses from that API. Refuses to run if 'cams' is not in the data_source registry."""
from __future__ import annotations

import logging

import httpx

from domain.data_sources import SourceRegistry, default_registry

from . import openmeteo
from .geo import Place
from .rawstore import RawStore

log = logging.getLogger("ingestion.cams")


def fetch_air(place: Place, raw: RawStore | None = None, *, offline: bool = False, client: httpx.Client | None = None,
              registry: SourceRegistry | None = None) -> tuple[openmeteo.Series, str]:
    """Returns (series, origin) with origin 'live' or 'fixture'. A late or failed fetch falls back to the recorded series."""
    (registry or default_registry()).require("cams")
    if not offline:
        try:
            return openmeteo.fetch_air(place, raw, client=client), "live"
        except Exception as exc:  # noqa: BLE001 - CAMS late: caller sets fallback_flag from origin
            log.warning("CAMS fetch failed for %s: %s", place.id, exc)
    return openmeteo.load_fixture(f"openmeteo_aq_{place.id}.json"), "fixture"
