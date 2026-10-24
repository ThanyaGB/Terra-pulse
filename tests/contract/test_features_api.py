"""T0.4 through the API: admin-only, two-person for externally facing flags, audited."""
from conftest import SETTINGS

from api.security import issue_token


def test_admin_endpoint_two_person_flow_and_audit(client, H):
    def put(role, sub, value=True):
        h = {"Authorization": "Bearer " + issue_token(SETTINGS.jwt_secret, sub, role)}
        return client.put("/v1/admin/features/PUBLIC_ALERTS_ENABLED", json={"value": value}, headers=h)

    assert client.get("/v1/admin/features", headers=H("policy_officer")).status_code == 403
    assert client.put("/v1/admin/features/PUBLIC_ALERTS_ENABLED", json={"value": True}, headers=H("fpo_coordinator")).status_code == 403
    assert put("admin", "admin-a").json()["status"] == "pending_second_approval"
    assert put("admin", "admin-a").status_code == 409
    assert put("admin", "admin-b").json()["status"] == "applied"
    listed = {f["name"]: f["value"] for f in client.get("/v1/admin/features", headers=H("admin")).json()["flags"]}
    assert listed["PUBLIC_ALERTS_ENABLED"] is True
    actions = [e.action for e in client.app.state.platform.audit.entries()]
    assert "flag.change_requested" in actions and "flag.changed" in actions
    assert client.get("/v1/config/public", headers=H("citizen")).json()["flags"]["PUBLIC_ALERTS_ENABLED"] is True
