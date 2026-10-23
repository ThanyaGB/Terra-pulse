"""RFC 9457 Problem Details errors."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

MEDIA_TYPE = "application/problem+json"


class ProblemError(Exception):
    def __init__(self, status: int, title: str, detail: str = "", type_: str = "about:blank", headers: dict[str, str] | None = None,
                 **extra: Any) -> None:
        super().__init__(f"{status} {title}: {detail}")
        self.status, self.title, self.detail, self.type_, self.headers, self.extra = status, title, detail, type_, headers or {}, extra


def problem_body(request: Request, status: int, title: str, detail: str, type_: str = "about:blank", **extra: Any) -> dict[str, Any]:
    return {"type": type_, "title": title, "status": status, "detail": detail, "instance": str(request.url.path),
            "trace_id": getattr(request.state, "trace_id", None), **extra}


def install(app: FastAPI) -> None:
    @app.exception_handler(ProblemError)
    async def _problem(request: Request, exc: ProblemError) -> JSONResponse:
        return JSONResponse(problem_body(request, exc.status, exc.title, exc.detail, exc.type_, **exc.extra),
                            status_code=exc.status, media_type=MEDIA_TYPE, headers=exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        titles = {404: "Not Found", 405: "Method Not Allowed"}
        return JSONResponse(problem_body(request, exc.status_code, titles.get(exc.status_code, "Error"), str(exc.detail)),
                            status_code=exc.status_code, media_type=MEDIA_TYPE)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        errs = [{"loc": [str(x) for x in e["loc"]], "msg": e["msg"]} for e in exc.errors()]
        return JSONResponse(problem_body(request, 422, "Validation failed", "One or more fields are invalid.", errors=errs),
                            status_code=422, media_type=MEDIA_TYPE)
