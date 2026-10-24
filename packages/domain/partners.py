"""Partner contracts and rates (ADR-17). A rate exists only if an `active` contract covers the area; `unconfirmed`
placeholders in config are treated as absent so farmer-facing text never quotes an unbacked price."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from .config import load_yaml


@dataclass(frozen=True)
class Rate:
    value: float
    contract_id: str

    @property
    def source(self) -> str:
        return f"partner_contract:{self.contract_id}"


def _d(v: Any) -> date:
    return v if isinstance(v, date) else date.fromisoformat(str(v))


def _is_active(c: dict[str, Any], today: date) -> bool:
    if c.get("status") != "active":
        return False
    start, end = c.get("valid_from"), c.get("valid_to")
    return (start is None or today >= _d(start)) and (end is None or today <= _d(end))


def active_contract(area_id: str, today: date | None = None, contracts: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    today = today or date.today()
    rows = contracts if contracts is not None else load_yaml("partner_rates.yaml")["contracts"]
    return next((c for c in rows if c["area_id"] == area_id and _is_active(c, today)), None)


def rate(area_id: str, key: str, today: date | None = None, contracts: list[dict[str, Any]] | None = None) -> Rate | None:
    """The rate for `key` in `area_id`, or None when no active contract backs it."""
    c = active_contract(area_id, today, contracts)
    if c is None or key not in c.get("rates", {}):
        return None
    return Rate(float(c["rates"][key]), str(c["contract_id"]))
