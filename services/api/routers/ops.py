"""Farmer, FPO, citizen-report and directive endpoints (T3.3-T3.5), plus auth and webhooks."""
from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import BaseModel, Field

from api.directives import PREVIEWS, ApprovalError, ExportError
from api.images import sanitise_photo
from api.pagination import paginate
from api.problem import ProblemError
from api.security import Principal, issue_token, require_roles
from api.services import Ops, now_iso
from domain import risk as risk_domain
from ingestion.geo import VILLAGES

VNAME = {v.id: v.name for v in VILLAGES}

router = APIRouter()


def ops(request: Request) -> Ops:
    return request.app.state.ops  # type: ignore[no-any-return]


# ---------- models ----------
class TriggerCall(BaseModel):
    parcel_id: str
    lang: Literal["pa", "hi", "en"] = "pa"


class BookingCreate(BaseModel):
    machinery_id: str | None = Field(None, examples=["SS-08"])
    machine_type: Literal["super_seeder", "baler", "happy_seeder"] | None = Field(None, description="Overrides the parcel's usual machine need")
    parcel_id: str = Field(..., examples=["PCL-SGR-0412"])


class CollectionCreate(BaseModel):
    parcel_id: str


class Keypress(BaseModel):
    parcel_id: str
    key: Literal["0", "1", "2", "9"]                 # menu: 1, 2, 9; then 1 confirms and 0 goes back
    lang: Literal["pa", "hi", "en"] = "pa"


class DirectiveCreate(BaseModel):
    type: Literal["grap_ii", "diversion_trucks", "fog_cannons"]
    area_ids: list[str] = []


class DevToken(BaseModel):
    role: Literal["policy_officer", "fpo_coordinator", "farmer", "citizen", "municipal_supervisor", "admin"]
    sub: str | None = None


# ---------- auth (development only) ----------
@router.post("/auth/dev-token", summary="Issue a development token (disabled outside dev)", tags=["auth"])
def dev_token(request: Request, body: DevToken) -> dict[str, Any]:
    s = request.app.state.settings
    if s.env != "dev":
        raise ProblemError(404, "Not Found", "This endpoint exists only in the dev environment.")
    sub = body.sub or f"{body.role}-demo"
    return {"access_token": issue_token(s.jwt_secret, sub, body.role, s.token_ttl_s), "token_type": "bearer", "role": body.role, "sub": sub}


# ---------- FPO ----------
@router.get("/risk/parcels", summary="At-risk parcel list", tags=["fpo"])
async def risk_parcels(request: Request, village: str | None = None, tier: str | None = None, limit: int = 50, cursor: str | None = None,
                       _: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    o = ops(request)
    w = o.p.world
    if tier and tier not in risk_domain.TIERS:
        raise ProblemError(400, "Unknown tier", f"Use one of: {', '.join(risk_domain.TIERS)}.")
    rows = []
    for pid, r in w.risk.items():
        p = w.parcels[pid]
        if village and p.village_id != village:
            continue
        if tier and r["tier"] != tier:
            continue
        calls = o.by_parcel.get(pid, [])
        rows.append({"parcel_id": pid, "village": VNAME[p.village_id], "farmer_name": p.farmer_name, "farmer_phone": p.phone, "village_id": p.village_id, "acres": p.acres,
                     "harvest_date": p.harvest_start.isoformat(), "score": r["score"], "tier": r["tier"], "machine_need": p.machine_need,
                     "status": o.parcel_status(pid), "last_contact_at": o.calls[calls[-1]]["started_at"] if calls else None})
    rows.sort(key=lambda x: -x["score"])
    return {**paginate(rows, limit, cursor), "villages": [v.name for v in VILLAGES]}


@router.post("/calls/trigger", status_code=202, summary="Trigger a voice call", tags=["fpo"])
async def calls_trigger(request: Request, body: TriggerCall, who: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    return ops(request).trigger_call(body.parcel_id, who.sub, body.lang)


@router.get("/calls/{call_id}/log", summary="Transcript and intent summary (phone masked)", tags=["fpo"])
async def calls_log(request: Request, call_id: str, _: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    return ops(request).call_log(call_id)


@router.get("/calls", summary="Calls for a parcel with matched machine (extension)", tags=["fpo"])
async def calls_for_parcel(request: Request, parcel_id: str, _: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    o = ops(request)
    pr = o.parcel(parcel_id)
    calls = [o.calls[c] for c in o.by_parcel.get(parcel_id, [])]
    bookings = [b for b in o.p.world.bookings.values() if b["parcel_id"] == parcel_id]
    from agents.advisory_agent import match_machine
    hit = match_machine(o.p.world, pr.machine_need, pr.lat, pr.lon)
    matched = None
    if hit:
        m, d = hit
        matched = {"machine_type": m.type, "machine_id": m.id, "operator_name": m.operator_name, "operator_phone": m.operator_phone,
                   "distance_km": round(d, 1), "base": pr.village_id}
    return {"parcel_id": parcel_id, "calls": calls, "bookings": [o.booking_view(b, "fpo_coordinator") for b in bookings], "matched_machine": matched,
            "risk": o.p.world.risk.get(parcel_id)}


@router.post("/fpo/assign", summary="Assign a machine on-site (extension)", tags=["fpo"])
async def fpo_assign(request: Request, body: BookingCreate, who: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    o = ops(request)
    pr = o.parcel(body.parcel_id)
    booking = await o.create_booking(body.parcel_id, body.machinery_id, who.sub, body.machine_type)
    b = o.p.world.bookings[booking["booking_id"]]
    b["status"] = "dispatched"
    o.audit(who.sub, "booking.dispatched", {"booking_id": b["booking_id"], "parcel_id": pr.id})
    return {**o.booking_view(b, "fpo_coordinator"), "eta_minutes": round(25 + (pr.acres % 20))}


# ---------- bookings / collections ----------
@router.post("/bookings", status_code=201, summary="Create a machinery booking", tags=["bookings"])
async def bookings_create(request: Request, body: BookingCreate, who: Principal = Depends(require_roles("farmer", "fpo_coordinator"))) -> dict[str, Any]:
    return await ops(request).create_booking(body.parcel_id, body.machinery_id, who.sub, body.machine_type)


@router.post("/bookings/{booking_id}/confirm", summary="Keypad confirmation (DTMF 1)", tags=["bookings"])
async def bookings_confirm(request: Request, booking_id: str, who: Principal = Depends(require_roles("farmer"))) -> dict[str, Any]:
    return ops(request).confirm_booking(booking_id, who.sub)


@router.post("/collections/request", status_code=201, summary="Off-field straw collection at floor price", tags=["bookings"])
async def collections_request(request: Request, body: CollectionCreate, who: Principal = Depends(require_roles("farmer", "fpo_coordinator"))) -> dict[str, Any]:
    return ops(request).request_collection(body.parcel_id, who.sub)


@router.get("/calls/session", summary="Call script for the farmer simulator (extension)", tags=["farmer"])
async def call_session(request: Request, lang: Literal["pa", "hi", "en"] = "pa", parcel_id: str | None = None,
                       _: Principal = Depends(require_roles("farmer"))) -> dict[str, Any]:
    from agents.advisory_agent import contract_rates, render_script
    o = ops(request)
    pid = parcel_id or next(iter(o.p.world.parcels))
    pr = o.parcel(pid)
    o.reset_keypad(pid)                              # every call starts at the menu
    days = max(1, (pr.harvest_start - o.p.world.today).days)
    rates = contract_rates(o.p.world)
    lines = [o.disclosure(lang), *render_script(lang, pr.farmer_name.split()[0], days, rates=rates)]
    audio = [{"line": i, "key": r.key, "source": r.source, "url": f"/v1/audio/{r.key}.wav?lang={lang}" if r.audio is not None else None}
             for i, r in enumerate(o.audio.audio_for(t, lang) for t in lines)] if o.audio else []
    return {"session_id": f"SES-{secrets.token_hex(3).upper()}", "parcel_id": pid, "caller_name": "Sangrur Machinery Cooperative", "caller_id": "01672-XXXXXX",
            "farmer_first_name": pr.farmer_name.split()[0], "lang": lang, "audio_url": None, "lines": lines, "audio": audio,
            "tts_provider": request.app.state.features.value("TTS_PROVIDER"),
            "prices": {"super_seeder_per_acre": int(rates["seeder_rate"].value) if "seeder_rate" in rates else None,
                       "straw_per_tonne": int(rates["straw_price"].value) if "straw_price" in rates else None}}


@router.get("/audio/{key}.wav", summary="Call audio clip by script hash (extension)", tags=["farmer"], response_class=Response)
async def audio_clip(request: Request, key: str, lang: Literal["pa", "hi", "en"] = "pa", _: Principal = Depends(require_roles("farmer", "fpo_coordinator"))) -> Response:
    o = ops(request)
    path = (o.audio.library.root / lang / f"{key}.wav") if o.audio else None
    if path is None or not key.isalnum() or not path.exists():
        raise ProblemError(404, "Clip not found", "No recorded clip for this script. Subtitles only until the library is recorded.")
    return Response(path.read_bytes(), media_type="audio/wav")


@router.post("/calls/keypress", summary="Keypad press from the simulator or IVR: 1/2/9, then 1 to confirm or 0 to go back (extension)", tags=["farmer"])
async def calls_keypress(request: Request, body: Keypress, who: Principal = Depends(require_roles("farmer"))) -> dict[str, Any]:
    return await ops(request).handle_key(body.parcel_id, body.key, actor=who.sub, lang=body.lang)


@router.post("/calls/webhook/{provider}", summary="Signed provider webhook: call status and DTMF", tags=["webhooks"])
async def calls_webhook(request: Request, provider: str, signature: str = "") -> dict[str, Any]:
    o = ops(request)
    form = {k: str(v) for k, v in (await request.form()).items()}
    sig = request.headers.get("x-signature", signature)
    if provider not in o.tel.providers:
        raise ProblemError(404, "Unknown provider", provider)
    try:
        rec = o.tel.handle_webhook(provider, str(request.url.replace(query="")), form, sig)
    except PermissionError as exc:
        raise ProblemError(401, "Invalid signature", "The webhook signature did not verify.") from exc
    except (KeyError, ValueError) as exc:
        raise ProblemError(400, "Bad webhook", str(exc)) from exc
    result = None
    if form.get("Digits"):
        result = await o.handle_key(rec.parcel_id, form["Digits"], via_call=rec.call_id)
        call = o.calls.get(rec.call_id)
        rec.intent = call["intent"] if call is not None else rec.intent
    return {"call_id": rec.call_id, "status": rec.status, "intent": rec.intent, "result": result}


# ---------- citizen reports ----------
@router.post("/reports/photo", status_code=201, summary="Citizen photo report (EXIF stripped, GPS coarsened)", tags=["citizen"])
async def reports_photo(request: Request, photo: UploadFile = File(...), category: Literal["open_burning", "construction", "road_dust"] = Form(...),
                        lat: float | None = Form(None), lon: float | None = Form(None), area_id: str = Form("anand-vihar"),
                        _: Principal = Depends(require_roles("citizen"))) -> dict[str, Any]:
    data = await photo.read()
    if len(data) > 12 * 1024 * 1024:
        raise ProblemError(413, "Photo too large", "Maximum 12 MB.")
    try:
        clean, grid = sanitise_photo(data, lat, lon)
    except Exception as exc:  # noqa: BLE001 - unreadable image
        raise ProblemError(422, "Unreadable image", "Upload a JPEG or PNG photo.") from exc
    ref = f"VS-R-{secrets.token_hex(3).upper()}"
    folder = Path(request.app.state.settings.photo_dir)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{ref}.jpg").write_bytes(clean)
    request.app.state.reports[ref] = {"reference_id": ref, "category": category, "grid_ref": grid, "area_id": area_id, "received_at": now_iso(), "status": "received"}
    ops(request).audit("citizen", "report.received", {"reference_id": ref, "category": category, "grid_ref": grid})
    return {"reference_id": ref, "received_at": request.app.state.reports[ref]["received_at"], "grid_ref": grid}


@router.get("/reports/{reference_id}", summary="Retrieve a report by reference", tags=["citizen"])
async def reports_get(request: Request, reference_id: str, _: Principal = Depends(require_roles("citizen", "policy_officer"))) -> dict[str, Any]:
    r = request.app.state.reports.get(reference_id)
    if r is None:
        raise ProblemError(404, "Report not found", reference_id)
    return {**r, "photo_url": f"/v1/reports/{reference_id}/photo"}


# ---------- directives ----------
@router.get("/directives/preview", summary="Confirmation preview (extension)", tags=["directives"])
async def directive_preview(request: Request, type: str, _: Principal = Depends(require_roles("policy_officer"))) -> dict[str, Any]:
    if type not in PREVIEWS:
        raise ProblemError(400, "Unknown directive type", f"Use one of: {', '.join(PREVIEWS)}.")
    return request.app.state.platform.directives.preview(type)  # type: ignore[no-any-return]


@router.post("/directives", status_code=201, summary="Issue a directive (two-person approval for diversions)", tags=["directives"])
async def directives_create(request: Request, body: DirectiveCreate, who: Principal = Depends(require_roles("policy_officer"))) -> dict[str, Any]:
    return request.app.state.platform.directives.create(body.type, body.area_ids, who.sub)  # type: ignore[no-any-return]


@router.get("/directives", summary="List directives (extension)", tags=["directives"])
async def directives_list(request: Request, limit: int = 50, cursor: str | None = None,
                          _: Principal = Depends(require_roles("policy_officer", "admin"))) -> dict[str, Any]:
    return paginate(sorted(request.app.state.platform.directives.directives.values(), key=lambda d: d["issuedAt"], reverse=True), limit, cursor)


@router.post("/directives/{directive_id}/approve", summary="Second approver", tags=["directives"])
async def directives_approve(request: Request, directive_id: str, who: Principal = Depends(require_roles("policy_officer"))) -> dict[str, Any]:
    try:
        return request.app.state.platform.directives.approve(directive_id, who.sub)  # type: ignore[no-any-return]
    except KeyError as exc:
        raise ProblemError(404, "Directive not found", directive_id) from exc
    except ApprovalError as exc:
        raise ProblemError(409, "Cannot approve", str(exc)) from exc


@router.get("/directives/{directive_id}/export", summary="Signed PDF of an approved directive", tags=["directives"], response_class=Response)
async def directives_export(request: Request, directive_id: str, who: Principal = Depends(require_roles("policy_officer"))) -> Response:
    try:
        pdf = request.app.state.platform.directives.export(directive_id, who.sub, request.app.state.features.enabled("ADVISORY_EXPORT_ENABLED"))
    except KeyError as exc:
        raise ProblemError(404, "Directive not found", directive_id) from exc
    except ExportError as exc:
        raise ProblemError(409 if "approval" in str(exc) else 503, "Export refused", str(exc)) from exc
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="advisory-{directive_id}.pdf"'})


@router.get("/audit/verify", summary="Verify the audit hash chain (extension)", tags=["admin"])
async def audit_verify(request: Request, _: Principal = Depends(require_roles("admin"))) -> dict[str, Any]:
    a = request.app.state.platform.audit
    return {"entries": len(a.entries()), "valid": a.verify()}


@router.get("/collections/summary", summary="Biomass purchase summary (extension)", tags=["bookings"])
async def collections_summary(request: Request, _: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    import math
    p = ops(request).p
    cols = list(p.world.collections.values())
    ledger = p.advisory.partner.ledger
    received = round(sum(e.tonnes for e in ledger), 1)
    requested = round(sum(c["estimated_tonnes"] for c in cols), 1)
    acres = round(sum(p.world.parcels[c["parcel_id"]].acres for c in cols))
    from agents.advisory_agent import contract_rates
    floor = contract_rates(p.world, p.advisory.cfg).get("straw_price")
    return {"plant": "Bio-CNG plant, Sangrur", "floor_price_inr_per_tonne": int(floor.value) if floor else None, "rate_source": floor.source if floor else None,
            "tonnes_received": received, "tonnes_requested": requested, "cumulative_acres": acres,
            "trucks_today": math.ceil(requested / 8) if requested else 0, "reconciliation_items": len(p.advisory.partner.reconciliation)}


class Receipt(BaseModel):
    tonnes: float = Field(..., gt=0)


@router.post("/collections/{request_id}/receipt", summary="Weighbridge receipt (webhook from the partner)", tags=["bookings"])
async def collections_receipt(request: Request, request_id: str, body: Receipt, who: Principal = Depends(require_roles("fpo_coordinator"))) -> dict[str, Any]:
    from dataclasses import asdict
    o = ops(request)
    res = o.p.advisory.partner.weighbridge_receipt(request_id, body.tonnes)
    kind = "reconciled" if hasattr(res, "amount_inr") else "needs_reconciliation"
    o.audit(who.sub, "collection.receipt", {"request_id": request_id, "tonnes": body.tonnes, "result": kind})
    if request_id in o.p.world.collections:
        o.p.world.collections[request_id]["status"] = kind
    return {"result": kind, **asdict(res)}
