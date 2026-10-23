"""Shared state snapshots (ADR-02). In-process dict by default; RedisState stores JSON under a key prefix."""
from __future__ import annotations

import json
from typing import Any


class MemoryState:
    def __init__(self) -> None:
        self._d: dict[str, Any] = {}

    def get(self, key: str, default: Any = None) -> Any:
        return self._d.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._d[key] = value

    def setdefault(self, key: str, factory: Any) -> Any:
        if key not in self._d:
            self._d[key] = factory()
        return self._d[key]


class RedisState:
    """JSON-serialisable values only. Used for cross-process snapshots; large objects stay in the database."""

    def __init__(self, url: str, prefix: str = "vayu:state:") -> None:
        import redis

        self.r = redis.from_url(url, decode_responses=True)
        self.prefix = prefix

    def get(self, key: str, default: Any = None) -> Any:
        v = self.r.get(self.prefix + key)
        return default if v is None else json.loads(v)

    def set(self, key: str, value: Any) -> None:
        self.r.set(self.prefix + key, json.dumps(value))
