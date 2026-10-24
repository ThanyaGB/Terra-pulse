"""ADR-15 / ADR-12 / T3.6: the supervisor portal workflow replaces any MCD integration."""
import asyncio
import io
import math
import re

import pytest
from PIL import Image

from agents.common.events import ATTRIBUTION_UPDATED, WORKORDER_COMPLETED, Event
from api.images import CELL_M, GPS_IFD, coarse_grid, exif_keys

LAT, LON = 28.646912, 77.315233


def _jpeg_with_exif() -> bytes:
    im = Image.new("RGB", (64, 48), (120, 130, 140))
    ex = Image.Exif()
    ex[0x010F], ex[0x0110] = "SecretCamCo", "Model-X"
    ex[GPS_IFD] = {1: "N", 2: (28.0, 38.0, 48.88), 3: "E", 4: (77.0, 18.0, 54.84)}
    out = io.BytesIO()
    im.save(out, format="JPEG", exif=ex)
    return out.getvalue()


@pytest.fixture()
def wo(client):
    """A real work order made by the municipal agent from a severe reading."""
    p = client.platform
    for f in p.world.forecast.values():
        f["aqi"], f["pm25"] = 430, 280
    asyncio.run(p.bus.publish(Event(type=ATTRIBUTION_UPDATED, payload={"region": "delhi_ncr", "shares": {}})))
    asyncio.run(p.bus.drain())
    return next(iter(p.world.work_orders.values()))["id"]


def _complete(client, H, wid, sub="sup.a", rid="req-00000001", photo=True, gps=True, **extra):
    data = {"client_request_id": rid, **({"lat": str(LAT), "lon": str(LON)} if gps else {})}
    return client.post(f"/v1/work-orders/{wid}/complete", headers=H("municipal_supervisor", sub), data=data,
                       files={"photo": ("p.jpg", _jpeg_with_exif(), "image/jpeg")} if photo else {"photo": ("e.jpg", b"", "image/jpeg")}, **extra)


def test_role_matrix_for_work_order_endpoints(client, H, wo):
    for role in ("farmer", "citizen", "fpo_coordinator", "admin"):
        assert client.get("/v1/work-orders", headers=H(role)).status_code == 403
        assert client.post(f"/v1/work-orders/{wo}/accept", headers=H(role)).status_code == 403
    assert client.get("/v1/work-orders", headers=H("policy_officer")).status_code == 200
    assert client.post(f"/v1/work-orders/{wo}/accept", headers=H("policy_officer")).status_code == 403          # only a supervisor accepts
    assert client.get("/v1/work-orders").status_code == 401


def test_list_filters_and_sorts_by_due_time(client, H, wo):
    rows = client.get("/v1/work-orders", headers=H("municipal_supervisor")).json()["items"]
    assert rows and [r["due_by"] for r in rows] == sorted(r["due_by"] for r in rows) and all(r["status"] == "created" for r in rows)
    assert client.get("/v1/work-orders?status=completed", headers=H("municipal_supervisor")).json()["items"] == []
    area = rows[0]["area_id"]
    assert all(r["area_id"] == area for r in client.get(f"/v1/work-orders?area={area}", headers=H("municipal_supervisor")).json()["items"])
    assert client.get("/v1/work-orders?status=nope", headers=H("municipal_supervisor")).status_code == 400


def test_work_order_completion_is_refused_before_acceptance(client, H, wo):
    r = _complete(client, H, wo)
    assert r.status_code == 409 and "accepted" in r.json()["detail"]
    assert client.platform.world.work_orders[wo]["status"] == "created"
    assert not any(e["to_status"] == "completed" for e in client.platform.world.work_order_events)


def test_full_flow_writes_a_work_order_event_for_every_transition(client, H, wo):
    a = client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.a"))
    assert a.status_code == 200 and a.json()["status"] == "accepted" and a.json()["accepted_by"] == "sup.a"
    c = _complete(client, H, wo)
    assert c.status_code == 200 and c.json()["status"] == "completed" and c.json()["duplicate"] is False
    ev = [(e["from_status"], e["to_status"]) for e in client.platform.world.work_order_events if e["work_order_id"] == wo]
    assert ev == [(None, "created"), ("created", "accepted"), ("accepted", "completed")]
    acts = [e.action for e in client.platform.audit.entries()]
    assert "work_order.accepted" in acts and "work_order.completed" in acts and client.platform.audit.verify()
    assert client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.b")).status_code == 409   # a completed order cannot be re-accepted


def test_illegal_transitions_and_other_supervisor(client, H, wo):
    assert client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.a")).status_code == 200
    assert client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.a")).status_code == 200      # same supervisor: no-op
    assert client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.b")).status_code == 409
    assert _complete(client, H, wo, sub="sup.b").status_code == 409
    assert client.post("/v1/work-orders/WO-NOPE/accept", headers=H("municipal_supervisor")).status_code == 404
    events = [e for e in client.platform.world.work_order_events if e["work_order_id"] == wo]
    assert [e["to_status"] for e in events] == ["created", "accepted"]


def test_completion_needs_photo_and_gps(client, H, wo):
    client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.a"))
    assert _complete(client, H, wo, gps=False).status_code == 422
    assert _complete(client, H, wo, photo=False).status_code in (422,)
    bad = client.post(f"/v1/work-orders/{wo}/complete", headers=H("municipal_supervisor", "sup.a"), data={"lat": "95", "lon": "10", "client_request_id": "req-00000002"},
                      files={"photo": ("p.jpg", _jpeg_with_exif(), "image/jpeg")})
    assert bad.status_code == 422
    junk = client.post(f"/v1/work-orders/{wo}/complete", headers=H("municipal_supervisor", "sup.a"), data={"lat": "28.6", "lon": "77.3", "client_request_id": "req-00000003"},
                       files={"photo": ("p.jpg", b"not an image", "image/jpeg")})
    assert junk.status_code == 422 and client.platform.world.work_orders[wo]["status"] == "accepted"


def test_completion_photo_has_no_exif_but_a_100_m_gps_cell(client, H, wo):
    from conftest import SETTINGS
    client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.a"))
    r = _complete(client, H, wo)
    saved = open(f"{SETTINGS.photo_dir}/{wo}.jpg", "rb").read()
    assert exif_keys(saved) == {GPS_IFD} and b"SecretCamCo" not in saved
    gps = Image.open(io.BytesIO(saved)).getexif().get_ifd(GPS_IFD)
    glat = sum(float(v) / 60 ** i for i, v in enumerate(gps[2])) * (1 if gps[1] == "N" else -1)
    glon = sum(float(v) / 60 ** i for i, v in enumerate(gps[4])) * (1 if gps[3] == "E" else -1)
    metres = math.hypot((glat - LAT) * 111_320, (glon - LON) * 111_320 * math.cos(math.radians(LAT)))
    assert 0 < metres <= CELL_M * math.sqrt(2) / 2 + 3                       # inside the same 100 m cell (stored coordinates are rounded to seconds)
    clat, clon, ref = coarse_grid(LAT, LON)
    assert r.json()["completion_grid_ref"] == ref and abs(clat - LAT) * 111_320 <= 51 and abs(clon - LON) * 111_320 <= 56
    blob = repr(client.platform.world.work_orders[wo]) + repr(client.platform.world.work_order_events) + repr([e.payload for e in client.platform.audit.entries()]) + r.text
    assert not re.search(r"28\.6469|77\.3152", blob)                         # the exact point is never stored, logged or returned


def test_duplicate_sync_does_not_create_a_second_completion_event(client, H, wo):
    seen = []
    client.platform.bus.subscribe("probe", [WORKORDER_COMPLETED], lambda ev: _record(seen, ev))
    client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.a"))
    first = _complete(client, H, wo, rid="req-aaaaaaaa")
    asyncio.run(client.platform.bus.drain())
    again = _complete(client, H, wo, rid="req-aaaaaaaa")
    asyncio.run(client.platform.bus.drain())
    assert first.status_code == 200 and again.status_code == 200 and again.json()["duplicate"] is True and again.headers["X-Duplicate-Submission"] == "true"
    assert again.json()["completed_at"] == first.json()["completed_at"]
    assert len(seen) == 1
    assert sum(1 for e in client.platform.world.work_order_events if e["to_status"] == "completed") == 1
    other = _complete(client, H, wo, rid="req-bbbbbbbb")
    assert other.status_code == 409 and len(seen) == 1
    assert client.platform.world.work_orders[wo]["roi_window"]["earliest"] < client.platform.world.work_orders[wo]["roi_window"]["latest"]


async def _record(seen, ev):
    seen.append(ev)


def test_roi_result_is_shown_once_measured(client, H, wo):
    client.post(f"/v1/work-orders/{wo}/accept", headers=H("municipal_supervisor", "sup.a"))
    _complete(client, H, wo)
    assert client.get("/v1/work-orders?status=completed", headers=H("municipal_supervisor")).json()["items"][0]["roi"] is None
    treated = [300.0] * 6 + [300.0 - 2 * h for h in range(30)]
    control = [300.0] * 6 + [300.0 - 0.5 * h for h in range(30)]
    client.platform.world.work_orders[wo]["control_area"] = "ito"
    asyncio.run(client.platform.municipal.measure_roi(wo, treated, control, 6, 8))
    roi = client.get("/v1/work-orders?status=completed", headers=H("policy_officer")).json()["items"][0]["roi"]
    assert roi["delta_pm25"] > 0 and roi["control_area"] == "ito"


def test_no_mcd_rest_adapter_is_left():
    import pathlib
    src = "".join(p.read_text(encoding="utf8") for p in pathlib.Path("services").rglob("*.py"))
    assert "McdIntegration" not in src and "webhook(work_order_id" not in src


def test_photo_cell_is_100_m_for_citizen_reports_too():
    clat, clon, _ = coarse_grid(LAT, LON)
    assert abs(clat - LAT) * 111_320 <= 50.5 and abs(clon - LON) * 111_320 * math.cos(math.radians(LAT)) <= 50.5
