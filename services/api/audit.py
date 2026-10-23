"""Append-only audit log with hash chaining (spec section 10, T1.1/T3.4). Each entry's hash covers the previous hash,
so any edit or deletion breaks verification."""
from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

GENESIS = "0" * 64


@dataclass(frozen=True)
class AuditEntry:
    seq: int
    at: str
    actor: str
    action: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str


def _digest(seq: int, at: str, actor: str, action: str, payload: dict[str, Any], prev_hash: str) -> str:
    body = json.dumps([seq, at, actor, action, payload, prev_hash], sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode()).hexdigest()


class AuditLog:
    def __init__(self) -> None:
        self._entries: list[AuditEntry] = []
        self._lock = threading.Lock()

    def append(self, actor: str, action: str, payload: dict[str, Any] | None = None) -> AuditEntry:
        with self._lock:
            prev = self._entries[-1].hash if self._entries else GENESIS
            seq = len(self._entries) + 1
            at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
            entry = AuditEntry(seq, at, actor, action, payload or {}, prev, _digest(seq, at, actor, action, payload or {}, prev))
            self._entries.append(entry)
            return entry

    def entries(self) -> list[AuditEntry]:
        return list(self._entries)

    def verify(self) -> bool:
        prev = GENESIS
        for e in self._entries:
            if e.prev_hash != prev or e.hash != _digest(e.seq, e.at, e.actor, e.action, e.payload, e.prev_hash):
                return False
            prev = e.hash
        return True

    def export(self) -> list[dict[str, Any]]:
        return [asdict(e) for e in self._entries]
