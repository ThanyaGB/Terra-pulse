"""Meta WhatsApp Business Cloud API (T4.3). Only pre-approved templates can be sent; anything else raises. Nothing is sent
unless the WHATSAPP_ENABLED flag is on (gate G1); with it off the sender raises before any network call."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import httpx


class TemplateNotApproved(Exception):
    pass


class WhatsAppDisabled(Exception):
    pass


@dataclass
class TemplateRegistry:
    approved: dict[str, set[str]] = field(default_factory=dict)   # template name -> approved language codes

    def approve(self, name: str, languages: set[str]) -> None:
        self.approved[name] = languages

    def check(self, name: str, lang: str) -> None:
        if name not in self.approved or lang not in self.approved[name]:
            raise TemplateNotApproved(f"template {name!r} ({lang}) is not approved")


class WhatsAppSender:
    def __init__(self, phone_number_id: str, token: str, registry: TemplateRegistry, client: httpx.Client | None = None,
                 limiter: Callable[[str], bool] | None = None, enabled: Callable[[], bool] = lambda: False) -> None:
        self.url = f"https://graph.facebook.com/v20.0/{phone_number_id}/messages"
        self.token, self.registry = token, registry
        self.client = client or httpx.Client(timeout=20)
        self.limiter = limiter
        self.enabled = enabled     # wire to FeatureFlags.enabled('WHATSAPP_ENABLED'); the default is OFF

    def send_template(self, to: str, template: str, lang: str, params: list[str], key: str | None = None) -> str:
        if not self.enabled():
            raise WhatsAppDisabled("WhatsApp sending is switched off (feature flag WHATSAPP_ENABLED)")
        self.registry.check(template, lang)
        if self.limiter is not None and key is not None and not self.limiter(key):
            raise RuntimeError(f"rate limit exceeded for {key}")
        r = self.client.post(self.url, headers={"Authorization": f"Bearer {self.token}"}, json={
            "messaging_product": "whatsapp", "to": to, "type": "template",
            "template": {"name": template, "language": {"code": lang},
                         "components": [{"type": "body", "parameters": [{"type": "text", "text": p} for p in params]}]}})
        r.raise_for_status()
        return str(r.json()["messages"][0]["id"])
