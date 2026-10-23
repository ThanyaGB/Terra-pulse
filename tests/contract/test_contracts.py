"""T1.2 / T3.1 / T6.1: spec endpoints exist, committed OpenAPI is current, emitted events validate against their schemas."""
import json
import subprocess
import sys
from pathlib import Path

import jsonschema
import pytest

from agents.runtime import build_platform
from agents.world import World
from api.routers import ops, read
from contracts.events import PAYLOADS, event_schema

ROOT = Path(__file__).resolve().parents[2]
SPEC_ENDPOINTS = [  # spec section 7.1
    ("get", "/v1/aqi/grid"), ("get", "/v1/aqi/community/{community_id}"), ("get", "/v1/plume/projection"), ("get", "/v1/attribution/summary"),
    ("get", "/v1/risk/parcels"), ("post", "/v1/calls/trigger"), ("get", "/v1/calls/{call_id}/log"), ("post", "/v1/bookings"),
    ("post", "/v1/bookings/{booking_id}/confirm"), ("post", "/v1/collections/request"), ("get", "/v1/machinery/status"),
    ("get", "/v1/health/advice"), ("get", "/v1/routes/clean"), ("post", "/v1/reports/photo"), ("post", "/v1/directives"),
    ("post", "/v1/directives/{directive_id}/approve"), ("get", "/v1/roi/summary"), ("get", "/v1/pipeline/health"),
]


def test_every_spec_endpoint_is_in_the_committed_openapi():
    spec = json.loads((ROOT / "packages/contracts/openapi.json").read_text(encoding="utf8"))
    assert spec["openapi"].startswith("3.1")
    for method, path in SPEC_ENDPOINTS:
        assert method in spec["paths"].get(path, {}), f"{method.upper()} {path} missing from the contract"


def test_contract_has_no_drift():
    r = subprocess.run([sys.executable, "scripts/export_contracts.py", "--check"], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr


def test_every_endpoint_declares_a_role_set():
    """RBAC is declared on each route through require_roles (dev-token, webhooks and healthz are the only public ones)."""
    public = {"/v1/auth/dev-token", "/v1/calls/webhook/{provider}", "/v1/realtime/snapshot"}
    from api.app import create_app
    from api.settings import Settings
    app = create_app(Settings(env="dev", jwt_secret="x" * 20, outbox_path=":memory:"), background=False)
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/v1") or path in public:
            continue
        deps = [d.call for d in route.dependant.dependencies]  # type: ignore[attr-defined]
        assert any(hasattr(d, "__roles__") for d in deps), f"{path} has no declared role set"
    _ = (ops, read)


@pytest.mark.parametrize("name", list(PAYLOADS))
def test_event_schemas_are_valid_json_schema(name):
    jsonschema.Draft202012Validator.check_schema(event_schema(name))


async def test_emitted_events_validate_against_schemas():
    from datetime import date

    from ingestion.pipeline import build_snapshot
    snap = build_snapshot(offline=True)
    p = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))
    await p.run_cycle("W1")
    for f in p.world.forecast.values():
        f["aqi"], f["pm25"] = 430, 280
    from agents.common import Event
    from agents.common.events import ATTRIBUTION_UPDATED, RISK_UPDATED
    for pid in list(p.world.parcels)[:3]:
        await p.bus.publish(Event(type=RISK_UPDATED, payload={"parcel_id": pid, "score": 80.0, "tier": "critical", "village_id": p.world.parcels[pid].village_id}))
    await p.bus.publish(Event(type=ATTRIBUTION_UPDATED, payload={"region": "delhi_ncr", "shares": p.world.attribution["ncr"]["shares"]}))
    await p.bus.drain()
    seen = set()
    for ev in p.bus.published:
        if ev.type in PAYLOADS:
            jsonschema.validate(ev.model_dump(), event_schema(ev.type), format_checker=jsonschema.FormatChecker())
            seen.add(ev.type)
    assert {"data.normalised", "risk.updated", "forecast.updated", "attribution.updated", "booking.created", "advice.updated",
            "route.computed", "workorder.created"} <= seen
