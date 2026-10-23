"""1 km downscaling (T2.4). A trained GNN artifact would be loaded from the artifact store (open question 7).
Until one is supplied the inference wrapper falls back to inverse-distance-weighted (bilinear-style) interpolation
of the coarse model/station points onto the 1 km grid."""
from __future__ import annotations

import logging
import os
from typing import Callable, Sequence

from ingestion.geo import haversine_km

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


def load_model(path: str | None = None) -> Downscaler | None:
    """Return the GNN inference callable, or None if the artifact is missing or cannot be loaded."""
    path = path or os.environ.get("VAYU_GNN_ARTIFACT")
    if not path or not os.path.exists(path):
        return None
    try:
        import torch

        model = torch.jit.load(path)  # type: ignore[no-untyped-call]
        model.eval()

        def run(points: Sequence[Point], targets: Sequence[tuple[float, float]]) -> list[float]:
            with torch.no_grad():
                return [float(v) for v in model(torch.tensor(points), torch.tensor(targets)).flatten()]

        return run
    except Exception:  # noqa: BLE001
        log.exception("GNN artifact failed to load; using interpolation fallback")
        return None


def downscale(points: Sequence[Point], targets: Sequence[tuple[float, float]], model: Downscaler | None = None) -> tuple[list[float], str]:
    """Returns (values, method) where method is 'gnn' or 'idw-fallback'."""
    if model is not None:
        try:
            return model(points, targets), "gnn"
        except Exception:  # noqa: BLE001
            log.exception("GNN inference failed; falling back to interpolation")
    return idw(points, targets), "idw-fallback"
