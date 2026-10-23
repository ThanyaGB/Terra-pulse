"""Application services behind the farmer/FPO endpoints: calls, keypad handling, bookings, collections."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from agents.runtime import Platform
from agents.world import Parcel
from api.masking import clear
from api.problem import ProblemError
from integrations.ratelimit import RateLimitExceeded
from integrations.telephony import CallRecord, TelephonyAdapter


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Ops:
    def __init__(self, platform: Platform, telephony: TelephonyAdapter, limiter: Any) -> None:
        self.p, self.tel, self.limiter = platform, telephony, limiter
        self.calls: dict[str, dict[str, Any]] = {}
        self.by_parcel: dict[str, list[str]] = {}
        self.callbacks: list[dict[str, Any]] = []

    # ---- helpers ----
    def parcel(self, parcel_id: str) -> Parcel:
        pr = self.p.world.parcels.get(parcel_id)
        if pr is None:
            raise ProblemError(404, "Parcel not found", f"No parcel {parcel_id!r}.")
        return pr

    def audit(self, actor: str, action: str, payload: dict[str, Any]) -> None:
        self.p.audit.append(actor, action, payload)

    # ---- calls ----
    def trigger_call(self, parcel_id: str, actor: str, lang: str = "pa") -> dict[str, Any]:
        parcel = self.parcel(parcel_id)
        try:
            self.limiter.hit(f"call:{parcel_id}")
        except RateLimitExceeded as exc:
            raise ProblemError(429, "Call limit reached", str(exc), type_="https://vayu-swachh.example/problems/rate-limit",
                               headers={"Retry-After": str(exc.retry_after_s)}) from exc
        self.audit(actor, "call.trigger", {"parcel_id": parcel_id})
        rec: CallRecord = self.tel.place_call(parcel_id, parcel.phone, f"/v1/calls/session?parcel_id={parcel_id}&lang={lang}", "/v1/calls/webhook")
        script = self.p.world.scripts.get(parcel_id, {}).get(lang, [])
        call = {"call_id": rec.call_id, "parcel_id": parcel_id, "provider": rec.provider, "status": "queued", "started_at": now_iso(),
                "lang": lang, "transcript": [{"at": now_iso(), "speaker": "agent", "text": t} for t in script], "intent": None,
                "keys": []}
        self.calls[rec.call_id] = call
        self.by_parcel.setdefault(parcel_id, []).append(rec.call_id)
        return {"call_id": rec.call_id, "status": "queued", "provider": rec.provider}

    def call_log(self, call_id: str) -> dict[str, Any]:
        c = self.calls.get(call_id)
        if c is None:
            raise ProblemError(404, "Call not found", f"No call {call_id!r}.")
        return {**c, "farmer_phone": self.parcel(c["parcel_id"]).phone}   # masked by the response class

    # ---- keypad (IVR / simulator) ----
    async def handle_key(self, parcel_id: str, key: str, via_call: str | None = None, actor: str = "ivr") -> dict[str, Any]:
        self.parcel(parcel_id)   # 404 for an unknown parcel
        if key not in ("1", "2", "9"):
            raise ProblemError(400, "Unknown key", "Press 1, 2 or 9.")
        self.audit(actor, "call.keypress", {"parcel_id": parcel_id, "key": key})
        call = self.calls.get(via_call) if via_call else None
        if call is not None:
            call["keys"].append(key)
            call["intent"] = {"1": "book_machine", "2": "collect_straw", "9": "agronomist"}[key]
        if key == "1":
            booking = await self.create_booking(parcel_id, None, actor)
            booking = self.confirm_booking(booking["booking_id"], actor)
            return {"key": key, "status": "confirmed", "reference_id": booking["booking_id"], "booking": booking}
        if key == "2":
            col = self.request_collection(parcel_id, actor)
            return {"key": key, "status": "confirmed", "reference_id": col["request_id"], "collection": col}
        cb = {"callback_id": f"CB-{len(self.callbacks) + 1:04d}", "parcel_id": parcel_id, "requested_at": now_iso(), "topic": "agronomist"}
        self.callbacks.append(cb)
        return {"key": key, "status": "connecting", "reference_id": cb["callback_id"]}

    # ---- bookings ----
    async def create_booking(self, parcel_id: str, machinery_id: str | None, actor: str, machine_type: str | None = None) -> dict[str, Any]:
        parcel = self.parcel(parcel_id)
        booking = await self.p.advisory.create_booking(parcel, None, machinery_id, machine_type)
        if booking is None:
            raise ProblemError(409, "Machine unavailable", "The machine was just taken or none is free nearby; the FPO queue has the conflict.")
        self.audit(actor, "booking.created", {"booking_id": booking["booking_id"], "parcel_id": parcel_id})
        return self.booking_view(booking, role="fpo_coordinator")

    def confirm_booking(self, booking_id: str, actor: str) -> dict[str, Any]:
        b = self.p.world.bookings.get(booking_id)
        if b is None:
            raise ProblemError(404, "Booking not found", f"No booking {booking_id!r}.")
        if b["status"] == "pending_confirmation":
            b["status"], b["version"] = "confirmed", b["version"] + 1
            self.audit(actor, "booking.confirmed", {"booking_id": booking_id})
        return self.booking_view(b, role="farmer")

    def booking_view(self, b: dict[str, Any], role: str) -> dict[str, Any]:
        m = self.p.world.crm.machines[b["machinery_id"]]
        phone: Any = m.operator_phone
        if not (b["status"] == "confirmed" and role in ("farmer", "fpo_coordinator")):
            phone = m.operator_phone     # still masked by the response class (no clear() wrapper)
        else:
            phone = clear(m.operator_phone)   # ADR-06 exception: live booking, farmer + FPO only
        return {"booking_id": b["booking_id"], "status": b["status"], "parcel_id": b["parcel_id"],
                "machinery": {"id": m.id, "type": m.type, "operator_name": m.operator_name, "operator_phone": phone, "distance_km": b["distance_km"]},
                "rental_rate_inr_per_acre": b["rental_rate_inr_per_acre"]}

    # ---- collections ----
    def request_collection(self, parcel_id: str, actor: str) -> dict[str, Any]:
        parcel = self.parcel(parcel_id)
        col = self.p.advisory.request_collection(parcel)
        self.audit(actor, "collection.requested", {"request_id": col["request_id"], "parcel_id": parcel_id})
        return col

    # ---- FPO view ----
    def parcel_status(self, parcel_id: str) -> str:
        bookings = [b for b in self.p.world.bookings.values() if b["parcel_id"] == parcel_id]
        if any(b["status"] == "dispatched" for b in bookings):
            return "dispatched"
        if any(b["status"] == "confirmed" for b in bookings):
            return "confirmed"
        return "called" if self.by_parcel.get(parcel_id) else "to_contact"
