"""Farmer Advisory and Logistics Agent (T2.5): economics-first scripts (ADR-08), nearest-machine matching,
floor-price collection requests, idempotent bookings. Subscribes to risk.updated; publishes booking.created."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from agents.common import BaseAgent, Event
from agents.common.events import BOOKING_CREATED, RISK_UPDATED
from agents.world import Parcel, World
from domain.config import load_yaml
from ingestion.crm import Machine
from integrations.biocng import BioCngPartner, CollectionRequest
from integrations.machinery_crm import CrmSync

BOOKING_TIERS = {"high", "critical"}
TONNES_PER_ACRE = 2.5   # paddy straw yield assumption; replace with measured yields


def load_scripts_cfg() -> dict[str, Any]:
    return load_yaml("farmer_scripts_v1.yaml")


def blocked_words_found(text: str, lang: str, cfg: dict[str, Any] | None = None) -> list[str]:
    cfg = cfg or load_scripts_cfg()
    low = text.lower()
    return [w for w in cfg["blocked_words"].get(lang, []) if w.lower() in low]


def render_script(lang: str, name: str, days_to_harvest: int, cfg: dict[str, Any] | None = None) -> list[str]:
    cfg = cfg or load_scripts_cfg()
    p = cfg["prices"]
    fmt = {"name": name, "days_to_harvest": days_to_harvest, "seeder_rate": p["seeder_rate_inr_per_acre"],
           "straw_price": f"{p['straw_floor_inr_per_tonne']:,}"}
    lines = [t.format(**fmt) for t in cfg["lines"][lang]]
    bad = [w for ln in lines for w in blocked_words_found(ln, lang, cfg)]
    if bad:
        raise ValueError(f"punitive wording in {lang} script: {bad}")
    return lines


def match_machine(world: World, machine_type: str, lat: float, lon: float) -> tuple[Machine, float] | None:
    return world.crm.nearest_available(machine_type, lat, lon)


class FarmerAdvisoryAgent(BaseAgent):
    name = "advisory_agent"
    subscribes = (RISK_UPDATED,)

    def __init__(self, bus, world: World, sync: CrmSync | None = None, partner: BioCngPartner | None = None, **kw: Any) -> None:  # type: ignore[no-untyped-def]
        super().__init__(bus, **kw)
        self.world = world
        self.sync = sync or CrmSync(world.crm)
        self.partner = partner or BioCngPartner()
        self.cfg = load_scripts_cfg()

    async def handle(self, event: Event) -> None:
        pid, tier = event.payload["parcel_id"], event.payload["tier"]
        parcel = self.world.parcels.get(pid)
        if parcel is None:
            return
        days = max(1, (parcel.harvest_start - self.world.today).days)
        self.world.scripts[pid] = {lang: render_script(lang, parcel.farmer_name.split()[0], days, self.cfg) for lang in ("pa", "hi", "en")}
        if tier in BOOKING_TIERS:
            await self.create_booking(parcel, event)

    async def create_booking(self, parcel: Parcel, event: Event | None = None, machinery_id: str | None = None,
                             machine_type: str | None = None) -> dict[str, Any] | None:
        if machinery_id:
            m = self.world.crm.machines.get(machinery_id)
            if m is None:
                return None
            dist = _dist(parcel, m)
        else:
            hit = match_machine(self.world, machine_type or parcel.machine_need, parcel.lat, parcel.lon)
            if hit is None:
                return None
            m, dist = hit
        key = f"{parcel.id}:{m.id}"
        existing = next((b for b in self.world.bookings.values() if b["_key"] == key and b["status"] != "cancelled"), None)
        if existing is not None:
            return existing   # idempotent on parcel + machinery
        # one open booking per parcel: a second machine for the same parcel is not created by the agent
        if any(b["parcel_id"] == parcel.id and b["status"] in ("pending_confirmation", "confirmed") for b in self.world.bookings.values()):
            return next(b for b in self.world.bookings.values() if b["parcel_id"] == parcel.id)
        updated = self.sync.push_booking(m.id, parcel.id, m.version)
        if updated is None:
            return None   # lost the race; conflict is in the FPO queue
        bid = f"BK-{datetime.now(timezone.utc):%Y%m%d}-{len(self.world.bookings) + 1:04d}"
        booking = {"booking_id": bid, "_key": key, "parcel_id": parcel.id, "machinery_id": m.id, "status": "pending_confirmation",
                   "distance_km": round(dist, 1), "rental_rate_inr_per_acre": self.cfg["prices"]["seeder_rate_inr_per_acre"],
                   "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "version": 1}
        self.world.bookings[bid] = booking
        ev = (event.child if event else Event(type=BOOKING_CREATED).child)(BOOKING_CREATED, {"booking_id": bid, "parcel_id": parcel.id, "machinery_id": m.id})
        await self.emit(ev)
        return booking

    def request_collection(self, parcel: Parcel) -> dict[str, Any]:
        tonnes = round(parcel.acres * TONNES_PER_ACRE, 1)
        floor = int(self.cfg["prices"]["straw_floor_inr_per_tonne"])
        rid = f"COL-{secrets.token_hex(3).upper()}"
        self.partner.request_collection(CollectionRequest(rid, parcel.id, tonnes, floor))
        rec = {"request_id": rid, "parcel_id": parcel.id, "estimated_tonnes": tonnes, "floor_price_inr_per_tonne": floor,
               "estimated_value_inr": round(tonnes * floor), "status": "requested"}
        self.world.collections[rid] = rec
        return rec


def _dist(parcel: Parcel, m: Machine) -> float:
    from ingestion.geo import haversine_km
    return haversine_km(parcel.lat, parcel.lon, m.lat, m.lon)
