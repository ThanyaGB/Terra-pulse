# ADR-01: Multi-agent architecture on the IBM Bob framework

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Six specialised agents run as workers and communicate only through an event bus, never by direct calls. Each has an independent failure domain; every agent must be idempotent and tolerate duplicate or out-of-order events.

## Implementation

Implemented in `services/agents/` on a small in-repo base class (`common/agent.py`): subscription by event type, idempotency on `event_id`, ack-after-success redelivery, health report. **Deviation:** the IBM Bob SDK (`ibm-bob`) is not a public package, so `BaseAgent` provides the same pub/sub, state-snapshot and health contract; swap it behind `BaseAgent` when the SDK is available. The six agents currently share one process and an in-memory `World`; Redis-backed `RedisStreamsBus`/`RedisState` exist for the split into separate deployments.
