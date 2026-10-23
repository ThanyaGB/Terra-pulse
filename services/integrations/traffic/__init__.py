"""Traffic authority interface (T4.6). The approved channel is not yet known (open question 5), so this defines the
sender contract. Every directive is logged BEFORE it is sent."""
from __future__ import annotations

from typing import Any, Callable


class TrafficAuthority:
    def __init__(self, log_before_send: Callable[[str, dict[str, Any]], None], transport: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.log = log_before_send
        self.transport = transport or (lambda _p: None)   # swap for the approved interface
        self.sent: list[dict[str, Any]] = []

    def send_directive(self, directive: dict[str, Any]) -> None:
        self.log("traffic.directive.send", directive)       # audit first; if this raises nothing is sent
        self.transport(directive)
        self.sent.append(directive)
