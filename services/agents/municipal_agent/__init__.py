"""Municipal Action Agent (T2.7): GRAP tier mapping, work orders to MCD, diversion proposals needing a second approver
(ADR-07), SLA tracking, and PM2.5 change 4-12 h after completion against a matched control station (spec 5.5).

Note: the PM2.5 series available here is the CAMS model, not a physical station, so measured deltas show how the ROI
pipeline works end to end; real ROI needs CAAQMS readings (open question 8)."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from agents.common import BaseAgent, Bus, Event
from agents.common.events import ATTRIBUTION_UPDATED, ROI_MEASURED, WORKORDER_CREATED
from agents.world import World
from api.directives import DirectiveService
from domain import roi as roi_domain
from domain.grap import grap_tier
from ingestion.geo import AREAS, haversine_km
from integrations.mcd import McdIntegration

SLA_HOURS = 6
SYSTEM_ACTOR = "municipal_agent"
FIELD_ACTIONS = {"fog_cannons", "road_sweeping", "dust_suppression"}
AREA_NAMES = {a.id: a.name for a in AREAS}


def matched_control(area_id: str, candidates: list[str], world: World) -> str | None:
    """Closest other monitored area with a similar baseline PM2.5 and no action in the window."""
    here = world.forecast.get(area_id)
    if here is None:
        return None
    busy = {w["area_id"] for w in world.work_orders.values() if w["status"] != "completed"}
    best, best_score = None, float("inf")
    for c in candidates:
        f = world.forecast.get(c)
        if c == area_id or f is None or c in busy:
            continue
        score = abs(f["pm25"] - here["pm25"]) + haversine_km(here["lat"], here["lng"], f["lat"], f["lng"]) * 0.5
        if score < best_score:
            best, best_score = c, score
    return best


class MunicipalActionAgent(BaseAgent):
    name = "municipal_agent"
    subscribes = (ATTRIBUTION_UPDATED,)

    def __init__(self, bus: Bus, world: World, directives: DirectiveService, mcd: McdIntegration | None = None,
                 clock: Callable[[], datetime] | None = None, **kw: Any) -> None:
        super().__init__(bus, **kw)
        self.world, self.directives = world, directives
        self.mcd = mcd or McdIntegration()
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._open: set[tuple[str, str]] = set()   # (area, action) with an open work order

    async def handle(self, event: Event) -> None:
        for area_id, f in self.world.forecast.items():
            shares = self.world.attribution.get(area_id, {}).get("shares")
            res = grap_tier(f["aqi"], shares)
            for act in res.actions:
                if act.type in FIELD_ACTIONS and (area_id, act.type) not in self._open:
                    await self._work_order(area_id, act.type, res.tier, event)
        # a diversion is city-wide: propose once per tier when the worst area warrants it
        worst = max(self.world.forecast.values(), key=lambda f: f["aqi"], default=None)
        if worst is not None:
            res = grap_tier(worst["aqi"], self.world.attribution.get(worst["area_id"], {}).get("shares"))
            if any(a.type == "diversion_trucks" for a in res.actions) and not any(
                    d["type"] == "diversion_trucks" and d["status"] in ("pending_approval", "dispatched") for d in self.directives.directives.values()):
                self.directives.create("diversion_trucks", [worst["area_id"]], SYSTEM_ACTOR)   # waits for a human approver

    async def _work_order(self, area_id: str, action: str, tier: str, event: Event) -> None:
        wid = f"WO-{secrets.token_hex(3).upper()}"
        now = self.clock()
        wo: dict[str, Any] = {"id": wid, "area_id": area_id, "area": AREA_NAMES.get(area_id, area_id), "action_type": action, "grap_tier": tier,
                              "status": "created", "created_at": now.isoformat(timespec="seconds"),
                              "sla_due_at": (now + timedelta(hours=SLA_HOURS)).isoformat(timespec="seconds"), "sla_breached": False}
        self.world.work_orders[wid] = wo
        self._open.add((area_id, action))
        self.mcd.dispatch({"id": wid, "action_type": action, "location": area_id})
        wo["status"] = "dispatched"
        await self.emit(event.child(WORKORDER_CREATED, {"work_order_id": wid, "action_type": action, "location": area_id}))

    def complete(self, work_order_id: str, when: datetime | None = None) -> None:
        """Called from the MCD completion webhook."""
        wo = self.world.work_orders[work_order_id]
        self.mcd.webhook(work_order_id, status="completed")
        wo["status"], wo["completed_at"] = "completed", (when or self.clock()).isoformat(timespec="seconds")
        self._open.discard((wo["area_id"], wo["action_type"]))

    def sla_sweep(self) -> list[str]:
        now = self.clock()
        late = []
        for wo in self.world.work_orders.values():
            if wo["status"] != "completed" and now > datetime.fromisoformat(wo["sla_due_at"]):
                wo["sla_breached"] = True
                late.append(wo["id"])
        return late

    async def measure_roi(self, work_order_id: str, treated: list[float], control: list[float], completed_idx: int,
                          hours_after: float) -> dict[str, Any]:
        """treated/control are hourly PM2.5 series; completed_idx is the hour of completion. Valid 4-12 h after completion."""
        if not roi_domain.in_window(hours_after):
            raise ValueError(f"ROI is measured 4-12 h after completion, got {hours_after} h")
        wo = self.world.work_orders[work_order_id]
        k = int(hours_after)
        pre_t, post_t = treated[max(0, completed_idx - 4):completed_idx], treated[completed_idx + 4:completed_idx + k + 1]
        pre_c, post_c = control[max(0, completed_idx - 4):completed_idx], control[completed_idx + 4:completed_idx + k + 1]
        delta = roi_domain.net_effect(pre_t, post_t, pre_c, post_c)
        rec = {"work_order_id": work_order_id, "area": wo["area_id"], "delta_pm25": delta, "raw_delta_pm25": roi_domain.delta_pm25(pre_t, post_t),
               "control_area": wo.get("control_area"), "measured_at": self.clock().isoformat(timespec="seconds")}
        self.world.roi.append(rec)
        await self.emit(Event(type=ROI_MEASURED, payload={"work_order_id": work_order_id, "delta_pm25": delta}))
        return rec
