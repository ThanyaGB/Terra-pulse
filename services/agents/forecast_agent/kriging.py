"""Kriging with external drift (ADR-16, T2.4), numpy only. The estimate at a target is a weighted sum of the observations,
with weights from the variogram and a linear trend on the external covariates (here OpenStreetMap road density and built-up
fraction). Falls back to inverse-distance weighting upstream (downscale.py) when the system is too small or singular."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np
from numpy.typing import NDArray

Point = tuple[float, float, float]   # lat, lon, value


class KrigingError(Exception):
    pass


@dataclass(frozen=True)
class Variogram:
    sill: float
    nugget: float
    range_km: float

    def gamma(self, h: NDArray[np.float64]) -> NDArray[np.float64]:
        g = self.nugget + (self.sill - self.nugget) * (1.0 - np.exp(-3.0 * h / self.range_km))
        return np.where(h > 0, g, 0.0)


def _xy_km(lat: NDArray[np.float64], lon: NDArray[np.float64], lat0: float) -> NDArray[np.float64]:
    return np.column_stack([(lon - lon.mean()) * 111.32 * math.cos(math.radians(lat0)), (lat - lat.mean()) * 110.57])


def variogram_for(values: Sequence[float], cfg: dict[str, Any]) -> Variogram:
    var = float(np.var(values)) or 1.0
    return Variogram(sill=var, nugget=cfg["nugget_fraction"] * var, range_km=float(cfg["range_km"]))


def ked(points: Sequence[Point], drift_at_points: Sequence[Sequence[float]], targets: Sequence[tuple[float, float]],
        drift_at_targets: Sequence[Sequence[float]], cfg: dict[str, Any]) -> list[float]:
    """Kriging with external drift. drift_* are (n, p) covariate matrices. Raises KrigingError when it cannot be solved."""
    n = len(points)
    if n < cfg["min_points"]:
        raise KrigingError(f"{n} observations; need {cfg['min_points']}")
    lat = np.array([p[0] for p in points])
    lon = np.array([p[1] for p in points])
    z = np.array([p[2] for p in points])
    f = np.asarray(drift_at_points, dtype=float).reshape(n, -1)
    ft = np.asarray(drift_at_targets, dtype=float).reshape(len(targets), -1)
    p = f.shape[1]
    if np.linalg.matrix_rank(np.column_stack([np.ones(n), f])) < p + 1:
        raise KrigingError("drift covariates are collinear with a constant at the observation points")
    lat0 = float(lat.mean())
    all_lat = np.concatenate([lat, [t[0] for t in targets]])
    all_lon = np.concatenate([lon, [t[1] for t in targets]])
    xy = _xy_km(all_lat, all_lon, lat0)
    xs, xt = xy[:n], xy[n:]
    vg = variogram_for(z.tolist(), cfg)
    d = np.linalg.norm(xs[:, None, :] - xs[None, :, :], axis=2)
    m = n + 1 + p
    a = np.zeros((m, m))
    a[:n, :n] = vg.gamma(d)
    a[:n, n] = a[n, :n] = 1.0
    a[:n, n + 1:] = f
    a[n + 1:, :n] = f.T
    out: list[float] = []
    cap = float(cfg["max_ratio_to_max_obs"]) * float(z.max())
    for i in range(len(targets)):
        g0 = vg.gamma(np.linalg.norm(xs - xt[i], axis=1))
        rhs = np.concatenate([g0, [1.0], ft[i]])
        try:
            sol = np.linalg.solve(a, rhs)
        except np.linalg.LinAlgError as exc:
            raise KrigingError("singular kriging system") from exc
        out.append(float(min(max(sol[:n] @ z, 0.0), cap)))
    return out


def rmse(predicted: Sequence[float], observed: Sequence[float]) -> float:
    if len(predicted) != len(observed) or not observed:
        raise ValueError("need equal-length, non-empty series")
    return float(math.sqrt(sum((p - o) ** 2 for p, o in zip(predicted, observed)) / len(observed)))


def leave_one_out_rmse(points: Sequence[Point], drift: Sequence[Sequence[float]], cfg: dict[str, Any]) -> float:
    """RMSE of predicting each observation from the others. A stand-in for the held-out CPCB check (T2.4) when only the
    current snapshot is available; the pilot review reports the 24 h RMSE against held-out CPCB readings."""
    preds = []
    for i in range(len(points)):
        keep = [j for j in range(len(points)) if j != i]
        preds.append(ked([points[j] for j in keep], [drift[j] for j in keep], [(points[i][0], points[i][1])], [drift[i]], cfg)[0])
    return rmse(preds, [p[2] for p in points])
