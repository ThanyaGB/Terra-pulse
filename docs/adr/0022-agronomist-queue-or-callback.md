# ADR-22: Keypad 9 routes to a staffed agronomist queue

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Pressing 9 queues the farmer for a human agronomist in pilot hours, otherwise offers a callback slot. If neither is configured the request is recorded and no response time is promised.

## Implementation

`api/agronomist.py`, `config/agronomist.yaml`, `Ops.handle_key`. Gate G4.
