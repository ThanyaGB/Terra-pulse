# ADR-22: Keypad 9 routes to an FPO worker

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Pressing 9 (and confirming with 1) queues the farmer for an FPO worker in pilot hours, otherwise offers a callback slot. If neither is configured the request is recorded and no response time is promised.

## Implementation

`api/fpo_desk.py`, `config/fpo_desk.yaml`, `Ops.handle_key`. Gate G4.
