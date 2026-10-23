import threading

import httpx
import pytest

from ingestion.crm import SimulatedCrm
from integrations.bhashini import AudioCache, BhashiniClient, script_hash
from integrations.biocng import BioCngPartner, CollectionRequest, LedgerEntry, ReconciliationItem
from integrations.machinery_crm import CrmSync
from integrations.mcd import McdIntegration
from integrations.ratelimit import MemoryLimiter, RateLimitExceeded
from integrations.telephony import FakeProvider, TelephonyAdapter, TwilioProvider
from integrations.traffic import TrafficAuthority
from integrations.whatsapp import TemplateNotApproved, TemplateRegistry, WhatsAppSender


def test_failover_after_three_failures_and_in_progress_calls_survive():
    alerts = []
    a, b = FakeProvider("twilio"), FakeProvider("exotel")
    tel = TelephonyAdapter(a, b, on_alert=alerts.append)
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
    tel = TelephonyAdapter(a, b)
    a.up = False
    rec = tel.place_call("P1", "9814000000", "u", "cb")
    assert rec.provider == "exotel" and tel.active == "twilio" and tel.failures == 1


def test_signed_webhook_and_dtmf_keys():
    got = []
    p = FakeProvider("twilio")
    tel = TelephonyAdapter(p, FakeProvider("exotel"), on_dtmf=lambda r, k: got.append(k))
    rec = tel.place_call("P1", "9814000000", "u", "cb")
    params = {"CallSid": rec.call_id, "Digits": "1"}
    with pytest.raises(PermissionError):
        tel.handle_webhook("twilio", "https://x/h", params, "bad")
    out = tel.handle_webhook("twilio", "https://x/h", params, p.sign("https://x/h", params))
    assert got == ["1"] and out.intent == "book_machine"
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


def test_whatsapp_rejects_unapproved_templates_and_sends_approved():
    reg = TemplateRegistry()
    reg.approve("harvest_reminder", {"pa", "hi"})
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.content)
        return httpx.Response(200, json={"messages": [{"id": "wamid.1"}]})
    s = WhatsAppSender("123", "tok", reg, client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(TemplateNotApproved):
        s.send_template("919814000000", "free_text_promo", "pa", [])
    with pytest.raises(TemplateNotApproved):
        s.send_template("919814000000", "harvest_reminder", "en", [])
    assert s.send_template("919814000000", "harvest_reminder", "pa", ["Gurpreet"]) == "wamid.1" and len(seen) == 1


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


def test_traffic_logs_before_send_and_aborts_if_logging_fails():
    order = []
    t = TrafficAuthority(lambda a, p: order.append(("log", a)), lambda p: order.append(("send", p["id"])))
    t.send_directive({"id": "D1"})
    assert order == [("log", "traffic.directive.send"), ("send", "D1")]

    def boom(a, p):
        raise RuntimeError("audit store down")
    t2 = TrafficAuthority(boom, lambda p: order.append("sent"))
    with pytest.raises(RuntimeError):
        t2.send_directive({"id": "D2"})
    assert "sent" not in order


def test_mcd_work_order_lifecycle():
    mcd = McdIntegration()
    wo = mcd.dispatch({"id": "WO-1", "action_type": "fog_cannons", "location": "ito"})
    assert wo["status"] == "dispatched"
    mcd.webhook("WO-1", gps=(28.63, 77.24))
    assert mcd.orders["WO-1"]["gps"]["lat"] == 28.63
    assert mcd.webhook("WO-1", status="completed")["status"] == "completed"
    with pytest.raises(ValueError):
        mcd.webhook("WO-1", status="dispatched")


def test_rate_limit_refuses_the_n_plus_1th_call_with_a_reason():
    now = [1000.0]
    rl = MemoryLimiter(2, 86400, clock=lambda: now[0])
    rl.hit("call:P1")
    rl.hit("call:P1")
    with pytest.raises(RateLimitExceeded, match="limit of 2"):
        rl.hit("call:P1")
    rl.hit("call:P2")                                  # per-parcel
    now[0] += 86401
    rl.hit("call:P1")                                  # window passed
