"""Feature-flag admin (T0.4) and the public client config (flags a UI needs, disclaimers from config, attribution)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from api.problem import ProblemError
from api.security import ROLES, Principal, require_roles
from domain.disclaimers import all_disclaimers
from domain.features import FeatureFlags, FlagError

router = APIRouter()

PUBLIC_FLAGS = ("TELEPHONY_ENABLED", "WHATSAPP_ENABLED", "PUBLIC_ALERTS_ENABLED", "ADVISORY_EXPORT_ENABLED", "TTS_PROVIDER")


def features(request: Request) -> FeatureFlags:
    return request.app.state.features  # type: ignore[no-any-return]


class FlagUpdate(BaseModel):
    value: bool | str


@router.get("/admin/features", summary="Current feature flags", tags=["admin"])
async def features_list(request: Request, _: Principal = Depends(require_roles("admin"))) -> dict[str, Any]:
    return {"flags": features(request).listing()}


@router.put("/admin/features/{name}", summary="Change a flag (audited; two-person for externally facing flags)", tags=["admin"])
async def features_put(request: Request, name: str, body: FlagUpdate, who: Principal = Depends(require_roles("admin"))) -> dict[str, Any]:
    try:
        ch = features(request).change(name, body.value, who.sub)
    except FlagError as exc:
        raise ProblemError(exc.status, "Flag change refused", str(exc)) from exc
    return {"name": ch.name, "value": ch.value, "status": ch.status, "requested_by": ch.requested_by, "approved_by": ch.approved_by}


@router.get("/config/public", summary="Flags, disclaimers and attribution a client needs (extension)", tags=["config"])
async def public_config(request: Request, _: Principal = Depends(require_roles(*ROLES))) -> dict[str, Any]:
    f = features(request)
    return {"flags": {n: f.value(n) for n in PUBLIC_FLAGS}, "disclaimers": all_disclaimers()}
