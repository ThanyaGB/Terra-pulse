"""Machinery CRM connector. The real CRM is a private partner system (no public dataset), so this module defines
the connector interface and a deterministic simulator seeded around the Sangrur pilot. Replace SimulatedCrm with
an HTTP client implementing the same interface when access is granted. Event-driven + 5 minute polling (spec 6.1)."""
from __future__ import annotations

import random
import threading
from dataclasses import dataclass, field
from typing import Protocol

from .geo import VILLAGES, haversine_km

MACHINE_TYPES = ("super_seeder", "baler", "happy_seeder")


@dataclass
class Machine:
    id: str
    type: str
    lat: float
    lon: float
    operator_name: str
    operator_phone: str           # raw; masked at the API boundary (ADR-06)
    status: str = "available"     # available | in_use | maintenance
    pto_hours: float = 0.0
    version: int = 1              # optimistic locking (spec 9)


class MachineryCrm(Protocol):
    def list_machines(self) -> list[Machine]: ...
    def reserve(self, machine_id: str, expected_version: int) -> Machine: ...


class VersionConflict(Exception):
    pass


@dataclass
class SimulatedCrm:
    seed: int = 2026
    machines: dict[str, Machine] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def __post_init__(self) -> None:
        rnd = random.Random(self.seed)
        names = ["Gurmeet Singh", "Harpreet Singh", "Jaswinder Singh", "Balwinder Singh", "Sukhdev Singh", "Manjit Singh",
                 "Kuldeep Singh", "Paramjit Singh"]
        counts = {"super_seeder": 6, "baler": 5, "happy_seeder": 8}
        n = 0
        for mtype, count in counts.items():
            prefix = {"super_seeder": "SS", "baler": "BL", "happy_seeder": "HS"}[mtype]
            for i in range(count):
                v = VILLAGES[(n * 3) % len(VILLAGES)]
                n += 1
                mid = f"{prefix}-{i + 1:02d}"
                self.machines[mid] = Machine(
                    mid, mtype, v.lat + rnd.uniform(-0.02, 0.02), v.lon + rnd.uniform(-0.02, 0.02),
                    rnd.choice(names), f"98{rnd.randint(100, 199)}{rnd.randint(10000, 99999)}"[:10],
                    status="in_use" if rnd.random() < 0.55 else "available", pto_hours=round(rnd.uniform(40, 400), 1))

    def list_machines(self) -> list[Machine]:
        return list(self.machines.values())

    def reserve(self, machine_id: str, expected_version: int) -> Machine:
        with self._lock:   # compare-and-set must be atomic
            m = self.machines[machine_id]
            if m.version != expected_version or m.status != "available":
                raise VersionConflict(f"{machine_id} is at version {m.version} ({m.status})")
            m.status, m.version = "in_use", m.version + 1
            return m

    def nearest_available(self, mtype: str, lat: float, lon: float) -> tuple[Machine, float] | None:
        cands = [m for m in self.machines.values() if m.type == mtype and m.status == "available"]
        if not cands:
            return None
        best = min(cands, key=lambda m: haversine_km(lat, lon, m.lat, m.lon))
        return best, haversine_km(lat, lon, best.lat, best.lon)
