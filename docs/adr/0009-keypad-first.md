# ADR-09: Keypad-first farmer interaction

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Farmers act by pressing 1, 2 or 9; no app or text input.

## Implementation

`POST /v1/calls/keypress` (simulator) and the signed telephony webhook share `Ops.handle_key`: 1 books and confirms a machine, 2 requests straw collection at the floor price, 9 requests an agronomist callback.
