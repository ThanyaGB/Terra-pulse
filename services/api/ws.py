"""WebSocket /ws/live (T3.6). Envelope: {channel, ts, trace_id, payload}. Auth on connect; channel authorisation by role."""
from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

CHANNEL_ROLES: dict[str, set[str]] = {
    "aqi.update": {"citizen", "policy_officer", "fpo_coordinator", "admin"},
    "alert.fired": {"citizen", "policy_officer", "fpo_coordinator", "admin"},
    "agent.status": {"policy_officer", "admin"},
    "booking.update": {"fpo_coordinator", "farmer"},
    "work_order.update": {"municipal_supervisor", "policy_officer", "admin"},
}


def envelope(channel: str, payload: dict[str, Any], trace_id: str | None = None) -> dict[str, Any]:
    return {"channel": channel, "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "trace_id": trace_id or uuid.uuid4().hex, "payload": payload}


@dataclass(eq=False)
class Client:
    ws: WebSocket
    role: str
    channels: set[str] = field(default_factory=set)
    queue: asyncio.Queue[dict[str, Any]] = field(default_factory=lambda: asyncio.Queue(maxsize=500))


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()

    def authorised(self, role: str, channel: str) -> bool:
        return role in CHANNEL_ROLES.get(channel, set())

    def subscribe(self, client: Client, channels: list[str]) -> tuple[list[str], list[str]]:
        ok: list[str] = []
        denied: list[str] = []
        for ch in channels:
            (ok if self.authorised(client.role, ch) else denied).append(ch)
        client.channels.update(ok)
        return ok, denied

    def publish(self, channel: str, payload: dict[str, Any], trace_id: str | None = None) -> None:
        msg = envelope(channel, payload, trace_id)
        for c in list(self.clients):
            if channel in c.channels:
                try:
                    c.queue.put_nowait(msg)
                except asyncio.QueueFull:
                    pass   # a stalled client must not hold up the platform

    async def pump(self, client: Client) -> None:
        while True:
            msg = await client.queue.get()
            await client.ws.send_text(json.dumps(msg))
