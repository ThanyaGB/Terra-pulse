"""Telephony adapter with failover (T4.1, spec section 9). One interface, primary + secondary provider.

Health is checked every 30 s by the caller (`check_health`); after 3 consecutive failures new calls go to the
secondary and an alert is raised. Calls already in progress stay on the provider that started them. Calls are placed only
inside the permitted hours in config/telephony.yaml (default 08:00-19:00 IST). Exotel is the primary, Twilio the standby."""
from __future__ import annotations

import base64
import hashlib
import hmac
import itertools
from dataclasses import dataclass, field
from datetime import datetime, time, timezone
from typing import Any, Callable, Protocol
from zoneinfo import ZoneInfo

import httpx

from domain.config import load_yaml

DTMF_KEYS = ("0", "1", "2", "9", "*")     # menu 1/2/9, machine 1/2, then 1 = confirm, 0 = back; * repeats (ADR-09)
_CFG = load_yaml("telephony.yaml")
FAILURES_BEFORE_FAILOVER = int(_CFG["health_check"]["failures_before_failover"])
HEALTH_INTERVAL_S = int(_CFG["health_check"]["interval_s"])


class ProviderError(Exception):
    pass


class OutsideCallingHours(Exception):
    pass


def calling_window(cfg: dict[str, str] | None = None) -> tuple[time, time, ZoneInfo]:
    h = cfg or _CFG["calling_hours"]
    return time.fromisoformat(h["start"]), time.fromisoformat(h["end"]), ZoneInfo(h["tz"])


def within_calling_hours(now: datetime, cfg: dict[str, str] | None = None) -> bool:
    start, end, tz = calling_window(cfg)
    return start <= now.astimezone(tz).time() < end


class TelephonyProvider(Protocol):
    name: str
    def place_call(self, to: str, script_url: str, callback_url: str) -> str: ...
    def healthy(self) -> bool: ...
    def verify_webhook(self, url: str, params: dict[str, str], signature: str) -> bool: ...


class TwilioProvider:
    name = "twilio"

    def __init__(self, account_sid: str, auth_token: str, from_number: str, client: httpx.Client | None = None) -> None:
        self.sid, self.token, self.from_number = account_sid, auth_token, from_number
        self.client = client or httpx.Client(timeout=20)

    def place_call(self, to: str, script_url: str, callback_url: str) -> str:
        r = self.client.post(f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Calls.json", auth=(self.sid, self.token),
                             data={"To": to, "From": self.from_number, "Url": script_url, "StatusCallback": callback_url})
        if r.status_code >= 400:
            raise ProviderError(f"twilio {r.status_code}")
        return str(r.json()["sid"])

    def healthy(self) -> bool:
        try:
            return self.client.get(f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}.json", auth=(self.sid, self.token)).status_code == 200
        except httpx.HTTPError:
            return False

    def verify_webhook(self, url: str, params: dict[str, str], signature: str) -> bool:
        """Twilio: base64(HMAC-SHA1(token, url + sorted key+value pairs))."""
        payload = url + "".join(k + params[k] for k in sorted(params))
        mac = base64.b64encode(hmac.new(self.token.encode(), payload.encode(), hashlib.sha1).digest()).decode()
        return hmac.compare_digest(mac, signature)


class ExotelProvider:
    name = "exotel"

    def __init__(self, sid: str, api_key: str, api_token: str, caller_id: str, subdomain: str = "api.exotel.com",
                 client: httpx.Client | None = None) -> None:
        self.sid, self.key, self.token, self.caller_id, self.sub = sid, api_key, api_token, caller_id, subdomain
        self.client = client or httpx.Client(timeout=20)

    def place_call(self, to: str, script_url: str, callback_url: str) -> str:
        r = self.client.post(f"https://{self.sub}/v1/Accounts/{self.sid}/Calls/connect.json", auth=(self.key, self.token),
                             data={"From": to, "CallerId": self.caller_id, "Url": script_url, "StatusCallback": callback_url})
        if r.status_code >= 400:
            raise ProviderError(f"exotel {r.status_code}")
        return str(r.json()["Call"]["Sid"])

    def healthy(self) -> bool:
        try:
            return self.client.get(f"https://{self.sub}/v1/Accounts/{self.sid}", auth=(self.key, self.token)).status_code == 200
        except httpx.HTTPError:
            return False

    def verify_webhook(self, url: str, params: dict[str, str], signature: str) -> bool:
        payload = url + "".join(k + params[k] for k in sorted(params))
        return hmac.compare_digest(hmac.new(self.token.encode(), payload.encode(), hashlib.sha256).hexdigest(), signature)


@dataclass
class FakeProvider:
    """Deterministic provider for tests and local runs; `up` can be flipped to simulate an outage."""
    name: str = "fake"
    secret: str = "test-secret"
    up: bool = True
    calls: list[tuple[str, str]] = field(default_factory=list)
    _ids: Any = field(default_factory=lambda: itertools.count(1))

    def place_call(self, to: str, script_url: str, callback_url: str) -> str:
        if not self.up:
            raise ProviderError(f"{self.name} outage")
        cid = f"{self.name}-CA{next(self._ids):04d}"
        self.calls.append((cid, to))
        return cid

    def healthy(self) -> bool:
        return self.up

    def sign(self, url: str, params: dict[str, str]) -> str:
        payload = url + "".join(k + params[k] for k in sorted(params))
        return hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

    def verify_webhook(self, url: str, params: dict[str, str], signature: str) -> bool:
        return hmac.compare_digest(self.sign(url, params), signature)


@dataclass
class CallRecord:
    call_id: str
    provider: str
    parcel_id: str
    status: str = "queued"
    transcript: list[str] = field(default_factory=list)
    intent: str | None = None


class TelephonyAdapter:
    def __init__(self, primary: TelephonyProvider, secondary: TelephonyProvider,
                 on_alert: Callable[[str], None] | None = None, on_dtmf: Callable[[CallRecord, str], None] | None = None,
                 clock: Callable[[], datetime] | None = None) -> None:
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self.providers = {primary.name: primary, secondary.name: secondary}
        self.order = [primary.name, secondary.name]
        self.active = primary.name
        self.failures = 0
        self.on_alert = on_alert or (lambda _m: None)
        self.on_dtmf = on_dtmf or (lambda _r, _k: None)
        self.calls: dict[str, CallRecord] = {}

    # -- failover --
    def check_health(self) -> bool:
        """Run every HEALTH_INTERVAL_S seconds."""
        ok = self.providers[self.active].healthy()
        self.failures = 0 if ok else self.failures + 1
        if self.failures >= FAILURES_BEFORE_FAILOVER:
            self._failover(f"{self.active} failed {self.failures} health checks")
        return ok

    def _failover(self, reason: str) -> None:
        other = next(n for n in self.order if n != self.active)
        self.on_alert(f"telephony failover {self.active} -> {other}: {reason}")
        self.active, self.failures = other, 0

    # -- calls --
    def place_call(self, parcel_id: str, to: str, script_url: str, callback_url: str) -> CallRecord:
        if not within_calling_hours(self.clock()):
            start, end, tz = calling_window()
            raise OutsideCallingHours(f"calls are placed only {start:%H:%M}-{end:%H:%M} {tz.key}")
        failed = self.active
        try:
            cid = self.providers[failed].place_call(to, script_url, callback_url)
            provider = failed
        except ProviderError as exc:
            self.failures += 1
            if self.failures >= FAILURES_BEFORE_FAILOVER:
                self._failover(str(exc))
            # this call still goes out on the other provider so the farmer is not missed
            provider = next(n for n in self.order if n != failed)
            cid = self.providers[provider].place_call(to, script_url, callback_url)
        rec = CallRecord(cid, provider, parcel_id)
        self.calls[cid] = rec
        return rec

    def handle_webhook(self, provider: str, url: str, params: dict[str, str], signature: str) -> CallRecord:
        """Signed webhook for call status and DTMF (0, 1, 2, 9). Unsigned or tampered requests are rejected. The digit is passed
        on as is: what it means (menu choice or confirm/back) depends on the call's keypad step, which `Ops.handle_key` tracks."""
        if not self.providers[provider].verify_webhook(url, params, signature):
            raise PermissionError("invalid webhook signature")
        rec = self.calls[params["CallSid"]]
        if "CallStatus" in params:
            rec.status = params["CallStatus"]
        digit = params.get("Digits")
        if digit:
            if digit not in DTMF_KEYS:
                raise ValueError(f"unsupported DTMF {digit!r}")
            rec.transcript.append(f"pressed {digit}")
            self.on_dtmf(rec, digit)
        return rec
