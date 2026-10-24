"""Authentication (HS256 JWT) and RBAC (spec section 2, 10). Every endpoint declares its role set via `require_roles`."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Callable

from fastapi import Depends, Request

from api.problem import ProblemError

ROLES = ("policy_officer", "fpo_coordinator", "farmer", "citizen", "municipal_supervisor", "admin")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue_token(secret: str, sub: str, role: str, ttl_s: int = 8 * 3600, now: float | None = None) -> str:
    if role not in ROLES:
        raise ValueError(f"unknown role {role!r}")
    iat = int(now if now is not None else time.time())
    head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64(json.dumps({"sub": sub, "role": role, "iat": iat, "exp": iat + ttl_s}).encode())
    sig = _b64(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


def decode_token(secret: str, token: str, now: float | None = None) -> dict[str, Any]:
    try:
        head, body, sig = token.split(".")
        expect = _b64(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            raise ValueError("bad signature")
        claims: dict[str, Any] = json.loads(_unb64(body))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ProblemError(401, "Invalid token", "The bearer token is malformed or its signature does not match.") from exc
    if claims.get("exp", 0) < (now if now is not None else time.time()):
        raise ProblemError(401, "Token expired", "Request a new token.")
    if claims.get("role") not in ROLES:
        raise ProblemError(401, "Invalid token", "Unknown role claim.")
    return claims


class Principal(dict):  # type: ignore[type-arg]
    @property
    def sub(self) -> str:
        return str(self["sub"])

    @property
    def role(self) -> str:
        return str(self["role"])


def current_principal(request: Request) -> Principal:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise ProblemError(401, "Authentication required", "Send an 'Authorization: Bearer <token>' header.")
    return Principal(decode_token(request.app.state.settings.jwt_secret, auth[7:]))


def require_roles(*roles: str) -> Callable[[Principal], Principal]:
    """Declare the role set of an endpoint. 403 for any other authenticated role."""
    def dep(p: Principal = Depends(current_principal)) -> Principal:
        if p.role not in roles:
            raise ProblemError(403, "Forbidden", f"Role '{p.role}' cannot use this endpoint (allowed: {', '.join(roles)}).")
        return p
    dep.__roles__ = roles  # type: ignore[attr-defined]
    return dep
