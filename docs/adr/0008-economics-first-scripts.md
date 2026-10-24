# ADR-08: Economics-first farmer communication

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Farmer scripts state prices and earnings directly and avoid punitive wording.

## Implementation

`packages/domain/config/farmer_scripts_v1.yaml` holds the templates (rates are not in it: ADR-17) and a per-language blocked-word list; `render_script` refuses to emit a script containing one. Punjabi and Hindi copy is machine-drafted and needs native review.
