# `make lint type test` is the T0.1 acceptance gate.
PY ?= python

.PHONY: install lint type test test-live web-test contracts contracts-check run-api run-web up down smoke e2e load fixtures

install:
	$(PY) -m pip install -e ".[dev]" || $(PY) -m pip install fastapi uvicorn pydantic pydantic-settings httpx pyyaml redis pillow python-multipart websockets rasterio pytest pytest-asyncio hypothesis ruff mypy types-PyYAML jsonschema
	cd apps/web && npm ci

lint:
	$(PY) -m ruff check services packages scripts tests db run_api.py
	cd apps/web && npx tsc --noEmit

type:
	$(PY) -m mypy services packages scripts run_api.py
	cd apps/web && npx tsc --noEmit

test:
	$(PY) -m pytest -m "not live"
	cd apps/web && npx vitest run

test-live:
	$(PY) -m pytest -m live

contracts:
	$(PY) scripts/export_contracts.py
	cd apps/web && npm run gen:api

contracts-check:
	$(PY) scripts/export_contracts.py --check

fixtures:
	$(PY) scripts/record_fixtures.py

run-api:
	$(PY) run_api.py

run-web:
	cd apps/web && npm run dev

up:
	docker compose up -d postgres redis minio

down:
	docker compose down

smoke:
	$(PY) scripts/smoke_infra.py

e2e:
	cd apps/web && npx playwright test

load:
	k6 run tests/load/rest.js
	k6 run tests/load/websocket.js
