# ADR-19: Externally facing features behind flags

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Anything that sends content to the public or an external party sits behind a flag that defaults to OFF. Enabling an externally facing flag needs two different admins.

## Implementation

`config/features.yaml`, `domain/features.py`, `PUT /v1/admin/features/{name}`. Defaults are checked against the spec table by `tests/unit/test_features.py`.
