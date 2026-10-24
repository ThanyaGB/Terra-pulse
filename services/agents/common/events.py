"""Event envelope (spec section 8). Every event carries event_id, trace_id, schema_version, emitted_at."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

SCHEMA_VERSION = "1.0"

DATA_NORMALISED = "data.normalised"
RISK_UPDATED = "risk.updated"
FORECAST_UPDATED = "forecast.updated"
ATTRIBUTION_UPDATED = "attribution.updated"
BOOKING_CREATED = "booking.created"
ADVICE_UPDATED = "advice.updated"
ROUTE_COMPUTED = "route.computed"
WORKORDER_CREATED = "workorder.created"
WORKORDER_COMPLETED = "workorder.completed"
ROI_MEASURED = "roi.measured"
ALERT_FIRED = "alert.fired"

ALL_TYPES = (DATA_NORMALISED, RISK_UPDATED, FORECAST_UPDATED, ATTRIBUTION_UPDATED, BOOKING_CREATED,
             ADVICE_UPDATED, ROUTE_COMPUTED, WORKORDER_CREATED, WORKORDER_COMPLETED, ROI_MEASURED)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Event(BaseModel):
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    schema_version: str = SCHEMA_VERSION
    emitted_at: str = Field(default_factory=_now)
    type: str
    payload: dict[str, Any] = Field(default_factory=dict)

    def child(self, type_: str, payload: dict[str, Any]) -> "Event":
        """A downstream event that keeps this event's trace_id."""
        return Event(type=type_, trace_id=self.trace_id, payload=payload)
