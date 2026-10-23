"""Machinery CRM sync (T4.4): optimistic locking on `version`. On a version mismatch the booking is not applied; the
machine is re-read and the conflict is surfaced to the FPO queue."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from ingestion.crm import Machine, MachineryCrm, VersionConflict


@dataclass
class ConflictItem:
    machine_id: str
    parcel_id: str
    expected_version: int
    current_version: int
    current_status: str
    at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CrmSync:
    def __init__(self, crm: MachineryCrm) -> None:
        self.crm = crm
        self.fpo_queue: list[ConflictItem] = []

    def pull(self) -> list[Machine]:
        return self.crm.list_machines()

    def push_booking(self, machine_id: str, parcel_id: str, expected_version: int) -> Machine | None:
        """Returns the updated machine, or None when it lost a race (conflict is queued for the FPO)."""
        try:
            return self.crm.reserve(machine_id, expected_version)
        except VersionConflict:
            fresh = next(m for m in self.crm.list_machines() if m.id == machine_id)   # re-read
            self.fpo_queue.append(ConflictItem(machine_id, parcel_id, expected_version, fresh.version, fresh.status))
            return None
