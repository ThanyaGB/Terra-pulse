"""Farmer Advisory and Logistics Agent (T2.5): economics-first scripts (ADR-08), nearest-machine matching,
collection requests, idempotent bookings. Rates and the buy-back line come only from an active partner contract (ADR-17).
Subscribes to risk.updated; publishes booking.created."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Mapping

from agents.common import BaseAgent, Event
from agents.common.events import BOOKING_CREATED, RISK_UPDATED
from agents.world import Parcel, World
from domain import partners
from domain.config import load_yaml
from ingestion.crm import Machine
from integrations.biocng import BioCngPartner, CollectionRequest
from integrations.machinery_crm import CrmSync

AREA_ID = "sangrur"       # the pilot area that partner contracts are written for
BOOKING_TIERS = {"high", "critical"}
TONNES_PER_ACRE = 2.5   # paddy straw yield assumption; replace with measured yields


def load_scripts_cfg() -> dict[str, Any]:
    return load_yaml("farmer_scripts_v1.yaml")


def blocked_words_found(text: str, lang: str, cfg: dict[str, Any] | None = None) -> list[str]:
    cfg = cfg or load_scripts_cfg()
    low = text.lower()
    return [w for w in cfg["blocked_words"].get(lang, []) if w.lower() in low]


def contract_rates(world: World, cfg: dict[str, Any] | None = None) -> dict[str, partners.Rate]:
    """Alias (seeder_rate, straw_price) -> Rate, for each rate that an active contract backs. Absent when none does."""
    cfg = cfg or load_scripts_cfg()
    out: dict[str, partners.Rate] = {}
    for alias, key in cfg["rate_keys"].items():
        r = partners.rate(AREA_ID, key, world.today, world.contracts)
        if r is not None:
            out[alias] = r
    return out


def render_script(lang: str, name: str, days_to_harvest: int, cfg: dict[str, Any] | None = None,
                  rates: Mapping[str, partners.Rate] | None = None) -> list[str]:
    """Script lines for a farmer. A line marked `requires` is left out unless `rates` has that rate (no active contract, no price)."""
    cfg = cfg or load_scripts_cfg()
    rates = rates or {}
    fmt: dict[str, Any] = {"name": name, "days_to_harvest": days_to_harvest}
    if "seeder_rate" in rates:
        fmt["seeder_rate"] = f"{rates['seeder_rate'].value:g}"
    if "straw_price" in rates:
        fmt["straw_price"] = f"{rates['straw_price'].value:,.0f}"
    lines: list[str] = []
    for item in cfg["lines"][lang]:
        text, need = (item, None) if isinstance(item, str) else (item["text"], item.get("requires"))
        if need is not None and need not in rates:
            continue
        lines.append(text.format(**fmt))
    bad = [w for ln in lines for w in blocked_words_found(ln, lang, cfg)]
    if bad:
        raise ValueError(f"punitive wording in {lang} script: {bad}")
    return lines


def keypad_prompt(lang: str, choice: str | None = None, cfg: dict[str, Any] | None = None) -> str:
    """Second keypad step (ADR-09): the confirm line for a menu choice (1, 2 or 9), or the back-to-menu line when choice is None."""
    cfg = cfg or load_scripts_cfg()
    table = cfg["confirm"] if choice is not None else cfg["back_to_menu"]
    by_lang = table.get(lang) or table["en"]
    text = str(by_lang[choice] if choice is not None else by_lang)
    bad = blocked_words_found(text, lang, cfg)
    if bad:
        raise ValueError(f"punitive wording in {lang} keypad prompt: {bad}")
    return text


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
        self.world.scripts[pid] = {lang: render_script(lang, parcel.farmer_name.split()[0], days, self.cfg, contract_rates(self.world, self.cfg)) for lang in ("pa", "hi", "en")}
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
        seeder = partners.rate(AREA_ID, self.cfg["rate_keys"]["seeder_rate"], self.world.today, self.world.contracts)
        updated = self.sync.push_booking(m.id, parcel.id, m.version)
        if updated is None:
            return None   # lost the race; conflict is in the FPO queue
        bid = f"BK-{datetime.now(timezone.utc):%Y%m%d}-{len(self.world.bookings) + 1:04d}"
        booking = {"booking_id": bid, "_key": key, "parcel_id": parcel.id, "machinery_id": m.id, "status": "pending_confirmation",
                   "distance_km": round(dist, 1), "rental_rate_inr_per_acre": int(seeder.value) if seeder else None, "rate_source": seeder.source if seeder else None,
                   "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "version": 1}
        self.world.bookings[bid] = booking
        ev = (event.child if event else Event(type=BOOKING_CREATED).child)(BOOKING_CREATED, {"booking_id": bid, "parcel_id": parcel.id, "machinery_id": m.id})
        await self.emit(ev)
        return booking

    def request_collection(self, parcel: Parcel) -> dict[str, Any]:
        tonnes = round(parcel.acres * TONNES_PER_ACRE, 1)
        r = partners.rate(AREA_ID, self.cfg["rate_keys"]["straw_price"], self.world.today, self.world.contracts)
        floor = int(r.value) if r else None
        rid = f"COL-{secrets.token_hex(3).upper()}"
        self.partner.request_collection(CollectionRequest(rid, parcel.id, tonnes, floor))
        rec = {"request_id": rid, "parcel_id": parcel.id, "estimated_tonnes": tonnes, "floor_price_inr_per_tonne": floor,
               "estimated_value_inr": round(tonnes * floor) if floor else None, "rate_source": r.source if r else None, "status": "requested"}
        self.world.collections[rid] = rec
        return rec


def _dist(parcel: Parcel, m: Machine) -> float:
    from ingestion.geo import haversine_km
    return haversine_km(parcel.lat, parcel.lon, m.lat, m.lon)
