# ADR-05: Typed contract-first API

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

The OpenAPI document is the contract and the TypeScript client is generated from it, so front end and backend can be built against mocks and protected by contract tests.

## Implementation

`scripts/export_contracts.py` writes `packages/contracts/openapi.json` (3.1) and the event JSON Schemas; `--check` fails CI on drift. `npm run gen:api` generates `apps/web/src/api-client/schema.d.ts`, which types the HTTP client path set. Most response bodies are still plain dicts in the schema; promoting them to Pydantic response models is the way to make response types generated too.
