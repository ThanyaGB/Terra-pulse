from datetime import date

import pytest
from fastapi.testclient import TestClient

from agents.runtime import build_platform
from agents.world import World
from api.app import create_app
from api.security import issue_token
from api.settings import Settings
from ingestion.pipeline import build_snapshot

SETTINGS = Settings(env="dev", jwt_secret="test-secret-test-secret", data_mode="offline", photo_dir="var/test-photos", outbox_path=":memory:")


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
        yield c


def token(role: str, sub: str | None = None) -> dict[str, str]:
    return {"Authorization": "Bearer " + issue_token(SETTINGS.jwt_secret, sub or f"{role}-1", role)}


@pytest.fixture()
def H():
    return token
