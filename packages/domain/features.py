"""Feature flags (T0.4, ADR-19). Defaults come from config/features.yaml and are read at runtime. Every change is audited
before it is applied. Externally facing flags need a second admin to confirm the same change (two-person approval)."""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .config import load_yaml

AuditFn = Callable[[str, str, dict[str, Any]], Any]


class FlagError(Exception):
    """Base class; `status` is the HTTP status the API maps it to."""
    status = 400


class UnknownFlag(FlagError):
    status = 404


class InvalidFlagValue(FlagError):
    status = 422


class ApprovalRequired(FlagError):
    status = 409


@dataclass(frozen=True)
class FlagChange:
    name: str
    value: Any
    status: str                 # applied | pending_second_approval
    requested_by: str
    approved_by: str | None = None


class FeatureFlags:
    def __init__(self, defs: dict[str, dict[str, Any]], audit: AuditFn | None = None, overrides_path: str | Path | None = None) -> None:
        self.defs = defs
        self.audit = audit or (lambda _a, _b, _c: None)
        self.overrides_path = Path(overrides_path) if overrides_path else None
        self._values: dict[str, Any] = {k: d["default"] for k, d in defs.items()}
        self.pending: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._load_overrides()

    @classmethod
    def load(cls, audit: AuditFn | None = None, overrides_path: str | Path | None = None, directory: Path | None = None) -> "FeatureFlags":
        return cls(load_yaml("features.yaml", directory)["flags"], audit, overrides_path)

    # ---- reads ----
    def value(self, name: str) -> Any:
        if name not in self._values:
            raise UnknownFlag(f"unknown flag {name!r}")
        return self._values[name]

    def enabled(self, name: str) -> bool:
        return self.value(name) is True

    def listing(self) -> list[dict[str, Any]]:
        return [{"name": n, "value": self._values[n], "default": d["default"], "externally_facing": bool(d.get("externally_facing")),
                 "options": d.get("options"), "description": d.get("description", ""),
                 "pending": self.pending.get(n)} for n, d in self.defs.items()]

    # ---- changes ----
    def _check(self, name: str, value: Any) -> None:
        d = self.defs.get(name)
        if d is None:
            raise UnknownFlag(f"unknown flag {name!r}")
        if "options" in d:
            if value not in d["options"]:
                raise InvalidFlagValue(f"{name} must be one of {d['options']}")
        elif not isinstance(value, bool):
            raise InvalidFlagValue(f"{name} must be true or false")

    def change(self, name: str, value: Any, actor: str) -> FlagChange:
        """Admin change. Externally facing flags stay pending until a different admin requests the same value."""
        self._check(name, value)
        with self._lock:
            if self._values[name] == value:
                return FlagChange(name, value, "applied", actor)
            if not self.defs[name].get("externally_facing"):
                self.audit(actor, "flag.changed", {"name": name, "from": self._values[name], "to": value})
                self._apply(name, value)
                return FlagChange(name, value, "applied", actor)
            pend = self.pending.get(name)
            if pend is None or pend["value"] != value:
                self.pending[name] = {"value": value, "requested_by": actor}
                self.audit(actor, "flag.change_requested", {"name": name, "to": value})
                return FlagChange(name, value, "pending_second_approval", actor)
            if pend["requested_by"] == actor:
                self.audit(actor, "flag.approval_refused", {"name": name, "reason": "self-approval"})
                raise ApprovalRequired(f"{name} needs a second admin to confirm; the requester cannot approve their own change")
            self.audit(actor, "flag.changed", {"name": name, "from": self._values[name], "to": value, "requested_by": pend["requested_by"], "approved_by": actor})
            self._apply(name, value)
            del self.pending[name]
            return FlagChange(name, value, "applied", pend["requested_by"], actor)

    def _apply(self, name: str, value: Any) -> None:
        self._values[name] = value
        if self.overrides_path is not None:
            self.overrides_path.parent.mkdir(parents=True, exist_ok=True)
            changed = {k: v for k, v in self._values.items() if v != self.defs[k]["default"]}
            self.overrides_path.write_text(json.dumps(changed, sort_keys=True), encoding="utf8")

    def _load_overrides(self) -> None:
        if self.overrides_path is None or not self.overrides_path.exists():
            return
        for k, v in json.loads(self.overrides_path.read_text(encoding="utf8")).items():
            if k in self.defs:
                self._check(k, v)
                self._values[k] = v
