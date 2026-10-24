"""MCD notification seam (ADR-15). MCD supervisors use our own portal (/ops); there is NO MCD REST adapter and no MCD API
dependency. The platform owns the work-order workflow (api/workorders.py). This interface exists only so an optional SMS nudge
to a supervisor can be added behind a feature flag later; the default does nothing."""
from __future__ import annotations

from typing import Any, Protocol


class WorkOrderNotifier(Protocol):
    def notify_created(self, work_order: dict[str, Any]) -> None: ...


class NullNotifier:
    """Default: the supervisor sees the order in the portal. Nothing is sent anywhere."""

    def notify_created(self, work_order: dict[str, Any]) -> None:
        return None
