# ADR-04: FastAPI for the API layer, Python throughout

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

All backend services are Python. FastAPI serves REST and WebSocket; Pydantic types the contract; OpenAPI is generated.

## Implementation

`services/api/`. Written for Python 3.12 but avoids 3.12-only syntax and is tested on 3.11, the interpreter available during development.
