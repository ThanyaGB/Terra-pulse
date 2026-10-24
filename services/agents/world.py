"""Shared world state: the in-process snapshot every agent writes to and the API reads from (ADR-02 'shared state
snapshots'). Plain dicts so it can be mirrored to Redis as JSON."""
from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ingestion.crm import SimulatedCrm
from ingestion.geo import VILLAGES
from ingestion.pipeline import Snapshot

FIRST = ["Gurpreet", "Harjinder", "Baljit", "Jagdev", "Manpreet", "Sukhwinder", "Amarjit", "Kulwant", "Rajinder", "Charanjit"]
MACHINE_NEEDS = ["super_seeder", "baler", "happy_seeder"]


@dataclass
class Parcel:
    id: str
    farmer_name: str
    phone: str            # raw 10 digit; masked at the API boundary
    village_id: str
    acres: float
    harvest_start: date
    machine_need: str
    lat: float
    lon: float


def make_parcels(today: date, n: int = 24, seed: int = 2026) -> list[Parcel]:
    """Synthetic parcel registry for the Sangrur pilot. Parcel and farmer records are private data, so there is
    no public dataset: names, phones and areas are generated; only the villages and their coordinates are real."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        v = VILLAGES[i % len(VILLAGES)]
        out.append(Parcel(
            id=f"PCL-SGR-{400 + i * 13:04d}", farmer_name=f"{FIRST[i % len(FIRST)]} {'Kaur' if i % 4 == 2 else 'Singh'}",
            phone=f"98{rnd.randint(100, 899)}{rnd.randint(10000, 99999)}"[:10], village_id=v.id,
            acres=float(rnd.randint(3, 17)), harvest_start=today + timedelta(days=rnd.randint(7, 10) if i % 3 else rnd.randint(2, 6) + 7),
            machine_need=MACHINE_NEEDS[rnd.randint(0, 2)], lat=v.lat + rnd.uniform(-0.01, 0.01), lon=v.lon + rnd.uniform(-0.01, 0.01)))
    return out


@dataclass
class World:
    today: date = field(default_factory=lambda: datetime.now(timezone.utc).date())
    snapshot: Snapshot | None = None
    parcels: dict[str, Parcel] = field(default_factory=dict)
    crm: SimulatedCrm = field(default_factory=SimulatedCrm)
    risk: dict[str, dict[str, Any]] = field(default_factory=dict)          # parcel id -> score/tier/components
    village_risk: dict[str, dict[str, Any]] = field(default_factory=dict)
    forecast: dict[str, dict[str, Any]] = field(default_factory=dict)      # area id -> series + current
    grid: list[dict[str, Any]] = field(default_factory=list)               # 1 km grid cells
    attribution: dict[str, dict[str, Any]] = field(default_factory=dict)   # area id / 'ncr' -> shares
    plume: dict[str, Any] = field(default_factory=dict)
    bookings: dict[str, dict[str, Any]] = field(default_factory=dict)
    collections: dict[str, dict[str, Any]] = field(default_factory=dict)
    scripts: dict[str, dict[str, list[str]]] = field(default_factory=dict) # parcel id -> lang -> lines
    advice: dict[str, list[dict[str, Any]]] = field(default_factory=dict)  # 'area|profile' -> items (daily rules)
    routes: dict[str, dict[str, Any]] = field(default_factory=dict)        # 'from|to' -> options
    work_orders: dict[str, dict[str, Any]] = field(default_factory=dict)
    roi: list[dict[str, Any]] = field(default_factory=list)
    agent_health: dict[str, dict[str, Any]] = field(default_factory=dict)
    contracts: list[dict[str, Any]] | None = None     # partner contracts; None = read config/partner_rates.yaml

    def __post_init__(self) -> None:
        if not self.parcels:
            self.parcels = {p.id: p for p in make_parcels(self.today)}
