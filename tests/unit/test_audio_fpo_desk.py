"""ADR-10 / ADR-22 / T4.1 / T4.2: audio library is the default, Bhashini is optional and cached, no ASR path, keypad 9 routing to an FPO worker."""
import pathlib
import re
from datetime import datetime, timezone

import pytest

from api.fpo_desk import FpoDesk
from integrations.audio import DTMF_PROMPTS, AudioLibrary, AudioService
from integrations.bhashini import AudioCache, BhashiniClient, script_hash
from integrations.telephony import FakeProvider, OutsideCallingHours, TelephonyAdapter, within_calling_hours

ROOT = pathlib.Path(__file__).resolve().parents[2]


def utc(h, m=0, d=23):
    return datetime(2026, 10, d, h, m, tzinfo=timezone.utc)


# ---------- audio ----------
def _lib(tmp_path, text="Hello", lang="pa"):
    lib = AudioLibrary(tmp_path / "lib")
    p = lib.clip_path(text, lang)
    p.parent.mkdir(parents=True)
    p.write_bytes(b"RECORDED")
    return lib


def test_prerecorded_is_the_default_and_never_touches_bhashini(tmp_path):
    calls = []
    cli = BhashiniClient("http://x", "k", AudioCache(tmp_path / "c"), tts=lambda t, lg: calls.append(t) or b"TTS")
    svc = AudioService(_lib(tmp_path), lambda: "prerecorded", cli)
    r = svc.audio_for("Hello", "pa")
    assert r.source == "prerecorded" and r.audio == b"RECORDED" and calls == []


def test_missing_clip_is_reported_not_synthesised(tmp_path):
    svc = AudioService(AudioLibrary(tmp_path), lambda: "prerecorded")
    r = svc.audio_for("Not recorded", "hi")
    assert r.source == "missing" and r.audio is None and svc.missing == [("hi", "Not recorded")]


def test_bhashini_provider_caches_by_script_hash_and_falls_back_to_the_library(tmp_path):
    calls = []
    cli = BhashiniClient("http://x", "k", AudioCache(tmp_path / "c"), tts=lambda t, lg: calls.append(t) or b"TTS")
    svc = AudioService(_lib(tmp_path), lambda: "bhashini", cli)
    assert svc.audio_for("Hello", "pa").source == "bhashini"
    assert svc.audio_for("Hello", "pa").source == "bhashini-cache" and len(calls) == 1
    assert (tmp_path / "c" / f"{script_hash('Hello', 'pa')}.wav").exists()

    def down(t, lg):
        raise RuntimeError("bhashini down")

    svc2 = AudioService(_lib(tmp_path / "x"), lambda: "bhashini", BhashiniClient("http://x", "k", AudioCache(tmp_path / "c2"), tts=down))
    assert svc2.audio_for("Hello", "pa").source == "prerecorded"


def test_dtmf_prompts_come_from_the_static_set_with_english_fallback(tmp_path):
    lib = AudioLibrary(tmp_path)
    (tmp_path / "prompts" / "en").mkdir(parents=True)
    (tmp_path / "prompts" / "en" / "press_1.wav").write_bytes(b"EN1")
    (tmp_path / "prompts" / "pa").mkdir(parents=True)
    (tmp_path / "prompts" / "pa" / "press_2.wav").write_bytes(b"PA2")
    assert lib.prompt("press_2", "pa") == b"PA2" and lib.prompt("press_1", "pa") == b"EN1" and lib.prompt("press_9", "pa") is None
    cov = lib.coverage([("pa", "x")])
    assert cov["required"] == 1 and cov["present"] == 0 and len(cov["prompts_missing"]) == 2 * len(DTMF_PROMPTS) - 1


def test_no_asr_code_path_anywhere():
    assert not hasattr(BhashiniClient, "transcribe")
    hits = []
    for p in list((ROOT / "services").rglob("*.py")) + list((ROOT / "packages").rglob("*.py")):
        if re.search(r"transcribe|speech_to_text|taskType\W+asr|\"asr\"", p.read_text(encoding="utf8"), re.I):
            hits.append(str(p.relative_to(ROOT)))
    assert hits == [], hits       # keypad input only (ADR-09)


# ---------- telephony hours and failover ----------
def test_calling_hours_boundaries_are_ist():
    assert within_calling_hours(utc(2, 30)) and within_calling_hours(utc(13, 29)) and not within_calling_hours(utc(2, 29)) and not within_calling_hours(utc(13, 30))


def test_adapter_refuses_outside_hours_and_fails_over_after_three_failed_checks():
    a, b = FakeProvider("exotel"), FakeProvider("twilio")
    alerts = []
    tel = TelephonyAdapter(a, b, on_alert=alerts.append, clock=lambda: utc(6))
    first = tel.place_call("P1", "9800000000", "u", "cb")
    a.up = False
    tel.check_health()
    tel.check_health()
    assert tel.active == "exotel" and not alerts
    tel.check_health()
    assert tel.active == "twilio" and alerts and "exotel -> twilio" in alerts[0]
    assert tel.calls[first.call_id].provider == "exotel"                  # the call in progress stays where it started
    assert tel.place_call("P2", "9800000000", "u", "cb").provider == "twilio"
    tel.clock = lambda: utc(15)
    with pytest.raises(OutsideCallingHours):
        tel.place_call("P3", "9800000000", "u", "cb")


# ---------- keypad 9 (ADR-22) ----------
CFG = {"pilot_hours": {"start": "08:00", "end": "18:00", "tz": "Asia/Kolkata"}, "roster": ["fpo-1"], "callback_slots": ["19:30", "20:00"], "slot_capacity": 2}


def test_staffed_hours_put_the_farmer_in_the_queue():
    d = FpoDesk(lambda: utc(6), CFG)
    r1, r2 = d.request("P1"), d.request("P2")
    assert (r1["status"], r1["position"], r2["position"]) == ("queued", 1, 2)


def test_outside_hours_a_callback_slot_is_offered_and_capacity_is_respected():
    now = utc(13)                                                           # 18:30 IST, after pilot hours
    d = FpoDesk(lambda: now, CFG)
    slots = [d.request(f"P{i}")["slot"] for i in range(5)]
    assert slots[:2] == [{"date": "2026-10-23", "start": "19:30"}] * 2 and slots[2:4] == [{"date": "2026-10-23", "start": "20:00"}] * 2
    assert slots[4] == {"date": "2026-10-24", "start": "19:30"}


def test_empty_roster_means_callback_even_in_pilot_hours():
    d = FpoDesk(lambda: utc(6), {**CFG, "roster": []})
    assert d.request("P1")["status"] == "callback_slot"


def test_no_roster_and_no_slots_promises_no_time():
    d = FpoDesk(lambda: utc(6), {**CFG, "roster": [], "callback_slots": []})
    r = d.request("P1")
    assert r["status"] == "callback_unscheduled" and r["slot"] is None
