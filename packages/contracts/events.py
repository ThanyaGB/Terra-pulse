"""Event JSON Schemas (spec section 8). Generated into packages/contracts/events/*.json by scripts/export_contracts.py.
Every event carries event_id (UUID), trace_id, schema_version and emitted_at; consumers are idempotent on event_id."""
from __future__ import annotations

from typing import Any

SHARES = {"type": "object", "required": ["straw_plume", "vehicle", "dust", "industrial_waste"],
          "properties": {k: {"type": "number", "minimum": 0, "maximum": 100} for k in ("straw_plume", "vehicle", "dust", "industrial_waste")}}
STR = {"type": "string"}
NUM = {"type": "number"}

PAYLOADS: dict[str, dict[str, Any]] = {
    "data.normalised": {"required": ["source", "grid_id", "window", "quality_flags"],
                        "properties": {"source": STR, "grid_id": STR, "window": STR, "quality_flags": {"type": "object"}}},
    "risk.updated": {"required": ["parcel_id", "score", "tier"],
                     "properties": {"parcel_id": STR, "score": {"type": "number", "minimum": 0, "maximum": 100},
                                    "tier": {"enum": ["low", "medium", "high", "critical"]}, "village_id": STR}},
    "forecast.updated": {"required": ["grid_id", "horizon_h", "pm25_series"],
                         "properties": {"grid_id": STR, "horizon_h": {"type": "integer", "minimum": 1, "maximum": 72},
                                        "pm25_series": {"type": "array", "items": NUM}, "aqi": NUM, "method": STR,
                                        "fallback_flag": {"type": "boolean"}, "cpcb_corrected": {"type": ["string", "null"]}}},
    "attribution.updated": {"required": ["region", "shares"],
                            "properties": {"region": STR, "shares": SHARES, "area_shares": {"type": "object", "additionalProperties": SHARES}}},
    "booking.created": {"required": ["booking_id", "parcel_id", "machinery_id"],
                        "properties": {"booking_id": STR, "parcel_id": STR, "machinery_id": STR}},
    "advice.updated": {"required": ["community_id", "profile", "advice"],
                       "properties": {"community_id": STR, "profile": {"enum": ["asthma", "child", "elderly", "outdoor", "general"]},
                                      "advice": {"type": "array", "items": {"type": "object", "required": ["id", "title", "level"]}}}},
    "route.computed": {"required": ["from", "to", "options"],
                       "properties": {"from": STR, "to": STR, "options": {"type": "array", "minItems": 1}}},
    "workorder.created": {"required": ["work_order_id", "action_type", "location"],
                          "properties": {"work_order_id": STR, "action_type": STR, "location": STR}},
    "workorder.completed": {"required": ["work_order_id", "completed_at", "gps_cell"],
                            "properties": {"work_order_id": STR, "completed_at": STR, "gps_cell": STR}},
    "roi.measured": {"required": ["work_order_id", "delta_pm25"], "properties": {"work_order_id": STR, "delta_pm25": NUM}},
}


def event_schema(name: str) -> dict[str, Any]:
    p = PAYLOADS[name]
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": f"https://vayu-swachh.example/events/{name}.json",
        "title": name, "type": "object",
        "required": ["event_id", "trace_id", "schema_version", "emitted_at", "type", "payload"],
        "properties": {
            "event_id": {"type": "string", "format": "uuid"}, "trace_id": STR, "schema_version": {"const": "1.0"},
            "emitted_at": {"type": "string", "format": "date-time"}, "type": {"const": name},
            "payload": {"type": "object", "required": p["required"], "properties": p["properties"]},
        },
    }
