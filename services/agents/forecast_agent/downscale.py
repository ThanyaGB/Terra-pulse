"""1 km downscaling (T2.4, ADR-16). Default: kriging with external drift on OpenStreetMap covariates. Fallback: inverse-
distance-weighted (bilinear-style) interpolation. The GNN path is post-pilot: it is kept but only reachable when the
FORECAST_GNN_ENABLED flag (default OFF) is on and an artifact exists. Methods reported: 'ked', 'idw-fallback', 'gnn'."""
from __future__ import annotations

import logging
import os
from typing import Callable, Sequence

from domain.config import load_yaml
from ingestion.geo import haversine_km

from .kriging import KrigingError, ked

log = logging.getLogger("downscale")
Point = tuple[float, float, float]   # lat, lon, value
Downscaler = Callable[[Sequence[Point], Sequence[tuple[float, float]]], list[float]]


def idw(points: Sequence[Point], targets: Sequence[tuple[float, float]], k: int = 4, power: float = 2.0) -> list[float]:
    """Inverse-distance-weighted interpolation over the k nearest coarse points."""
    if not points:
        raise ValueError("no source points")
    out = []
    for lat, lon in targets:
        near = sorted(((haversine_km(lat, lon, p[0], p[1]), p[2]) for p in points))[:k]
        if near[0][0] < 0.05:
            out.append(near[0][1])
            continue
        w = [1.0 / d ** power for d, _ in near]
        out.append(sum(wi * v for wi, (_, v) in zip(w, near)) / sum(w))
    return out


def load_model(path: str | None = None, enabled: bool = False) -> Downscaler | None:
    """Return the GNN inference callable, or None when the flag is off, the artifact is missing, or it cannot be loaded."""
    if not enabled:
        return None
    path = path or os.environ.get("VAYU_GNN_ARTIFACT")
    if not path or not os.path.exists(path):
        return None
    try:
        import torch

        model = torch.jit.load(path)  # type: ignore[no-untyped-call, unused-ignore]
        model.eval()

        def run(points: Sequence[Point], targets: Sequence[tuple[float, float]]) -> list[float]:
            with torch.no_grad():
                return [float(v) for v in model(torch.tensor(points), torch.tensor(targets)).flatten()]

        return run
    except Exception:  # noqa: BLE001
        log.exception("GNN artifact failed to load; using interpolation fallback")
        return None


Drift = tuple[Sequence[Sequence[float]], Sequence[Sequence[float]]]   # covariates at the points, covariates at the targets


def downscale(points: Sequence[Point], targets: Sequence[tuple[float, float]], model: Downscaler | None = None,
              drift: Drift | None = None) -> tuple[list[float], str]:
    """Returns (values, method) where method is 'gnn', 'ked' or 'idw-fallback'."""
    if model is not None:
        try:
            return model(points, targets), "gnn"
        except Exception:  # noqa: BLE001
            log.exception("GNN inference failed; falling back")
    if drift is not None:
        try:
            return ked(points, drift[0], targets, drift[1], load_yaml("forecast.yaml")["kriging"]), "ked"
        except KrigingError as exc:
            log.warning("kriging with external drift unavailable (%s); using interpolation fallback", exc)
    cfg = load_yaml("forecast.yaml")["idw"]
    return idw(points, targets, int(cfg["k"]), float(cfg["power"])), "idw-fallback"
