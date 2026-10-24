"""Directives (ADR-07, ADR-14, T3.4). A directive is a recommendation record. Diversions need a second policy officer (the creator
cannot approve). The platform transmits nothing: an approved directive can be exported as a signed PDF for an officer to send
through official channels, and the export is written to the audit log before the file leaves the service."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any

from api import advisory_pdf
from api.audit import AuditLog
from api.signing import Signer
from domain.disclaimers import disclaimer
from domain.grap import requires_two_person

PREVIEWS: dict[str, dict[str, Any]] = {
    "grap_ii": {
        "title": "Issue GRAP-II alert",
        "action": "Recommend a Stage-II GRAP alert to the NCR enforcement agencies.",
        "affectedAreas": [
            {"id": "delhi", "name": "Delhi (all 11 districts)", "detail": "Dust control, parking fees, DG-set curbs"},
            {"id": "gurugram", "name": "Gurugram", "detail": "Construction dust enforcement"},
            {"id": "faridabad", "name": "Faridabad", "detail": "Industrial emission checks"},
            {"id": "ghaziabad", "name": "Ghaziabad", "detail": "Road sweeping and water sprinkling"},
            {"id": "noida", "name": "Noida / Greater Noida", "detail": "Construction dust enforcement"},
        ],
        "note": "This records the recommendation. The platform sends nothing: a policy officer exports the signed PDF and sends it through official channels.",
    },
    "diversion_trucks": {
        "title": "Issue diversion order for out-of-state diesel trucks",
        "action": "Recommend that non-essential out-of-state diesel trucks be diverted away from Delhi to the peripheral expressways.",
        "affectedAreas": [
            {"id": "singhu", "name": "Singhu / Kundli border", "detail": "NH-44, northbound entry"},
            {"id": "tikri", "name": "Tikri border", "detail": "NH-9, westbound entry"},
            {"id": "ghazipur", "name": "Ghazipur border", "detail": "NH-24, eastern entry"},
            {"id": "kmp", "name": "KMP / Eastern Peripheral Expressway", "detail": "Designated diversion route"},
        ],
        "note": "Requires a second policy officer's approval before it can be exported. The platform does not send it to anyone: you send the signed PDF through official channels.",
    },
    "fog_cannons": {
        "title": "Deploy fog cannons on heavy-pollution corridors",
        "action": "Recommend deploying available anti-smog fog cannons to the corridors forecast to peak within 12 hours.",
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


class ExportError(Exception):
    """Export refused: not approved, or the export feature is off."""


class DirectiveService:
    def __init__(self, audit: AuditLog, signer: Signer | None = None) -> None:
        self.audit = audit
        self.signer = signer or Signer()
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
                             "status": "pending_approval" if two else "approved", "approvedBy": None, "approvedAt": None, "requiresSecondApprover": two}
        self.directives[did] = d
        self.audit.append(actor, "directive.created", {k: d[k] for k in ("id", "type", "areaIds", "status")})
        if not two:
            d["approvedAt"] = d["issuedAt"]
            self.audit.append(actor, "directive.approved", {"id": did, "approver": None, "reason": "single-approval type"})
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
        d["approvedBy"], d["approvedAt"], d["status"] = approver, _now(), "approved"
        self.audit.append(approver, "directive.approved", {"id": directive_id, "approver": approver, "creator": d["createdBy"]})
        return d

    def export(self, directive_id: str, actor: str, enabled: bool) -> bytes:
        """Signed PDF of an approved directive. Refused when export is switched off or the directive is not approved."""
        d = self.directives.get(directive_id)
        if d is None:
            raise KeyError(directive_id)
        if not enabled:
            self.audit.append(actor, "directive.export_refused", {"id": directive_id, "reason": "ADVISORY_EXPORT_ENABLED is off"})
            raise ExportError("advisory export is switched off (feature flag ADVISORY_EXPORT_ENABLED)")
        if d["status"] != "approved":
            self.audit.append(actor, "directive.export_refused", {"id": directive_id, "reason": f"status {d['status']}"})
            raise ExportError(f"directive is {d['status']}; it can be exported only after approval")
        payload = {"directive_id": d["id"], "type": d["type"], "areas": [a["name"] for a in PREVIEWS[d["type"]]["affectedAreas"] if a["id"] in d["areaIds"]] or d["areaIds"],
                   "action": PREVIEWS[d["type"]]["action"], "issued_at": d["issuedAt"], "created_by": d["createdBy"], "approved_by": d["approvedBy"],
                   "approved_at": d["approvedAt"], "disclaimer": disclaimer("directive", "en")}
        pdf = advisory_pdf.build_pdf(payload, self.signer)
        self.audit.append(actor, "directive.exported", {"id": directive_id, "sha256": hashlib.sha256(pdf).hexdigest(), "key_id": self.signer.key_id})   # logged before the bytes leave
        return pdf


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
