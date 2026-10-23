"""Phone masking at the response boundary (ADR-06): `98721-XXXXX`. Applied to every JSON response by
MaskedJSONResponse. The only unmasked number is the assigned machinery operator on a confirmed (live) booking,
shown to the farmer and the FPO coordinator for that booking; handlers opt in with `clear(...)`."""
from __future__ import annotations

import json
import re
from typing import Any

from fastapi.responses import JSONResponse

PHONE_RE = re.compile(r"(?<!\d)(?:\+?91[-\s]?)?([6-9]\d{4})[-\s]?(\d{5})(?!\d)")
CLEAR_KEY = "__clear__"


def mask_phone(value: str) -> str:
    return PHONE_RE.sub(lambda m: f"{m.group(1)}-XXXXX", value)


def clear(value: str) -> dict[str, str]:
    """Mark a phone number as cleared for display. Only for the permitted booking case."""
    return {CLEAR_KEY: value}


def mask_payload(obj: Any) -> Any:
    if isinstance(obj, str):
        return mask_phone(obj)
    if isinstance(obj, dict):
        if set(obj) == {CLEAR_KEY}:
            return obj[CLEAR_KEY]
        return {k: mask_payload(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [mask_payload(v) for v in obj]
    return obj


class MaskedJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(mask_payload(content), ensure_ascii=False, separators=(",", ":"), default=str).encode("utf8")
