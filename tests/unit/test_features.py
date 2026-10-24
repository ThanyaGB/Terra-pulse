"""T0.4: flag defaults match spec section 3; externally facing flags need two admins; changes are audited."""
import re
from pathlib import Path

import pytest

from api.audit import AuditLog
from domain.features import ApprovalRequired, FeatureFlags, InvalidFlagValue, UnknownFlag

SPEC = Path(__file__).resolve().parents[2] / "vayu-swachh-spec.md"
EXTERNAL = ("PUBLIC_ALERTS_ENABLED", "TELEPHONY_ENABLED", "WHATSAPP_ENABLED")


def spec_defaults() -> dict[str, object]:
    """Read the flag table from spec section 3, so a spec change that is not mirrored in config fails here."""
    text = SPEC.read_text(encoding="utf8").split("### Feature flags", 1)[1].split("\n---", 1)[0]
    out: dict[str, object] = {}
    for name, default in re.findall(r"^\| `([A-Z_]+)` \| `([^`]+)` \|", text, re.M):
        out[name] = {"true": True, "false": False}.get(default, default)
    return out


def test_every_flag_defaults_to_the_spec_value():
    flags = FeatureFlags.load()
    expected = spec_defaults()
    assert set(expected) == {"TELEPHONY_ENABLED", "TTS_PROVIDER", "WHATSAPP_ENABLED", "PUBLIC_ALERTS_ENABLED", "ADVISORY_EXPORT_ENABLED", "CALIBRATION_MODE"}
    for name, want in expected.items():
        assert flags.value(name) == want, name


def test_hard_defaults_for_external_features():
    f = FeatureFlags.load()
    assert f.value("TELEPHONY_ENABLED") is False and f.value("WHATSAPP_ENABLED") is False and f.value("PUBLIC_ALERTS_ENABLED") is False
    assert f.value("TTS_PROVIDER") == "prerecorded"
    assert f.value("FORECAST_GNN_ENABLED") is False


@pytest.mark.parametrize("name", EXTERNAL)
def test_externally_facing_flag_needs_a_second_admin(name):
    audit = AuditLog()
    f = FeatureFlags.load(audit=audit.append)
    first = f.change(name, True, "admin-a")
    assert first.status == "pending_second_approval" and f.enabled(name) is False
    with pytest.raises(ApprovalRequired):
        f.change(name, True, "admin-a")        # the requester cannot confirm their own change
    done = f.change(name, True, "admin-b")
    assert done.status == "applied" and f.enabled(name) is True and done.approved_by == "admin-b"
    actions = [e.action for e in audit.entries()]
    assert actions == ["flag.change_requested", "flag.approval_refused", "flag.changed"] and audit.verify()


def test_internal_flag_changes_at_once_and_is_audited():
    audit = AuditLog()
    f = FeatureFlags.load(audit=audit.append)
    assert f.change("CALIBRATION_MODE", True, "admin-a").status == "applied"
    assert f.enabled("CALIBRATION_MODE") and audit.entries()[-1].action == "flag.changed"


def test_invalid_values_and_unknown_flags_are_refused():
    f = FeatureFlags.load()
    with pytest.raises(InvalidFlagValue):
        f.change("TTS_PROVIDER", "espeak", "admin-a")
    with pytest.raises(InvalidFlagValue):
        f.change("TELEPHONY_ENABLED", "yes", "admin-a")
    with pytest.raises(UnknownFlag):
        f.change("NOPE", True, "admin-a")


def test_overrides_survive_a_restart(tmp_path):
    p = tmp_path / "o.json"
    FeatureFlags.load(overrides_path=p).change("CALIBRATION_MODE", True, "admin-a")
    assert FeatureFlags.load(overrides_path=p).enabled("CALIBRATION_MODE")
