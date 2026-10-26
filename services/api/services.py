"""Application services behind the farmer/FPO endpoints: calls, keypad handling, bookings, collections."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from agents.runtime import Platform
from agents.world import Parcel
from api.fpo_desk import FpoDesk
from api.masking import clear
from api.problem import ProblemError
from domain.config import load_yaml
from domain.features import FeatureFlags
from integrations.audio import AudioService
from integrations.ratelimit import RateLimitExceeded
from integrations.telephony import CallRecord, OutsideCallingHours, TelephonyAdapter, calling_window, within_calling_hours

MENU_KEYS = ("1", "2", "9")
MACHINE_KEYS = {"1": "super_seeder", "2": "happy_seeder"}   # after menu 1: which machine
CONFIRM_KEY, BACK_KEY, REPEAT_KEY = "1", "0", "*"
MACHINE_STEP = "machine"                                     # pending value while the farmer picks a machine
INTENTS = {"1": "book_machine", "2": "collect_straw", "9": "talk_to_fpo"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Ops:
    def __init__(self, platform: Platform, telephony: TelephonyAdapter, limiter: Any, features: FeatureFlags | None = None,
                 desk: FpoDesk | None = None, audio: AudioService | None = None) -> None:
        self.p, self.tel, self.limiter = platform, telephony, limiter
        self.features = features or FeatureFlags.load()
        self.desk = desk or FpoDesk(self.tel.clock)
        self.audio = audio
        self.calls: dict[str, dict[str, Any]] = {}
        self.by_parcel: dict[str, list[str]] = {}
        # parcel_id -> keypad step: "machine" (choosing a machine after 1), or the choice waiting for 1 = confirm / 0 = back
        # ("super_seeder", "happy_seeder", "2", "9"). No entry means the farmer is at the menu.
        self.pending: dict[str, str] = {}

    # ---- helpers ----
    def parcel(self, parcel_id: str) -> Parcel:
        pr = self.p.world.parcels.get(parcel_id)
        if pr is None:
            raise ProblemError(404, "Parcel not found", f"No parcel {parcel_id!r}.")
        return pr

    def audit(self, actor: str, action: str, payload: dict[str, Any]) -> None:
        self.p.audit.append(actor, action, payload)

    # ---- calls ----
    def disclosure(self, lang: str) -> str:
        d = load_yaml("telephony.yaml")["disclosure"]
        return str(d.get(lang) or d["en"])

    def script_lines(self, parcel_id: str, lang: str) -> list[str]:
        """Every call opens with the disclosure line (spec 10.2), then the stored, versioned script."""
        return [self.disclosure(lang), *self.p.world.scripts.get(parcel_id, {}).get(lang, [])]

    def trigger_call(self, parcel_id: str, actor: str, lang: str = "pa") -> dict[str, Any]:
        parcel = self.parcel(parcel_id)
        if not self.features.enabled("TELEPHONY_ENABLED"):
            raise ProblemError(503, "Telephony is off", "Outbound calls are disabled (feature flag TELEPHONY_ENABLED, gate G1). Nothing was dialled.",
                               type_="https://vayu-swachh.example/problems/feature-off")
        if not within_calling_hours(self.tel.clock()):
            start, end, tz = calling_window()
            raise ProblemError(409, "Outside calling hours", f"Calls are placed only {start:%H:%M}-{end:%H:%M} {tz.key}.",
                               type_="https://vayu-swachh.example/problems/calling-hours")
        try:
            self.limiter.hit(f"call:{parcel_id}")
        except RateLimitExceeded as exc:
            raise ProblemError(429, "Call limit reached", str(exc), type_="https://vayu-swachh.example/problems/rate-limit",
                               headers={"Retry-After": str(exc.retry_after_s)}) from exc
        self.audit(actor, "call.trigger", {"parcel_id": parcel_id})
        try:
            rec: CallRecord = self.tel.place_call(parcel_id, parcel.phone, f"/v1/calls/session?parcel_id={parcel_id}&lang={lang}", "/v1/calls/webhook")
        except OutsideCallingHours as exc:
            raise ProblemError(409, "Outside calling hours", str(exc)) from exc
        script = self.script_lines(parcel_id, lang)
        call = {"call_id": rec.call_id, "parcel_id": parcel_id, "provider": rec.provider, "status": "queued", "started_at": now_iso(),
                "lang": lang, "transcript": [{"at": now_iso(), "speaker": "agent", "text": t} for t in script], "intent": None,
                "keys": []}
        self.calls[rec.call_id] = call
        self.reset_keypad(parcel_id)
        self.by_parcel.setdefault(parcel_id, []).append(rec.call_id)
        return {"call_id": rec.call_id, "status": "queued", "provider": rec.provider}

    def call_log(self, call_id: str) -> dict[str, Any]:
        c = self.calls.get(call_id)
        if c is None:
            raise ProblemError(404, "Call not found", f"No call {call_id!r}.")
        return {**c, "farmer_phone": self.parcel(c["parcel_id"]).phone}   # masked by the response class

    # ---- keypad (IVR / simulator) ----
    async def handle_key(self, parcel_id: str, key: str, via_call: str | None = None, actor: str = "ivr", lang: str = "pa") -> dict[str, Any]:
        """Keypad steps (ADR-09). The menu: 1 machine, 2 straw pickup, 9 talk to an FPO worker. After 1 the farmer picks the
        machine: 1 Super Seeder, 2 Happy Seeder (0 goes back). Nothing happens yet; the farmer hears what they chose. Then 1
        confirms and only then is the booking, pickup or FPO request made; 0 goes back to the menu. * at any step repeats what
        the farmer is being asked (the whole call message at the menu)."""
        from agents.advisory_agent import keypad_prompt, machine_menu_prompt
        self.parcel(parcel_id)   # 404 for an unknown parcel
        call = self.calls.get(via_call) if via_call else None
        if call is not None:
            lang = call.get("lang", lang)
        choice = self.pending.get(parcel_id)
        step = "menu" if choice is None else "machine" if choice == MACHINE_STEP else "confirm"
        allowed = {"menu": MENU_KEYS, "machine": (*MACHINE_KEYS, BACK_KEY), "confirm": (CONFIRM_KEY, BACK_KEY)}[step]
        if key != REPEAT_KEY and key not in allowed:
            hint = {"menu": "Press 1, 2 or 9", "machine": "Press 1 for the Super Seeder, 2 for the Happy Seeder, or 0 to go back",
                    "confirm": "Press 1 to confirm or 0 to go back"}[step]
            raise ProblemError(400, "Unknown key", f"{hint}. Press * to hear the message again.")
        self.audit(actor, "call.keypress", {"parcel_id": parcel_id, "key": key, "step": step})
        if call is not None:
            call["keys"].append(key)
        if key == REPEAT_KEY:                                  # * repeats; the step does not change
            if step == "menu":
                return {"key": key, "status": "repeat", "step": step, "prompt": "call_script", "lines": self.script_lines(parcel_id, lang)}
            if step == "machine":
                return {"key": key, "status": "repeat", "step": step, "prompt": "machine_menu", "prompt_text": machine_menu_prompt(lang)}
            return {"key": key, "status": "repeat", "step": step, "prompt": f"confirm_{choice}", "prompt_text": keypad_prompt(lang, choice)}
        if key == BACK_KEY:                                    # 0 goes back to the menu, nothing was booked
            del self.pending[parcel_id]
            if call is not None:
                call["intent"] = None
            back_key = "1" if step == "machine" or choice in MACHINE_KEYS.values() else choice
            return {"key": back_key, "status": "cancelled", "prompt": "back_to_menu", "prompt_text": keypad_prompt(lang)}
        if step == "menu" and key == "1":                      # menu 1: which machine?
            self.pending[parcel_id] = MACHINE_STEP
            if call is not None:
                call["intent"] = INTENTS[key]
            return {"key": key, "status": "choose_machine", "prompt": "machine_menu", "prompt_text": machine_menu_prompt(lang)}
        if step == "machine":                                  # machine picked: ask for confirmation
            machine = MACHINE_KEYS[key]
            self.pending[parcel_id] = machine
            return {"key": "1", "machine_type": machine, "status": "awaiting_confirmation", "prompt": f"confirm_{machine}",
                    "prompt_text": keypad_prompt(lang, machine)}
        if step == "menu":                                     # menu 2 or 9: ask for confirmation
            self.pending[parcel_id] = key
            if call is not None:
                call["intent"] = INTENTS[key]
            return {"key": key, "status": "awaiting_confirmation", "prompt": f"confirm_{key}", "prompt_text": keypad_prompt(lang, key)}
        del self.pending[parcel_id]                            # the confirming 1
        if choice in MACHINE_KEYS.values():
            booking = await self.create_booking(parcel_id, None, actor, machine_type=choice)
            booking = self.confirm_booking(booking["booking_id"], actor)
            # one open booking per parcel: if one already existed, report the machine actually booked
            return {"key": "1", "machine_type": booking["machinery"]["type"], "status": "confirmed", "reference_id": booking["booking_id"],
                    "booking": booking}
        if choice == "2":
            col = self.request_collection(parcel_id, actor)
            return {"key": choice, "status": "confirmed", "reference_id": col["request_id"], "collection": col}
        res = self.desk.request(parcel_id)          # ADR-22: FPO worker queue in pilot hours, else a callback slot
        self.audit(actor, "fpo_desk.requested", {"parcel_id": parcel_id, **res})
        return {"key": choice, **res}

    def reset_keypad(self, parcel_id: str) -> None:
        """A new call starts at the menu, even if the last one hung up between the two steps."""
        self.pending.pop(parcel_id, None)

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
                "rental_rate_inr_per_acre": b["rental_rate_inr_per_acre"], "rate_source": b.get("rate_source")}

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
