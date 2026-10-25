from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from agents.runtime import build_platform
from agents.world import World
from api.app import create_app
from api.security import issue_token
from api.settings import Settings
from ingestion.pipeline import build_snapshot

SETTINGS = Settings(env="dev", jwt_secret="test-secret-test-secret", data_mode="offline", photo_dir="var/test-photos", outbox_path=":memory:", feature_overrides_path=None,
                    redis_url=None)   # per-app in-memory call limits: CI's shared Redis would carry call caps across tests


@pytest.fixture(scope="session")
def snap():
    return build_snapshot(offline=True)


@pytest.fixture()
def client(snap):
    plat = build_platform(provider=lambda: snap, world=World(today=date(2026, 10, 23)))
    app = create_app(SETTINGS, plat, background=False)
    with TestClient(app) as c:
        c.post("/v1/auth/dev-token", json={"role": "citizen"})  # smoke
        import asyncio
        asyncio.run(plat.run_cycle("W1"))
        c.platform = plat  # type: ignore[attr-defined]
        c.app.state.telephony.clock = lambda: datetime(2026, 10, 23, 6, 30, tzinfo=timezone.utc)   # 12:00 IST, inside calling hours
        yield c


ACTIVE_CONTRACT = {"contract_id": "PC-TEST", "partner": "test partner", "area_id": "sangrur", "status": "active", "valid_from": None, "valid_to": None,
                   "rates": {"straw_floor_inr_per_tonne": 1650, "super_seeder_rental_inr_per_acre": 750}}


@pytest.fixture()
def calls_on(client):
    """Turn TELEPHONY_ENABLED on the way an operator must: two different admins."""
    f = client.app.state.features
    f.change("TELEPHONY_ENABLED", True, "admin-a")
    f.change("TELEPHONY_ENABLED", True, "admin-b")
    assert f.enabled("TELEPHONY_ENABLED")


@pytest.fixture()
def contract_active(client):
    client.platform.world.contracts = [ACTIVE_CONTRACT]


def token(role: str, sub: str | None = None) -> dict[str, str]:
    return {"Authorization": "Bearer " + issue_token(SETTINGS.jwt_secret, sub or f"{role}-1", role)}


@pytest.fixture()
def H():
    return token
