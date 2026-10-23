# ADR-11: Mock-first front end

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

The front end is built against typed mock fixtures that match the contract; one environment variable switches to the live API.

## Implementation

`apps/web/src/mocks` and `VITE_API_MODE=mock|live`. The UI-facing `VayuApi` interface is kept stable; `src/api/live.ts` adapts the spec endpoints onto it (covered by `tests/unit/live-adapter.test.ts`).
