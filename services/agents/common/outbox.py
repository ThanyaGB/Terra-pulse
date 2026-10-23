"""Outbox pattern (ADR-02): events are persisted before they are published, so Redis can be rebuilt.

SQLite keeps the dev setup dependency-free; the Postgres `outbox` table in db/migrations has the same shape.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

from .bus import Bus
from .events import Event


class SqliteOutbox:
    def __init__(self, path: str = ":memory:") -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS outbox (event_id TEXT PRIMARY KEY, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0)"
        )
        self._db.commit()

    def add(self, event: Event) -> None:
        with self._lock:
            self._db.execute("INSERT OR IGNORE INTO outbox (event_id, body) VALUES (?, ?)", (event.event_id, event.model_dump_json()))
            self._db.commit()

    def pending(self) -> list[Event]:
        with self._lock:
            rows = self._db.execute("SELECT body FROM outbox WHERE published = 0 ORDER BY rowid").fetchall()
        return [Event.model_validate_json(r[0]) for r in rows]

    def mark_published(self, event_id: str) -> None:
        with self._lock:
            self._db.execute("UPDATE outbox SET published = 1 WHERE event_id = ?", (event_id,))
            self._db.commit()

    def all_events(self) -> list[Event]:
        with self._lock:
            rows = self._db.execute("SELECT body FROM outbox ORDER BY rowid").fetchall()
        return [Event.model_validate_json(r[0]) for r in rows]

    async def relay(self, bus: Bus) -> int:
        """Publish everything not yet published. Safe to call repeatedly (and after a crash)."""
        n = 0
        for ev in self.pending():
            await bus.publish(ev)
            self.mark_published(ev.event_id)
            n += 1
        return n
