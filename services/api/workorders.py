"""Supervisor work-order workflow (ADR-15, T3.6): created -> accepted -> completed. Every transition writes a work_order_event
and an audit entry. Completion needs a photo and a GPS point; the photo is re-encoded with no EXIF but a 100 m GPS cell
(ADR-12) and the raw GPS is never stored or logged. A completion carries a client request id so a queued upload that syncs
twice cannot create a second completion event."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from agents.common.events import WORKORDER_COMPLETED, Event
from agents.runtime import Platform
from api.images import sanitise_photo
from api.problem import ProblemError

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
FLOW = {"created": {"accepted"}, "accepted": {"completed"}, "completed": set()}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class WorkOrderService:
    def __init__(self, platform: Platform, photo_dir: str | Path, clock: Callable[[], str] = _now,
                 on_update: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.p, self.photo_dir, self.clock = platform, Path(photo_dir), clock
        self.on_update = on_update or (lambda _v: None)
        self._completions: dict[str, dict[str, Any]] = {}      # work order id -> {request_id, view}

    # ---- reads ----
    def get(self, work_order_id: str) -> dict[str, Any]:
        wo = self.p.world.work_orders.get(work_order_id)
        if wo is None:
            raise ProblemError(404, "Work order not found", f"No work order {work_order_id!r}.")
        return wo

    def view(self, wo: dict[str, Any]) -> dict[str, Any]:
        roi = next((r for r in self.p.world.roi if r["work_order_id"] == wo["id"]), None)
        return {"id": wo["id"], "area_id": wo["area_id"], "area": wo["area"], "action_type": wo["action_type"], "grap_tier": wo["grap_tier"],
                "status": wo["status"], "created_at": wo["created_at"], "due_by": wo["sla_due_at"], "sla_breached": bool(wo.get("sla_breached")),
                "accepted_by": wo.get("accepted_by"), "accepted_at": wo.get("accepted_at"), "completed_at": wo.get("completed_at"),
                "completion_grid_ref": wo.get("completion_grid_ref"), "roi_window": wo.get("roi_window"),
                "roi": None if roi is None else {"delta_pm25": roi["delta_pm25"], "control_area": roi.get("control_area"), "measured_at": roi["measured_at"]}}

    def list(self, status: str | None = None, area: str | None = None) -> list[dict[str, Any]]:
        rows = [w for w in self.p.world.work_orders.values() if (status is None or w["status"] == status) and (area is None or w["area_id"] == area)]
        return [self.view(w) for w in sorted(rows, key=lambda w: w["sla_due_at"])]

    # ---- transitions ----
    def _transition(self, wo: dict[str, Any], to: str, actor: str, detail: dict[str, Any]) -> None:
        frm = wo["status"]
        if to not in FLOW.get(frm, set()):
            raise ProblemError(409, "Illegal transition", f"A work order cannot go from '{frm}' to '{to}'." + (" Accept it first." if frm == "created" and to == "completed" else ""))
        wo["status"] = to
        self.p.world.work_order_events.append({"work_order_id": wo["id"], "at": self.clock(), "actor": actor, "from_status": frm, "to_status": to, "detail": detail})
        self.p.audit.append(actor, f"work_order.{to}", {"work_order_id": wo["id"], **detail})

    def accept(self, work_order_id: str, actor: str) -> dict[str, Any]:
        wo = self.get(work_order_id)
        if wo["status"] == "accepted" and wo.get("accepted_by") == actor:
            return self.view(wo)                                   # repeat accept by the same supervisor is a no-op
        self._transition(wo, "accepted", actor, {})
        wo["accepted_by"], wo["accepted_at"] = actor, self.clock()
        v = self.view(wo)
        self.on_update(v)
        return v

    async def complete(self, work_order_id: str, actor: str, photo: bytes, lat: float | None, lon: float | None, request_id: str | None) -> tuple[dict[str, Any], bool]:
        """Returns (view, duplicate). A repeat of the same request id returns the first result and emits nothing."""
        wo = self.get(work_order_id)
        done = self._completions.get(work_order_id)
        if request_id is not None and not REQUEST_ID_RE.match(request_id):
            raise ProblemError(422, "Invalid request id", "client_request_id must be 8-64 letters, digits, '-' or '_'.")
        if done is not None:
            if request_id is not None and done["request_id"] == request_id:
                return done["view"], True
            raise ProblemError(409, "Already completed", "This work order was completed by an earlier submission.")
        if wo["status"] != "accepted":
            raise ProblemError(409, "Accept first", f"A work order must be accepted before it is completed (status: {wo['status']}).")
        if wo.get("accepted_by") != actor:
            raise ProblemError(409, "Accepted by another supervisor", "Only the supervisor who accepted this order can complete it.")
        if not photo:
            raise ProblemError(422, "Photo required", "Completion needs a photo taken at the site.")
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ProblemError(422, "GPS required", "Completion needs the GPS position of the site.")
        try:
            clean, grid = sanitise_photo(photo, lat, lon)
        except Exception as exc:  # noqa: BLE001 - unreadable image
            raise ProblemError(422, "Unreadable image", "Upload a JPEG or PNG photo.") from exc
        self.photo_dir.mkdir(parents=True, exist_ok=True)
        (self.photo_dir / f"{work_order_id}.jpg").write_bytes(clean)
        at = self.clock()
        self._transition(wo, "completed", actor, {"grid_ref": grid})
        wo["completed_at"], wo["completed_by"], wo["completion_grid_ref"] = at, actor, grid
        view = self.view(wo)
        self._completions[work_order_id] = {"request_id": request_id, "view": view}
        self.on_update(view)
        await self.p.municipal.emit(Event(type=WORKORDER_COMPLETED, payload={"work_order_id": work_order_id, "completed_at": at, "gps_cell": grid}))
        return view, False
