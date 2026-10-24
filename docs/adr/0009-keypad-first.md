# ADR-09: Keypad-first farmer interaction

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Farmers act on the keypad only, in two steps: 1 (machine), 2 (straw pickup) or 9 (talk to an FPO worker), then 1 to confirm or 0 to go back. Nothing is booked or requested before the confirming 1. No app, no WhatsApp, no text input.

## Implementation

`POST /v1/calls/keypress` (simulator) and the signed telephony webhook share `Ops.handle_key`, which keeps the pending choice per parcel and reads back a static confirm prompt (`confirm` and `back_to_menu` in `farmer_scripts_v1.yaml`). On the confirming 1: a machine is booked and confirmed, straw collection is requested at the floor price, or the farmer joins the FPO worker queue.
