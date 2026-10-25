import threading
from datetime import datetime, timezone

import httpx
import pytest

from ingestion.crm import SimulatedCrm
from integrations.bhashini import AudioCache, BhashiniClient, script_hash
from integrations.biocng import BioCngPartner, CollectionRequest, LedgerEntry, ReconciliationItem
from integrations.machinery_crm import CrmSync
from integrations.mcd import NullNotifier
from integrations.telephony import FakeProvider, TelephonyAdapter, TwilioProvider


def NOON_IST() -> datetime:
    """A fixed time inside calling hours (12:00 IST), so these tests do not depend on when CI runs."""
    return datetime(2026, 10, 23, 6, 30, tzinfo=timezone.utc)


def test_failover_after_three_failures_and_in_progress_calls_survive():
    alerts = []
    a, b = FakeProvider("twilio"), FakeProvider("exotel")
    tel = TelephonyAdapter(a, b, on_alert=alerts.append, clock=NOON_IST)
    first = tel.place_call("P1", "9814000000", "u", "cb")
    assert first.provider == "twilio"
    a.up = False                                     # simulated primary outage
    for _ in range(3):
        tel.check_health()
    assert tel.active == "exotel" and any("failover" in m for m in alerts)
    assert tel.calls[first.call_id].provider == "twilio"      # in-progress call is not moved or dropped
    assert tel.place_call("P2", "9814000001", "u", "cb").provider == "exotel"


def test_call_still_goes_out_when_primary_fails_mid_call_placement():
    a, b = FakeProvider("twilio"), FakeProvider("exotel")
    tel = TelephonyAdapter(a, b, clock=NOON_IST)
    a.up = False
    rec = tel.place_call("P1", "9814000000", "u", "cb")
    assert rec.provider == "exotel" and tel.active == "twilio" and tel.failures == 1


def test_signed_webhook_and_dtmf_keys():
    got = []
    p = FakeProvider("twilio")
    tel = TelephonyAdapter(p, FakeProvider("exotel"), on_dtmf=lambda r, k: got.append(k), clock=NOON_IST)
    rec = tel.place_call("P1", "9814000000", "u", "cb")
    params = {"CallSid": rec.call_id, "Digits": "1"}
    with pytest.raises(PermissionError):
        tel.handle_webhook("twilio", "https://x/h", params, "bad")
    out = tel.handle_webhook("twilio", "https://x/h", params, p.sign("https://x/h", params))
    assert got == ["1"] and out.transcript[-1] == "pressed 1"            # meaning (menu or confirm) is decided by Ops.handle_key
    back = {"CallSid": rec.call_id, "Digits": "0"}                       # 0 = go back, allowed in the confirm step
    tel.handle_webhook("twilio", "https://x/h", back, p.sign("https://x/h", back))
    assert got == ["1", "0"]
    bad = {"CallSid": rec.call_id, "Digits": "7"}
    with pytest.raises(ValueError):
        tel.handle_webhook("twilio", "https://x/h", bad, p.sign("https://x/h", bad))


def test_twilio_signature_algorithm():
    import base64
    import hashlib
    import hmac
    t = TwilioProvider("AC1", "tok", "+1555")
    url, params = "https://x/hook", {"CallSid": "CA1", "Digits": "9"}
    sig = base64.b64encode(hmac.new(b"tok", (url + "CallSidCA1Digits9").encode(), hashlib.sha1).digest()).decode()
    assert t.verify_webhook(url, params, sig) and not t.verify_webhook(url, params, sig[:-2] + "xx")


def test_twilio_http_call_uses_the_rest_api():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["body"] = str(req.url), req.content.decode()
        return httpx.Response(201, json={"sid": "CA999"})
    t = TwilioProvider("AC1", "tok", "+1555", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert t.place_call("+919814000000", "http://s", "http://cb") == "CA999" and "Accounts/AC1/Calls.json" in seen["url"]


def test_bhashini_second_identical_script_served_from_cache(tmp_path):
    calls = []
    cli = BhashiniClient("http://x", "key", AudioCache(tmp_path), tts=lambda t, l: calls.append(t) or b"WAV" + t.encode())
    a1, c1 = cli.synthesize("ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "pa")
    a2, c2 = cli.synthesize("ਸਤ ਸ੍ਰੀ ਅਕਾਲ  ", "pa")        # trailing whitespace normalises to the same hash
    assert (c1, c2) == (False, True) and a1 == a2 and len(calls) == 1 and cli.provider_calls == 1
    assert script_hash("a", "pa") != script_hash("a", "hi")


def test_whatsapp_is_not_part_of_the_platform():
    """WhatsApp was removed (farmers confirm on the keypad instead): no integration package and no feature flag."""
    import importlib.util

    from domain.features import FeatureFlags, UnknownFlag
    assert importlib.util.find_spec("integrations.whatsapp") is None
    with pytest.raises(UnknownFlag):
        FeatureFlags.load().value("WHATSAPP_ENABLED")


def test_concurrent_booking_one_success_one_conflict():
    crm = SimulatedCrm()
    free = next(m for m in crm.list_machines() if m.status == "available")
    sync = CrmSync(crm)
    results = []
    barrier = threading.Barrier(2)

    def book(parcel):
        barrier.wait()
        results.append(sync.push_booking(free.id, parcel, free.version))
    ts = [threading.Thread(target=book, args=(p,)) for p in ("PCL-A", "PCL-B")]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(r is not None for r in results) == 1 and len(sync.fpo_queue) == 1
    assert sync.fpo_queue[0].current_status == "in_use"


def test_biocng_reconciliation():
    p = BioCngPartner()
    p.request_collection(CollectionRequest("COL-1", "PCL-1", 10.0, 1650))
    ok = p.weighbridge_receipt("COL-1", 10.3)
    assert isinstance(ok, LedgerEntry) and ok.amount_inr == round(10.3 * 1650)
    p.request_collection(CollectionRequest("COL-2", "PCL-2", 10.0, 1650))
    bad = p.weighbridge_receipt("COL-2", 7.0)
    assert isinstance(bad, ReconciliationItem) and "differs" in bad.reason
    assert isinstance(p.weighbridge_receipt("COL-404", 1.0), ReconciliationItem) and len(p.reconciliation) == 2


def test_mcd_seam_is_a_noop_notifier_with_no_rest_adapter():
    NullNotifier().notify_created({"id": "WO-1"})
    import integrations.mcd as m
    assert not hasattr(m, "McdIntegration") and not hasattr(m, "McdClient")
