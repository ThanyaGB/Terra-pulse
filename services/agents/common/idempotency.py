"""Idempotency store keyed on event_id (ADR-01 consequence)."""
from __future__ import annotations

from typing import Protocol


class IdempotencyStore(Protocol):
    def seen(self, key: str) -> bool: ...
    def mark(self, key: str) -> None: ...


class MemoryIdempotency:
    def __init__(self) -> None:
        self._keys: set[str] = set()

    def seen(self, key: str) -> bool:
        return key in self._keys

    def mark(self, key: str) -> None:
        self._keys.add(key)


class RedisIdempotency:
    def __init__(self, url: str, ttl_s: int = 7 * 86400, prefix: str = "vayu:idem:") -> None:
        import redis

        self.r = redis.from_url(url, decode_responses=True)
        self.ttl, self.prefix = ttl_s, prefix

    def seen(self, key: str) -> bool:
        return bool(self.r.exists(self.prefix + key))

    def mark(self, key: str) -> None:
        self.r.set(self.prefix + key, "1", ex=self.ttl)
