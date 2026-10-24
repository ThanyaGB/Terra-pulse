"""Offline risk-weight calibration (T2.8). Proposes Phase 1 weights from pilot samples and returns a report. It never
writes config: a human reads the report and edits config/risk_weights.yaml (spec 6.1). Deterministic for a given input."""
from __future__ import annotations

import csv
import hashlib
import io
from typing import Any

import numpy as np
from numpy.typing import NDArray

from .config import load_yaml
from .risk import RiskInputs, normalise

KEYS = ("sowing_window_days_remaining", "ndvi_decay_slope", "local_machinery_shortfall", "historical_fire_density", "soil_moisture_index")


def read_samples(csv_text: str) -> tuple[list[RiskInputs], list[float]]:
    """Columns: the five raw inputs plus `burned` (1 if a fire was observed on the parcel that season, else 0)."""
    xs: list[RiskInputs] = []
    ys: list[float] = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        xs.append(RiskInputs(**{k: float(row[k]) for k in KEYS}))
        ys.append(float(row["burned"]))
    return xs, ys


def _project_simplex(v: NDArray[np.float64]) -> NDArray[np.float64]:
    """Euclidean projection onto {w >= 0, sum w = 1}."""
    u = np.sort(v)[::-1]
    css = np.cumsum(u) - 1.0
    rho = np.nonzero(u - css / (np.arange(len(v)) + 1) > 0)[0][-1]
    return np.maximum(v - css[rho] / (rho + 1.0), 0.0)  # type: ignore[no-any-return]


def fit_weights(x: NDArray[np.float64], y: NDArray[np.float64], steps: int = 4000, lr: float = 0.05) -> NDArray[np.float64]:
    """Least squares of the outcome on the normalised inputs, constrained to non-negative weights that sum to 1."""
    w = np.full(x.shape[1], 1.0 / x.shape[1])
    for _ in range(steps):
        w = _project_simplex(w - lr * (2.0 / len(y)) * x.T @ (x @ w - y))
    return w


def calibration_report(csv_text: str, current: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = current or load_yaml("risk_weights.yaml")
    samples, y_list = read_samples(csv_text)
    if len(samples) < 30:
        raise ValueError(f"{len(samples)} samples; at least 30 are needed for a meaningful fit")
    x = np.array([[normalise(s, cfg)[k] for k in KEYS] for s in samples])
    y = np.array(y_list)
    proposed = fit_weights(x, y)
    cur = np.array([cfg["weights"][k] for k in KEYS])

    def r2(w: NDArray[np.float64]) -> float:
        ss = float(((y - y.mean()) ** 2).sum())
        return float(1.0 - ((y - x @ w) ** 2).sum() / ss) if ss else 0.0

    return {"input_sha256": hashlib.sha256(csv_text.encode()).hexdigest(), "samples": len(samples), "burn_rate": round(float(y.mean()), 4),
            "weights_version_in_use": cfg["version"],
            "current_weights": {k: round(float(v), 4) for k, v in zip(KEYS, cur)}, "proposed_weights": {k: round(float(v), 4) for k, v in zip(KEYS, proposed)},
            "r2_current": round(r2(cur), 4), "r2_proposed": round(r2(proposed), 4),
            "applied": False, "note": "Proposal only. A human approves any change and edits config/risk_weights.yaml."}
