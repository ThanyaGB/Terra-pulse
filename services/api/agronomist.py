"""Keypad 9: agronomist queue or callback slot (ADR-22, gate G4). The queue is staffed by FPO coordinators in pilot hours.
Outside them, or with nobody on the roster, the farmer is offered the next callback slot. With neither a roster nor slots
configured the request is recorded and no response time is promised."""
from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

from domain.config import load_yaml


class AgronomistDesk:
    def __init__(self, clock: Callable[[], datetime] | None = None, cfg: dict[str, Any] | None = None) -> None:
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.cfg = cfg or load_yaml("agronomist.yaml")
        self.queue: list[dict[str, Any]] = []
        self.callbacks: list[dict[str, Any]] = []
        self._slot_use: dict[tuple[str, str], int] = {}

    def staffed_now(self, now: datetime | None = None) -> bool:
        h = self.cfg["pilot_hours"]
        t = (now or self.clock()).astimezone(ZoneInfo(h["tz"])).time()
        return bool(self.cfg["roster"]) and time.fromisoformat(h["start"]) <= t < time.fromisoformat(h["end"])

    def _next_slot(self, now: datetime) -> tuple[str, str] | None:
        tz = ZoneInfo(self.cfg["pilot_hours"]["tz"])
        local = now.astimezone(tz)
        for day in (0, 1, 2):
            d = (local + timedelta(days=day)).date()
            for slot in sorted(self.cfg["callback_slots"]):
                start = datetime.combine(d, time.fromisoformat(slot), tzinfo=tz)
                if start > local and self._slot_use.get((d.isoformat(), slot), 0) < int(self.cfg["slot_capacity"]):
                    return d.isoformat(), slot
        return None

    def request(self, parcel_id: str) -> dict[str, Any]:
        now = self.clock()
        if self.staffed_now(now):
            ref = f"AG-Q-{len(self.queue) + 1:04d}"
            entry: dict[str, Any] = {"reference_id": ref, "parcel_id": parcel_id, "requested_at": now.isoformat(timespec="seconds"), "kind": "queue", "status": "queued"}
            self.queue.append(entry)
            return {"status": "queued", "reference_id": ref, "position": sum(1 for e in self.queue if e["status"] == "queued")}
        ref = f"AG-C-{len(self.callbacks) + 1:04d}"
        slot = self._next_slot(now)
        entry = {"reference_id": ref, "parcel_id": parcel_id, "requested_at": now.isoformat(timespec="seconds"), "kind": "callback"}
        if slot is None:
            entry["status"] = "callback_unscheduled"
            self.callbacks.append(entry)
            return {"status": "callback_unscheduled", "reference_id": ref, "slot": None}
        self._slot_use[slot] = self._slot_use.get(slot, 0) + 1
        entry.update(status="callback_slot", slot={"date": slot[0], "start": slot[1]})
        self.callbacks.append(entry)
        return {"status": "callback_slot", "reference_id": ref, "slot": {"date": slot[0], "start": slot[1]}}
