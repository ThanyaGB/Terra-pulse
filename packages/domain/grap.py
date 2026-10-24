"""GRAP tier mapping (spec 5.4), data-driven from a versioned YAML."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .config import load_yaml


@dataclass(frozen=True)
class GrapAction:
    type: str
    approval: str  # single | two_person


@dataclass(frozen=True)
class GrapResult:
    tier: str
    actions: list[GrapAction]
    version: int


def grap_tier(aqi: float, shares: Mapping[str, float] | None = None, cfg: dict[str, Any] | None = None) -> GrapResult:
    cfg = cfg or load_yaml("grap_tiers.yaml")
    chosen = max((t for t in cfg["tiers"] if aqi >= t["min_aqi"]), key=lambda t: t["min_aqi"])
    actions = [GrapAction(a["type"], a["approval"]) for a in chosen["actions"]]
    if chosen["id"] != "none" and shares:
        for src, rule in cfg.get("attribution_peaks", {}).items():
            if shares.get(src, 0) >= rule["share_pct"]:
                extra = GrapAction(rule["extra_action"]["type"], rule["extra_action"]["approval"])
                if extra not in actions:
                    actions.append(extra)
    return GrapResult(tier=chosen["id"], actions=actions, version=int(cfg["version"]))


def requires_two_person(action_type: str, cfg: dict[str, Any] | None = None) -> bool:
    cfg = cfg or load_yaml("grap_tiers.yaml")
    return any(a["type"] == action_type and a["approval"] == "two_person" for t in cfg["tiers"] for a in t["actions"])
