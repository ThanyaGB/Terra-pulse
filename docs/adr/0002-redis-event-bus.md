# ADR-02: Redis as the event bus and shared state store

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Redis Streams carry domain events; Redis also holds shared state snapshots and distributed locks. Durable event history is kept in PostgreSQL through an outbox table so Redis can be rebuilt.

## Implementation

`agents/common/bus.py` (`RedisStreamsBus`: one stream per event type, a consumer group per agent, XACK after success), `outbox.py` (SQLite in dev, `outbox` table in the Postgres migration), `state.py`, `idempotency.py`. Per-parcel rate limits use Redis counters (`integrations/ratelimit.py`).
