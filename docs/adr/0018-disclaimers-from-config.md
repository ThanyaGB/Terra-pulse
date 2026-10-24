# ADR-18: Required disclaimers, served from config

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

Citizen advice is exposure guidance, not medical advice; directives are recommendations to authorities. The wording is config so legal can change it without a release.

## Implementation

`config/disclaimers.yaml`, `domain/disclaimers.py`, `GET /v1/config/public`, `apps/web/src/routes/citizen/Disclaimer.tsx`, and the signed advisory PDF.
