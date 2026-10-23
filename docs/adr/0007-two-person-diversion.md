# ADR-07: Two-person approval for diversion orders

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

A directive that diverts traffic needs a second `policy_officer` approver, and every directive is written to an immutable audit log before dispatch.

## Implementation

`api/directives.py` + `api/audit.py` (hash-chained). The same rule is a `CHECK` constraint in the `directive` table, and the audit table has an append-only trigger.
