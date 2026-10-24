# Vayu-Swachh

Closed-loop air-quality action platform for northern India: **fire risk -> street-level forecast -> source attribution -> health advice -> municipal response -> farmer alternatives**. Pilot: Sangrur (Punjab) upstream, Anand Vihar and Patparganj (East Delhi) downstream.

Built to [`vayu-swachh-spec.md`](vayu-swachh-spec.md). Four interfaces: `/policy` (CAQM), `/fpo`, `/farmer` (voice-call simulator, Punjabi/Hindi/English), `/citizen` (PWA).

## Run it

Python 3.11+ (spec targets 3.12) and Node 22.

```bash
pip install -e ".[dev]" rasterio      # or: make install
cp .env.example .env
python run_api.py                     # API on http://localhost:8010 (first ingestion cycle takes ~10-20 s)
cd apps/web && npm ci && npm run dev  # web on http://localhost:5173 (set VITE_API_MODE=live in apps/web/.env.local)
```

With `VITE_API_MODE=mock` the web app runs with no backend (ADR-11). With the API running in `VAYU_ENV=dev`, the web app signs in with development role tokens; production uses a real identity provider.

Local infrastructure (optional, for the SQL migrations): `docker compose up -d postgres redis minio && python scripts/smoke_infra.py`.

## What runs on real data

| Signal | Source |
| --- | --- |
| Fire hotspots, village clusters | NASA FIRMS VIIRS 375 m (public CSV, 15 min poll) |
| PM2.5/PM10/NO2/SO2/CO/dust, 72 h forecast | Copernicus CAMS via Open-Meteo |
| Winds, boundary layer, soil moisture | NWP via Open-Meteo |
| NDVI and its decay slope | Sentinel-2 L2A (Earth Search STAC, AWS COGs) |

Farmers, parcels, phone numbers and the machinery CRM are private data and are **simulated**; source attribution is a transparent proxy model, not a receptor model. See [`docs/open-questions.md`](docs/open-questions.md) for exactly what is real, what is simulated, and the ten spec open questions.

## Layout (spec section 12)

```
apps/web/               React + TS front end (src/routes, design-system, api-client, mocks, i18n, pwa)
services/ingestion/     FIRMS, Sentinel-2, CPCB, Open-Meteo, CRM connectors; fire clustering; calibration; quality metrics
services/agents/        common (bus, idempotency, outbox, health) + the six agents + runtime
services/api/           FastAPI app: RBAC, Problem Details, masking, audit, directives, photos, /ws/live
services/integrations/  telephony (failover), bhashini, whatsapp, machinery_crm, biocng, traffic, mcd, rate limits
packages/domain/        pure risk, attribution, dose, GRAP, ROI, routing + versioned YAML config
packages/contracts/     openapi.json (generated) and event JSON Schemas
db/                     Alembic migrations (PostGIS + TimescaleDB)
infra/                  docker, k8s, terraform
tests/                  unit, integration (recorded real-data fixtures), contract, load (k6)
docs/                   adr/ (12), runbook.md, open-questions.md
```

`docs/legacy/backend-draft/` holds the earlier backend sketch that preceded the spec, kept for reference only.

## Built with IBM Bob

IBM Bob was the primary AI assistant used across the entire project lifecycle. Full details in [`docs/ibm_bob_usage.md`](docs/ibm_bob_usage.md).

**Plan Mode — spec first.** Before writing any code, the team used Bob's Plan Mode to design the full system: 12 Architecture Decision Records, all domain logic invariants, the API contract, event schemas, and a 62-task ordered implementation plan. The output became [`vayu-swachh-spec.md`](vayu-swachh-spec.md) — the single source of truth for everything that followed.

**Agent Mode — implementation.** Bob translated the spec into working code phase by phase across all 7 phases:

| Phase | What Bob built |
| --- | --- |
| 0 Foundations | Monorepo, Python + Node toolchains, pre-commit hooks, Makefile, Docker Compose |
| 1 Data & schema | Domain logic library (5 functions + Hypothesis property tests), 6 real-data ingestion connectors with offline fixtures, Alembic migrations, OpenAPI + event contract |
| 2 Agents | Common runtime (bus, idempotency, outbox, tracing, health) + all 6 agent workers on Redis Streams |
| 3 API | All 18 REST endpoints + `/ws/live` WebSocket, RBAC 403 matrix, phone masking, audit log, EXIF stripping |
| 4 Integrations | Telephony failover, Bhashini audio cache, WhatsApp template guard, CRM optimistic locking, rate limits |
| 5 Front end | All 4 interfaces with mock layer, generated TypeScript client, PWA service worker, i18n (en/pa/hi) |
| 6 Testing & ops | Playwright E2E, k6 load tests, Dockerfiles, Kubernetes manifests, Terraform, GitHub Actions CI/CD, runbook |

**Key Bob features used:** long-context spec retention across 730 lines, multi-file coherent edits, test-first discipline, live todo tracking, and consistent enforcement of every ADR across the codebase — across Python, TypeScript, SQL, YAML, HCL, and k6 JavaScript — without repeated reminders.

## Checks

```bash
make lint type test           # ruff, mypy --strict, tsc --noEmit, pytest, vitest
make contracts-check          # OpenAPI/event schemas must match the code
pytest -m live                # hits the real public APIs
```

## Status against the spec

| Phase | State |
| --- | --- |
| 0 Foundations | Monorepo, Makefile, ruff/mypy-strict/tsc, pre-commit with secret scanner, typed settings (fail fast). Compose file written; **not started here (no Docker daemon)** |
| 1 Data and schema | Domain library with Hypothesis tests; connectors on real public data with recorded fixtures; clustering; Alembic schema. **SQL not run against a database here**; contracts generated and diff-checked |
| 2 Agents | All six, on an in-memory bus with idempotency, redelivery and outbox. Redis Streams bus implemented but **not exercised against a Redis server** |
| 3 API | All 18 spec endpoints plus labelled extensions, RBAC with a 403 matrix test, masking, rate limits, two-person approval, audit chain, EXIF stripping, `/ws/live`. State is **in memory** (SQL repositories not wired) |
| 4 Integrations | Adapters with tests against doubles. No partner credentials, so no live calls |
| 5 Front end | Four interfaces switch to the spec API; typed client generated from OpenAPI; WebSocket with polling fallback |
| 6 Testing/ops | k6 scripts, Dockerfiles, k8s, Terraform, CI, runbook written; **load tests, containers, cluster and Terraform not run here** |
