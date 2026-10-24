"""ADR-07 / ADR-14 / T3.4 / T4.6: two-person approval, audit before export, signed PDF, no transmission to any traffic system."""
import ast
import re
import socket
from pathlib import Path

import pytest
from pypdf import PdfReader

import api.advisory_pdf as advisory_pdf

ROOT = Path(__file__).resolve().parents[2]


def _diversion(client, H, creator="officer.a"):
    r = client.post("/v1/directives", json={"type": "diversion_trucks", "area_ids": ["singhu", "kmp"]}, headers=H("policy_officer", creator))
    assert r.status_code == 201
    return r.json()


def test_traffic_export_is_refused_before_approval(client, H):
    d = _diversion(client, H)
    r = client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a"))
    assert r.status_code == 409 and r.headers["content-type"].startswith("application/problem+json") and "after approval" in r.json()["detail"]
    assert any(e.action == "directive.export_refused" for e in client.platform.audit.entries())
    assert not any(e.action == "directive.exported" for e in client.platform.audit.entries())


def test_self_approval_is_refused_and_audited(client, H):
    d = _diversion(client, H)
    r = client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.a"))
    assert r.status_code == 409 and client.platform.directives.directives[d["id"]]["status"] == "pending_approval"
    assert any(e.action == "directive.approval_refused" and e.payload["reason"] == "self-approval" for e in client.platform.audit.entries())
    assert client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a")).status_code == 409


def test_approved_directive_exports_a_signed_pdf_with_both_approvers_and_disclaimer(client, H):
    d = _diversion(client, H)
    assert client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.b")).status_code == 200
    r = client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a"))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF-")
    text = PdfReader(__import__("io").BytesIO(r.content)).pages[0].extract_text()
    for needle in (d["id"], "Singhu", "officer.a", "officer.b", "diverted away from Delhi", "recommendation to the responsible authorities"):
        assert needle in text, needle
    signer = client.platform.directives.signer
    assert advisory_pdf.verify_pdf(r.content, signer.public_bytes)
    tampered = r.content.replace(b"officer.b", b"officer.z", 1)
    assert not advisory_pdf.verify_pdf(tampered, signer.public_bytes)             # edited page text no longer matches the signed payload
    payload = advisory_pdf.read_signed_payload(r.content)[0]
    assert payload["created_by"] == "officer.a" and payload["approved_by"] == "officer.b"


def test_signature_does_not_verify_with_another_key(client, H):
    from api.signing import Signer
    d = _diversion(client, H)
    client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.b"))
    pdf = client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a")).content
    assert not advisory_pdf.verify_pdf(pdf, Signer().public_bytes)


def test_audit_entry_is_written_before_the_file_is_returned_and_before_any_export(client, H):
    d = _diversion(client, H)
    client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.b"))
    pdf = client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a")).content
    log = client.platform.audit.entries()
    idx = {a: next(i for i, e in enumerate(log) if e.action == a and e.payload.get("id") == d["id"]) for a in ("directive.created", "directive.approved", "directive.exported")}
    assert idx["directive.created"] < idx["directive.approved"] < idx["directive.exported"]
    import hashlib
    assert log[idx["directive.exported"]].payload["sha256"] == hashlib.sha256(pdf).hexdigest() and client.platform.audit.verify()


def test_export_is_refused_when_advisory_export_is_off(client, H):
    d = _diversion(client, H)
    client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.b"))
    client.app.state.features.change("ADVISORY_EXPORT_ENABLED", False, "admin-a")
    r = client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a"))
    assert r.status_code == 503 and "ADVISORY_EXPORT_ENABLED" in r.json()["detail"]
    client.app.state.features.change("ADVISORY_EXPORT_ENABLED", True, "admin-a")
    assert client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a")).status_code == 200


def test_export_is_policy_officer_only_and_unknown_directive_is_404(client, H):
    assert client.get("/v1/directives/DIR-NOPE/export", headers=H("policy_officer")).status_code == 404
    for role in ("fpo_coordinator", "citizen", "admin", "municipal_supervisor"):
        assert client.get("/v1/directives/DIR-NOPE/export", headers=H(role)).status_code == 403


def test_export_makes_no_network_call(client, H, monkeypatch):
    d = _diversion(client, H)
    client.post(f"/v1/directives/{d['id']}/approve", headers=H("policy_officer", "officer.b"))

    def no_net(*a, **k):
        raise AssertionError("network used during export")

    monkeypatch.setattr(socket.socket, "connect", no_net)
    monkeypatch.setattr(socket, "create_connection", no_net)
    assert client.get(f"/v1/directives/{d['id']}/export", headers=H("policy_officer", "officer.a")).status_code == 200


def test_no_network_call_to_a_traffic_system_exists_in_the_codebase():
    """Static check (ADR-14): no traffic-authority sender, and the directive/export modules import no HTTP or socket client."""
    banned_imports = {"httpx", "requests", "urllib", "urllib3", "aiohttp", "socket", "smtplib", "http", "ftplib", "websockets"}
    for name in ("directives.py", "advisory_pdf.py", "signing.py"):
        tree = ast.parse((ROOT / "services/api" / name).read_text(encoding="utf8"))
        mods = {n.names[0].name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import)} | \
               {(n.module or "").split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
        assert not (mods & banned_imports), (name, mods & banned_imports)
    assert not (ROOT / "services/integrations/traffic").exists()
    pat = re.compile(r"TrafficAuthority|send_directive|traffic[-_ ]?(police|authority)?[-_ ]?(api|endpoint|webhook|url)", re.I)
    offenders = [str(p.relative_to(ROOT)) for p in list((ROOT / "services").rglob("*.py")) + list((ROOT / "packages").rglob("*.py")) if pat.search(p.read_text(encoding="utf8"))]
    assert offenders == [], offenders
    for hit in ("dispatch_hook", "_dispatch("):
        assert hit not in (ROOT / "services/api/directives.py").read_text(encoding="utf8")
    _ = pytest
