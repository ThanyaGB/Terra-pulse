"""Per-parcel rate limits for outbound calls (T4.7). Redis-backed in deployment
(fixed window via INCR + EXPIRE); in-memory sliding window otherwise. Configurable: default 2 per 24 h."""
from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Callable


class RateLimitExceeded(Exception):
    def __init__(self, key: str, limit: int, window_s: int, retry_after_s: int) -> None:
        super().__init__(f"{key}: limit of {limit} per {window_s // 3600} h reached; retry in {retry_after_s // 60} min")
        self.retry_after_s = retry_after_s


class MemoryLimiter:
    def __init__(self, limit: int = 2, window_s: int = 24 * 3600, clock: Callable[[], float] = time.time) -> None:
        self.limit, self.window_s, self.clock = limit, window_s, clock
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def hit(self, key: str) -> None:
        now = self.clock()
        q = self._hits[key]
        while q and now - q[0] >= self.window_s:
            q.popleft()
        if len(q) >= self.limit:
            raise RateLimitExceeded(key, self.limit, self.window_s, int(self.window_s - (now - q[0])))
        q.append(now)

    def allow(self, key: str) -> bool:
        try:
            self.hit(key)
            return True
        except RateLimitExceeded:
            return False


class RedisLimiter:
    def __init__(self, url: str, limit: int = 2, window_s: int = 24 * 3600, prefix: str = "vayu:rl:") -> None:
        import redis

        self.r = redis.from_url(url)
        self.limit, self.window_s, self.prefix = limit, window_s, prefix

    def hit(self, key: str) -> None:
        k = self.prefix + key
        n = self.r.incr(k)
        if n == 1:
            self.r.expire(k, self.window_s)
        if n > self.limit:
            raise RateLimitExceeded(key, self.limit, self.window_s, int(self.r.ttl(k)))

    def allow(self, key: str) -> bool:
        try:
            self.hit(key)
            return True
        except RateLimitExceeded:
            return False
