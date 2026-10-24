# ADR-14: Traffic diversions are recommendations, not transmissions

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

The platform never sends anything to traffic authorities. An approved diversion becomes a signed PDF advisory that a policy officer downloads and sends through official channels.

## Implementation

`api/directives.py` (`export`), `api/advisory_pdf.py` (PDF + Ed25519 signature), `GET /v1/directives/{id}/export`. The old traffic sender is deleted; `tests/contract/test_directive_export.py` asserts no network client is imported by the export path. The signing method is a gate G2 decision.
