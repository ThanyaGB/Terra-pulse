"""MCD fleets (T4.6): work-order dispatch out, GPS + completion webhooks in.
Lifecycle: created -> dispatched -> completed. Whether the real API exists or dispatch is manual in the pilot is
open question 6; `transport` is the seam."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

TRANSITIONS = {"created": {"dispatched"}, "dispatched": {"completed", "dispatched"}, "completed": set()}


class McdIntegration:
    def __init__(self, transport: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.transport = transport or (lambda _p: None)
        self.orders: dict[str, dict[str, Any]] = {}

    def dispatch(self, work_order: dict[str, Any]) -> dict[str, Any]:
        wo = self.orders.setdefault(work_order["id"], {**work_order, "status": "created", "gps": None})
        self.transport(wo)
        wo["status"], wo["dispatched_at"] = "dispatched", _now()
        return wo

    def webhook(self, work_order_id: str, *, status: str | None = None, gps: tuple[float, float] | None = None) -> dict[str, Any]:
        wo = self.orders[work_order_id]
        if gps:
            wo["gps"] = {"lat": gps[0], "lon": gps[1], "at": _now()}
        if status and status != wo["status"]:
            if status not in TRANSITIONS[wo["status"]]:
                raise ValueError(f"illegal transition {wo['status']} -> {status}")
            wo["status"] = status
            if status == "completed":
                wo["completed_at"] = _now()
        return wo


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
