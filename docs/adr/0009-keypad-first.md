# ADR-09: Keypad-first farmer interaction

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Farmers act on the keypad only: 1 (machine), 2 (straw pickup) or 9 (talk to an FPO worker). After 1 they pick the machine: 1 Super Seeder or 2 Happy Seeder (0 goes back). Then 1 confirms or 0 goes back to the menu. * at any step repeats the prompt (the whole call message at the menu). Nothing is booked or requested before the confirming 1. No app, no WhatsApp, no text input.

## Implementation

`POST /v1/calls/keypress` (simulator) and the signed telephony webhook share `Ops.handle_key`, which keeps the keypad step per parcel and reads back static prompts (`machine_menu`, `confirm` and `back_to_menu` in `farmer_scripts_v1.yaml`). On the confirming 1: the chosen machine type is booked and confirmed, straw collection is requested at the floor price, or the farmer joins the FPO worker queue.
