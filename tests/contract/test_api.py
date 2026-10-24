"""Contract tests (T3.x / T6.1): schemas, role restrictions (403), masking, rate limit, directives, photos, WebSocket."""
import io
import json
import re

import pytest
from conftest import SETTINGS
from PIL import Image

from api.images import GPS_IFD, exif_keys
from api.security import issue_token

ROLES = ["policy_officer", "fpo_coordinator", "farmer", "citizen", "admin"]
PHONE = re.compile(r"(?<!\d)[6-9]\d{4}[- ]?\d{5}(?!\d)")

# (method, path, allowed roles) - every endpoint's declared role set is exercised
ENDPOINTS = [
    ("GET", "/v1/aqi/grid?bbox=77.2,28.58,77.4,28.70", {"citizen", "policy_officer"}),
    ("GET", "/v1/aqi/community/anand-vihar", {"citizen"}),
    ("GET", "/v1/plume/projection?origin=sangrur&hours=72", {"policy_officer"}),
    ("GET", "/v1/attribution/summary?region=delhi_ncr", {"policy_officer"}),
    ("GET", "/v1/risk/parcels", {"fpo_coordinator"}),
    ("GET", "/v1/machinery/status", {"fpo_coordinator"}),
    ("GET", "/v1/health/advice?profile=asthma&community_id=anand-vihar", {"citizen"}),
    ("GET", "/v1/routes/clean?from=ito&to=anand-vihar", {"citizen"}),
    ("GET", "/v1/roi/summary", {"policy_officer", "admin"}),
    ("GET", "/v1/pipeline/health", {"policy_officer", "admin"}),
]


@pytest.mark.parametrize("method,path,allowed", ENDPOINTS)
def test_role_matrix(client, H, method, path, allowed):
    assert client.request(method, path).status_code == 401
    for role in ROLES:
        r = client.request(method, path, headers=H(role))
        assert (r.status_code == 200) == (role in allowed), (role, path, r.status_code, r.text[:200])
        if role not in allowed:
            assert r.status_code == 403 and r.headers["content-type"].startswith("application/problem+json")


def test_problem_details_shape(client, H):
    r = client.get("/v1/aqi/community/nowhere", headers=H("citizen"))
    b = r.json()
    assert r.status_code == 404 and {"type", "title", "status", "detail", "instance", "trace_id"} <= set(b) and r.headers["x-trace-id"]
    assert client.get("/v1/aqi/grid?bbox=bad", headers=H("citizen")).status_code == 400


def test_expired_and_forged_tokens_rejected(client):
    old = issue_token(SETTINGS.jwt_secret, "x", "citizen", ttl_s=10, now=0)
    assert client.get("/v1/aqi/community/ito", headers={"Authorization": f"Bearer {old}"}).status_code == 401
    forged = issue_token("other-secret", "x", "citizen")
    assert client.get("/v1/aqi/community/ito", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_read_schemas(client, H):
    c = client.get("/v1/aqi/community/anand-vihar", headers=H("citizen")).json()
    assert {"community_id", "pm25", "aqi", "source_mix", "grap_tier", "alerts", "forecast_24h"} <= set(c)
    assert abs(sum(c["source_mix"].values()) - 100) <= 0.5
    g = client.get("/v1/aqi/grid?bbox=77.2,28.58,77.4,28.70&limit=10", headers=H("citizen")).json()
    assert len(g["items"]) == 10 and g["next_cursor"] and g["grid_resolution_km"] == 1.0
    g2 = client.get(f"/v1/aqi/grid?bbox=77.2,28.58,77.4,28.70&limit=10&cursor={g['next_cursor']}", headers=H("citizen")).json()
    assert g2["items"][0] != g["items"][0]
    p = client.get("/v1/plume/projection", headers=H("policy_officer")).json()
    assert p["horizonHours"] == 72 and p["streets"] and "corridor" in p
    a = client.get("/v1/attribution/summary?region=delhi_ncr", headers=H("policy_officer")).json()
    assert abs(sum(a["shares"].values()) - 100) <= 0.5
    r = client.get("/v1/routes/clean?from=ito&to=anand-vihar", headers=H("citizen")).json()
    assert len(r["options"]) == 2 and r["extra_minutes"] <= 3
    assert client.get("/v1/health/advice?profile=nope&community_id=ito", headers=H("citizen")).status_code == 400


def test_advice_changes_by_profile_and_time(client, H):
    def ids(profile, t):
        return [i["id"] for i in client.get(f"/v1/health/advice?profile={profile}&community_id=anand-vihar&time={t}", headers=H("citizen")).json()["items"]]
    assert ids("asthma", 7) != ids("outdoor", 7)
    assert ids("asthma", 7) != ids("asthma", 14)


def test_no_unmasked_farmer_phone_anywhere(client, H, calls_on):
    raw = {p.phone for p in client.platform.world.parcels.values()}
    body = client.get("/v1/risk/parcels?limit=200", headers=H("fpo_coordinator")).text
    assert PHONE.search(body) is None or all(m.group(0).endswith("XXXXX") is False for m in []) or not any(ph in body for ph in raw)
    assert "98" in body and "-XXXXX" in body
    assert not any(ph in body for ph in raw)
    call = client.post("/v1/calls/trigger", json={"parcel_id": next(iter(raw and client.platform.world.parcels))}, headers=H("fpo_coordinator")).json()
    log = client.get(f"/v1/calls/{call['call_id']}/log", headers=H("fpo_coordinator")).text
    assert not any(ph in log for ph in raw)
    machines = client.get("/v1/machinery/status", headers=H("fpo_coordinator")).text
    ops_phones = {m.operator_phone for m in client.platform.world.crm.machines.values()}
    assert not any(ph in machines for ph in ops_phones)   # operator numbers stay masked until a booking is live


def test_booking_flow_and_operator_phone_exception(client, H):
    pid = next(iter(client.platform.world.parcels))
    r = client.post("/v1/bookings", json={"parcel_id": pid}, headers=H("farmer"))
    assert r.status_code == 201
    b = r.json()
    assert b["status"] == "pending_confirmation" and b["machinery"]["operator_phone"].endswith("-XXXXX")
    c = client.post(f"/v1/bookings/{b['booking_id']}/confirm", headers=H("farmer"))
    assert c.status_code == 200 and c.json()["status"] == "confirmed"
    op = client.platform.world.crm.machines[b["machinery"]["id"]].operator_phone
    assert c.json()["machinery"]["operator_phone"] == op            # the single permitted unmasked case
    assert client.post(f"/v1/bookings/{b['booking_id']}/confirm", headers=H("fpo_coordinator")).status_code == 403
    assert client.post("/v1/bookings", json={"parcel_id": pid}, headers=H("citizen")).status_code == 403


def test_keypad_one_confirms_booking_and_two_requests_collection(client, H, contract_active):
    pid = list(client.platform.world.parcels)[3]
    r = client.post("/v1/calls/keypress", json={"parcel_id": pid, "key": "1"}, headers=H("farmer")).json()
    assert r["status"] == "confirmed" and r["booking"]["status"] == "confirmed"
    r2 = client.post("/v1/calls/keypress", json={"parcel_id": pid, "key": "2"}, headers=H("farmer")).json()
    assert r2["collection"]["floor_price_inr_per_tonne"] == 1650
    assert client.post("/v1/calls/keypress", json={"parcel_id": pid, "key": "9"}, headers=H("farmer")).json()["status"] == "callback_unscheduled"   # nobody rostered, no slots: no time promised
    assert client.post("/v1/calls/keypress", json={"parcel_id": pid, "key": "5"}, headers=H("farmer")).status_code == 422


def test_call_rate_limit_per_parcel(client, H, calls_on):
    pid = list(client.platform.world.parcels)[1]
    codes = [client.post("/v1/calls/trigger", json={"parcel_id": pid}, headers=H("fpo_coordinator")).status_code for _ in range(3)]
    assert codes == [202, 202, 429]
    r = client.post("/v1/calls/trigger", json={"parcel_id": pid}, headers=H("fpo_coordinator"))
    assert "Retry-After" in r.headers and "limit" in r.json()["detail"].lower()


def test_signed_webhook_dtmf_confirms_booking(client, H, calls_on):
    pid = list(client.platform.world.parcels)[2]
    call = client.post("/v1/calls/trigger", json={"parcel_id": pid}, headers=H("fpo_coordinator")).json()
    tel = client.app.state.telephony
    prov = tel.providers[call["provider"]]
    url = "http://testserver/v1/calls/webhook/" + call["provider"]
    params = {"CallSid": call["call_id"], "CallStatus": "in-progress", "Digits": "1"}
    bad = client.post("/v1/calls/webhook/" + call["provider"], data=params, headers={"x-signature": "nope"})
    assert bad.status_code == 401
    ok = client.post("/v1/calls/webhook/" + call["provider"], data=params, headers={"x-signature": prov.sign(url, params)})
    assert ok.status_code == 200 and ok.json()["intent"] == "book_machine" and ok.json()["result"]["booking"]["status"] == "confirmed"


def test_directives_two_person_rule_and_audit_chain(client, H):
    c = client.post("/v1/directives", json={"type": "diversion_trucks", "area_ids": ["kmp"]}, headers=H("policy_officer", "officer.a"))
    d = c.json()
    assert c.status_code == 201 and d["status"] == "pending_approval"
    self_ok = client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.a"))
    assert self_ok.status_code == 409
    second = client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.b"))
    assert second.status_code == 200 and second.json()["status"] == "dispatched"
    f = client.post("/v1/directives", json={"type": "fog_cannons"}, headers=H("policy_officer")).json()
    assert f["status"] == "dispatched"
    assert client.post("/v1/directives", json={"type": "fog_cannons"}, headers=H("citizen")).status_code == 403
    audit = client.get("/v1/audit/verify", headers=H("admin")).json()
    assert audit["valid"] and audit["entries"] >= 6
    log = client.platform.audit.entries()
    created = next(i for i, e in enumerate(log) if e.action == "directive.created" and e.payload["id"] == d["id"])
    dispatched = next(i for i, e in enumerate(log) if e.action == "directive.dispatching" and e.payload["id"] == d["id"])
    assert created < dispatched                                       # audited before dispatch


def test_audit_chain_detects_tampering(client):
    a = client.platform.audit
    a.append("x", "one"), a.append("x", "two")
    assert a.verify()
    object.__setattr__(a._entries[0], "actor", "mallory")
    assert not a.verify()


def _jpeg_with_exif() -> bytes:
    im = Image.new("RGB", (64, 48), (120, 80, 40))
    ex = Image.Exif()
    ex[0x010F] = "SecretCamCo"       # Make
    ex[0x0110] = "Model-9"
    ex[0x0132] = "2026:10:23 09:00:00"
    ex[GPS_IFD] = {1: "N", 2: (28.0, 38.0, 45.6), 3: "E", 4: (77.0, 18.0, 54.72)}
    out = io.BytesIO()
    im.save(out, "JPEG", exif=ex)
    return out.getvalue()


def test_photo_report_strips_exif_except_coarse_gps(client, H):
    src = _jpeg_with_exif()
    assert {0x010F, 0x0110, GPS_IFD} <= exif_keys(src)
    r = client.post("/v1/reports/photo", headers=H("citizen"), data={"category": "open_burning", "lat": "28.6469", "lon": "77.3152"},
                    files={"photo": ("p.jpg", src, "image/jpeg")})
    assert r.status_code == 201
    ref = r.json()["reference_id"]
    saved = open(f"{SETTINGS.photo_dir}/{ref}.jpg", "rb").read()
    assert exif_keys(saved) == {GPS_IFD}                                # only the GPS point survives
    assert b"SecretCamCo" not in saved
    assert r.json()["grid_ref"].startswith("G+28.65")                   # coarse ~1 km grid reference
    got = client.get(f"/v1/reports/{ref}", headers=H("citizen")).json()
    assert got["reference_id"] == ref and "lat" not in got
    assert client.post("/v1/reports/photo", headers=H("citizen"), data={"category": "road_dust"}, files={"photo": ("x.jpg", b"not an image", "image/jpeg")}).status_code == 422


def test_websocket_auth_and_channel_authorisation(client, H):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/live?token=bad"):
            pass
    tok = H("citizen")["Authorization"][7:]
    with client.websocket_connect(f"/ws/live?token={tok}") as ws:
        ws.send_text(json.dumps({"action": "subscribe", "channels": ["aqi.update", "agent.status"]}))
        ack = ws.receive_json()
        assert ack["payload"]["subscribed"] == ["aqi.update"] and ack["payload"]["denied"] == ["agent.status"]


def test_websocket_alert_delivery_under_one_second(client, H):
    import time
    tok = H("policy_officer")["Authorization"][7:]
    with client.websocket_connect(f"/ws/live?token={tok}") as ws:
        ws.send_text(json.dumps({"action": "subscribe", "channels": ["alert.fired"]}))
        ws.receive_json()
        t0 = time.perf_counter()
        client.app.state.hub.publish("alert.fired", {"kind": "test"}, "trace-1")
        msg = ws.receive_json()
        assert time.perf_counter() - t0 < 1.0
        assert set(msg) == {"channel", "ts", "trace_id", "payload"} and msg["channel"] == "alert.fired" and msg["trace_id"] == "trace-1"


def test_dev_token_disabled_outside_dev(snap):
    from fastapi.testclient import TestClient

    from api.app import create_app
    from api.settings import Settings
    s = Settings(env="staging", jwt_secret="x" * 32, data_mode="offline", outbox_path=":memory:")
    with TestClient(create_app(s, background=False)) as c:
        assert c.post("/v1/auth/dev-token", json={"role": "citizen"}).status_code == 404


def test_settings_fail_fast_without_secret():
    from api.settings import Settings
    with pytest.raises(Exception, match="VAYU_JWT_SECRET"):
        Settings(env="production", jwt_secret="")
