# ADR-15: MCD dispatch through our supervisor portal

**Status:** Accepted (from vayu-swachh-spec.md section 3)

## Decision

The platform owns the work-order workflow. Supervisors accept and complete orders in `/ops` with a photo and GPS. There is no MCD API dependency.

## Implementation

`api/workorders.py`, `api/routers/workorders.py`, `apps/web/src/routes/ops`. `integrations/mcd` is a no-op notifier seam only. Every transition writes a `work_order_event`.
