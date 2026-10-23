"""Sentinel-2 L2A -> NDVI from the public Earth Search STAC (Element84) and its COGs on AWS (no credentials).
NDVI = (NIR - RED) / (NIR + RED) over a small window around the village. The decay slope (NDVI units/day)
is a linear fit over recent clear scenes. Cadence is every 5 days per tile (spec 6.1)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from .geo import Place

STAC = "https://earth-search.aws.element84.com/v1/search"
FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "integration" / "fixtures" / "ndvi_sangrur.json"


@dataclass(frozen=True)
class NdviObs:
    date: str       # YYYY-MM-DD
    ndvi: float
    scene: str


def ndvi(red: float, nir: float) -> float:
    s = nir + red
    return 0.0 if s <= 0 else (nir - red) / s


def slope_per_day(obs: list[NdviObs]) -> float:
    """Least-squares slope of NDVI against day number. Needs at least two scenes on different dates."""
    pts = sorted((datetime.fromisoformat(o.date).toordinal(), o.ndvi) for o in obs)
    if len({p[0] for p in pts}) < 2:
        return 0.0
    n = len(pts)
    mx, my = sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    den = sum((p[0] - mx) ** 2 for p in pts)
    return sum((p[0] - mx) * (p[1] - my) for p in pts) / den


def search_scenes(place: Place, limit: int = 5, max_cloud: float = 40.0, client: httpx.Client | None = None) -> list[dict[str, Any]]:
    body = {"collections": ["sentinel-2-l2a"], "intersects": {"type": "Point", "coordinates": [place.lon, place.lat]},
            "limit": limit, "sortby": [{"field": "properties.datetime", "direction": "desc"}],
            "query": {"eo:cloud_cover": {"lt": max_cloud}}}
    r = (client or httpx).post(STAC, json=body, timeout=40)
    r.raise_for_status()
    feats: list[dict[str, Any]] = r.json()["features"]
    return feats


def sample_ndvi(scene: dict[str, Any], place: Place, half_window: int = 5) -> float:
    """Mean NDVI in a (2*half_window+1)^2 pixel window at the place, read via HTTP range requests."""
    import rasterio
    from rasterio.warp import transform
    from rasterio.windows import Window

    means: dict[str, float] = {}
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", AWS_NO_SIGN_REQUEST="YES"):
        for band in ("red", "nir"):
            with rasterio.open(scene["assets"][band]["href"]) as ds:
                xs, ys = transform("EPSG:4326", ds.crs, [place.lon], [place.lat])
                row, col = ds.index(xs[0], ys[0])
                win = Window(col - half_window, row - half_window, 2 * half_window + 1, 2 * half_window + 1)
                means[band] = float(ds.read(1, window=win).astype(float).mean())
    return ndvi(means["red"], means["nir"])


def observe(place: Place, scenes: int = 4) -> list[NdviObs]:
    out = []
    for sc in search_scenes(place, limit=scenes):
        out.append(NdviObs(sc["properties"]["datetime"][:10], round(sample_ndvi(sc, place), 4), sc["id"]))
    return out


def load_fixture() -> dict[str, list[NdviObs]]:
    raw = json.loads(FIXTURE.read_text(encoding="utf8"))
    return {k: [NdviObs(**o) for o in v] for k, v in raw.items()}
