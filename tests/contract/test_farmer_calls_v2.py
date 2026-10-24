"""T2.5 / T4.1 / T4.2 / ADR-13, 17, 22 through the API: calls are gated by flag and hours, the buy-back line needs an active
contract, keypad 9 (then 1 to confirm) routes to an FPO worker queue or a callback slot."""
from datetime import datetime, timezone

from conftest import ACTIVE_CONTRACT, SETTINGS

from api.settings import Settings

BUYBACK = {"en": "buy your straw", "hi": "खरीदते", "pa": "ਖਰੀਦਦੇ"}


def _pid(client, i=0):
    return list(client.platform.world.parcels)[i]


def test_exotel_is_the_default_primary_and_twilio_the_standby(client):
    assert Settings().telephony_primary == "exotel"
    tel = client.app.state.telephony
    assert tel.active == "exotel" and tel.order == ["exotel", "twilio"]
    assert SETTINGS.telephony_primary == "exotel"


def test_call_trigger_is_503_with_a_reason_while_telephony_is_off(client, H):
    r = client.post("/v1/calls/trigger", json={"parcel_id": _pid(client)}, headers=H("fpo_coordinator"))
    assert r.status_code == 503 and "TELEPHONY_ENABLED" in r.json()["detail"] and "Nothing was dialled" in r.json()["detail"]
    assert client.app.state.telephony.calls == {} and client.app.state.ops.calls == {}


def test_call_is_refused_outside_calling_hours_and_does_not_use_the_rate_limit(client, H, calls_on):
    tel = client.app.state.telephony
    tel.clock = lambda: datetime(2026, 10, 23, 14, 0, tzinfo=timezone.utc)      # 19:30 IST
    pid = _pid(client)
    for _ in range(3):
        r = client.post("/v1/calls/trigger", json={"parcel_id": pid}, headers=H("fpo_coordinator"))
        assert r.status_code == 409 and "08:00-19:00" in r.json()["detail"]
    tel.clock = lambda: datetime(2026, 10, 23, 2, 29, tzinfo=timezone.utc)      # 07:59 IST
    assert client.post("/v1/calls/trigger", json={"parcel_id": pid}, headers=H("fpo_coordinator")).status_code == 409
    tel.clock = lambda: datetime(2026, 10, 23, 2, 30, tzinfo=timezone.utc)      # 08:00 IST
    assert client.post("/v1/calls/trigger", json={"parcel_id": pid}, headers=H("fpo_coordinator")).status_code == 202
    assert not any(c.get("provider") != "exotel" for c in client.app.state.ops.calls.values())


def test_every_call_opens_with_the_disclosure_line(client, H, calls_on):
    pid = _pid(client)
    call = client.post("/v1/calls/trigger", json={"parcel_id": pid, "lang": "en"}, headers=H("fpo_coordinator")).json()
    log = client.get(f"/v1/calls/{call['call_id']}/log", headers=H("fpo_coordinator")).json()
    assert log["transcript"][0]["text"].startswith("This is an automated call from Vayu-Swachh")
    s = client.get(f"/v1/calls/session?lang=hi&parcel_id={pid}", headers=H("farmer")).json()
    assert s["lines"][0].startswith("यह वायु-स्वच्छ की ओर से")


def test_buy_back_line_is_absent_without_an_active_contract(client, H):
    pid = _pid(client)
    for lang, marker in BUYBACK.items():
        s = client.get(f"/v1/calls/session?lang={lang}&parcel_id={pid}", headers=H("farmer")).json()
        assert not any(marker in ln for ln in s["lines"]), lang
        assert not any("₹" in ln for ln in s["lines"]), lang
        assert s["prices"] == {"super_seeder_per_acre": None, "straw_per_tonne": None}
    for b in client.platform.world.scripts.values():
        assert not any("₹" in ln for lines in b.values() for ln in lines)       # the advisory agent's stored scripts too


def test_buy_back_line_appears_with_an_active_contract(client, H, contract_active):
    pid = _pid(client)
    for lang, marker in BUYBACK.items():
        s = client.get(f"/v1/calls/session?lang={lang}&parcel_id={pid}", headers=H("farmer")).json()
        assert any(marker in ln and "1,650" in ln for ln in s["lines"]), lang
        assert any("750" in ln for ln in s["lines"])
        assert s["prices"] == {"super_seeder_per_acre": 750, "straw_per_tonne": 1650}


def test_booking_and_collection_carry_rates_only_from_a_contract(client, H):
    pid = _pid(client, 4)
    b = client.post("/v1/bookings", json={"parcel_id": pid}, headers=H("farmer")).json()
    assert b["rental_rate_inr_per_acre"] is None and b["rate_source"] is None
    c = client.post("/v1/collections/request", json={"parcel_id": pid}, headers=H("farmer")).json()
    assert c["floor_price_inr_per_tonne"] is None and c["estimated_value_inr"] is None
    assert client.get("/v1/collections/summary", headers=H("fpo_coordinator")).json()["floor_price_inr_per_tonne"] is None
    client.platform.world.contracts = [ACTIVE_CONTRACT]
    c2 = client.post("/v1/collections/request", json={"parcel_id": _pid(client, 5)}, headers=H("farmer")).json()
    assert c2["floor_price_inr_per_tonne"] == 1650 and c2["rate_source"] == "partner_contract:PC-TEST"
    b2 = client.post("/v1/bookings", json={"parcel_id": _pid(client, 6)}, headers=H("farmer")).json()
    assert b2["rental_rate_inr_per_acre"] == 750 and b2["rate_source"] == "partner_contract:PC-TEST"
    assert client.get("/v1/collections/summary", headers=H("fpo_coordinator")).json()["floor_price_inr_per_tonne"] == 1650


def test_keypad_nine_reaches_an_fpo_worker_without_promising_a_time_when_unstaffed(client, H):
    pid = _pid(client)
    first = client.post("/v1/calls/keypress", json={"parcel_id": pid, "key": "9"}, headers=H("farmer")).json()
    assert first["status"] == "awaiting_confirmation" and not any(e.action == "fpo_desk.requested" for e in client.platform.audit.entries())
    r = client.post("/v1/calls/keypress", json={"parcel_id": pid, "key": "1"}, headers=H("farmer")).json()
    assert r["status"] == "callback_unscheduled" and r["slot"] is None and r["reference_id"].startswith("FPO-C-")
    assert any(e.action == "fpo_desk.requested" for e in client.platform.audit.entries())


def test_script_offers_an_fpo_worker_on_nine_in_every_language(client, H):
    pid = _pid(client)
    want = {"en": "talk to an FPO worker", "hi": "FPO कर्मचारी", "pa": "FPO ਕਰਮਚਾਰੀ"}
    for lang, marker in want.items():
        lines = client.get(f"/v1/calls/session?lang={lang}&parcel_id={pid}", headers=H("farmer")).json()["lines"]
        assert marker in lines[-1], lang
        assert not any("agronomist" in ln.lower() for ln in lines)
