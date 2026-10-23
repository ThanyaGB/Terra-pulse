"""Directives with two-person approval for diversions (ADR-07, T3.4). Every action is audited BEFORE dispatch."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Callable

from api.audit import AuditLog
from domain.grap import requires_two_person

PREVIEWS: dict[str, dict[str, Any]] = {
    "grap_ii": {
        "title": "Issue GRAP-II alert",
        "action": "Broadcast a Stage-II GRAP alert to all NCR enforcement agencies and publish a public advisory.",
        "affectedAreas": [
            {"id": "delhi", "name": "Delhi (all 11 districts)", "detail": "Dust control, parking fees, DG-set curbs"},
            {"id": "gurugram", "name": "Gurugram", "detail": "Construction dust enforcement"},
            {"id": "faridabad", "name": "Faridabad", "detail": "Industrial emission checks"},
            {"id": "ghaziabad", "name": "Ghaziabad", "detail": "Road sweeping and water sprinkling"},
            {"id": "noida", "name": "Noida / Greater Noida", "detail": "Construction dust enforcement"},
        ],
        "note": "Alert is sent to state pollution control boards and municipal commissioners. It can be withdrawn later.",
    },
    "diversion_trucks": {
        "title": "Issue diversion order for out-of-state diesel trucks",
        "action": "Divert non-essential out-of-state diesel trucks away from Delhi to the peripheral expressways.",
        "affectedAreas": [
            {"id": "singhu", "name": "Singhu / Kundli border", "detail": "NH-44, northbound entry"},
            {"id": "tikri", "name": "Tikri border", "detail": "NH-9, westbound entry"},
            {"id": "ghazipur", "name": "Ghazipur border", "detail": "NH-24, eastern entry"},
            {"id": "kmp", "name": "KMP / Eastern Peripheral Expressway", "detail": "Designated diversion route"},
        ],
        "note": "Requires a second policy officer's approval before it is sent. Needs legal sign-off (open question 9).",
    },
    "fog_cannons": {
        "title": "Deploy fog cannons on heavy-pollution corridors",
        "action": "Dispatch available anti-smog fog cannons to the corridors forecast to peak within 12 hours.",
        "affectedAreas": [
            {"id": "anand-vihar", "name": "Anand Vihar ISBT corridor", "detail": "3 units"},
            {"id": "rohini", "name": "Rohini Sectors 15-17", "detail": "2 units"},
            {"id": "ito", "name": "ITO to Pragati Maidan", "detail": "2 units"},
            {"id": "okhla", "name": "Okhla Phase 1-3", "detail": "1 unit"},
        ],
        "note": "Water supply is arranged by MCD.",
    },
}


class ApprovalError(Exception):
    pass


class DirectiveService:
    def __init__(self, audit: AuditLog, dispatch: Callable[[dict[str, Any]], None] | None = None) -> None:
        self.audit = audit
        self.dispatch_hook = dispatch or (lambda _d: None)
        self.directives: dict[str, dict[str, Any]] = {}

    def preview(self, type_: str) -> dict[str, Any]:
        if type_ not in PREVIEWS:
            raise KeyError(type_)
        return {"type": type_, **PREVIEWS[type_]}

    def create(self, type_: str, area_ids: list[str], actor: str) -> dict[str, Any]:
        if type_ not in PREVIEWS:
            raise KeyError(type_)
        did = f"DIR-{secrets.token_hex(3).upper()}"
        two = requires_two_person(type_)
        d: dict[str, Any] = {"id": did, "type": type_, "areaIds": area_ids, "createdBy": actor, "issuedAt": _now(),
                             "status": "pending_approval" if two else "queued", "approvedBy": None, "requiresSecondApprover": two}
        self.directives[did] = d
        self.audit.append(actor, "directive.created", {k: d[k] for k in ("id", "type", "areaIds", "status")})
        if not two:
            self._dispatch(d, actor)
        return d

    def approve(self, directive_id: str, approver: str) -> dict[str, Any]:
        d = self.directives.get(directive_id)
        if d is None:
            raise KeyError(directive_id)
        if d["status"] != "pending_approval":
            raise ApprovalError(f"directive is {d['status']}, not awaiting approval")
        if approver == d["createdBy"]:
            self.audit.append(approver, "directive.approval_refused", {"id": directive_id, "reason": "self-approval"})
            raise ApprovalError("a different policy officer must approve this directive")
        d["approvedBy"] = approver
        self.audit.append(approver, "directive.approved", {"id": directive_id})
        self._dispatch(d, approver)
        return d

    def _dispatch(self, d: dict[str, Any], actor: str) -> None:
        self.audit.append(actor, "directive.dispatching", {"id": d["id"], "type": d["type"]})   # logged before send
        self.dispatch_hook(d)
        d["status"] = "dispatched"
        self.audit.append(actor, "directive.dispatched", {"id": d["id"]})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
