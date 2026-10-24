"""Supervisor portal endpoints (ADR-15, T3.6): list, accept, complete. No MCD API is involved."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile

from api.pagination import paginate
from api.problem import ProblemError
from api.security import Principal, require_roles
from api.workorders import WorkOrderService

router = APIRouter()
MAX_PHOTO = 12 * 1024 * 1024


def svc(request: Request) -> WorkOrderService:
    return request.app.state.workorders  # type: ignore[no-any-return]


@router.get("/work-orders", summary="List work orders", tags=["work-orders"])
async def work_orders_list(request: Request, status: str | None = None, area: str | None = None, limit: int = 50, cursor: str | None = None,
                           _: Principal = Depends(require_roles("municipal_supervisor", "policy_officer"))) -> dict[str, Any]:
    if status is not None and status not in ("created", "accepted", "completed"):
        raise ProblemError(400, "Unknown status", "Use created, accepted or completed.")
    return paginate(svc(request).list(status, area), limit, cursor)


@router.post("/work-orders/{work_order_id}/accept", summary="Accept a work order", tags=["work-orders"])
async def work_orders_accept(request: Request, work_order_id: str, who: Principal = Depends(require_roles("municipal_supervisor"))) -> dict[str, Any]:
    return svc(request).accept(work_order_id, who.sub)


@router.post("/work-orders/{work_order_id}/complete", summary="Submit completion with photo and GPS", tags=["work-orders"])
async def work_orders_complete(request: Request, response: Response, work_order_id: str, photo: UploadFile = File(...), lat: float | None = Form(None),
                               lon: float | None = Form(None), client_request_id: str | None = Form(None),
                               who: Principal = Depends(require_roles("municipal_supervisor"))) -> dict[str, Any]:
    data = await photo.read()
    if len(data) > MAX_PHOTO:
        raise ProblemError(413, "Photo too large", "Maximum 12 MB.")
    view, duplicate = await svc(request).complete(work_order_id, who.sub, data, lat, lon, client_request_id)
    response.headers["X-Duplicate-Submission"] = "true" if duplicate else "false"
    return {**view, "duplicate": duplicate}
