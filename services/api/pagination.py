"""limit/cursor pagination. The cursor is an opaque base64 offset."""
from __future__ import annotations

import base64
from typing import Any, Sequence

from api.problem import ProblemError

MAX_LIMIT = 200


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        n = int(base64.urlsafe_b64decode(cursor.encode()).decode())
        if n < 0:
            raise ValueError
        return n
    except (ValueError, UnicodeDecodeError) as exc:
        raise ProblemError(400, "Invalid cursor", "The cursor is not valid; restart from the first page.") from exc


def paginate(items: Sequence[Any], limit: int = 50, cursor: str | None = None) -> dict[str, Any]:
    limit = max(1, min(limit, MAX_LIMIT))
    start = decode_cursor(cursor)
    page = list(items[start:start + limit])
    nxt = start + limit
    return {"items": page, "limit": limit, "next_cursor": base64.urlsafe_b64encode(str(nxt).encode()).decode() if nxt < len(items) else None,
            "total": len(items)}
