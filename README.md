# Vayu-Swachh

Closed-loop air-quality action platform for northern India, built for the IBM national hackathon (social impact).

Every autumn Delhi's air turns Severe, and smoke from paddy-straw burning in Punjab is one of the biggest reasons. Vayu-Swachh acts **before the match is struck**: it forecasts which fields will burn, gets a machine to the farmer through a simple phone call, tracks the smoke toward Delhi, warns people street by street, and closes the loop with city work orders and measured results.

**fire risk -> machinery and straw offtake -> farmer call -> plume forecast and source attribution -> street-level health advice -> municipal response**

Pilot: Sangrur (Punjab) upstream, Anand Vihar and Patparganj (East Delhi) downstream. Built to [`vayu-swachh-spec.md`](vayu-swachh-spec.md), with IBM Bob ([how we used it](ibm_bob_usage.md)).

> All farmer, parcel, machinery, buyer and payment data in the demo is **simulated** and labelled as such on screen. Hindi and Punjabi copy is machine-drafted and needs native-speaker review.

## The demo

The main front end lives at the repository root (`src/`). It runs on simulated data with no backend.

| Page | Who it is for | What it shows |
| --- | --- | --- |
| `/` | Everyone | Scroll-story landing: a film of one paddy season (planting, ripening, harvest, the burn, the smoke reaching Delhi) ending on the Vayu-Swachh title, then the problem, the closed loop and the five prototypes |
| `/fpo` | FPO / machinery cooperative | Risk-ranked farmer list, voice alerts, machine assignment (Super Seeder, Happy Seeder, baler), straw trucks and a straw-supply tile |
| `/farmer` | Farmer | Phone-call simulator in Punjabi, Hindi or English with a full 12-key keypad (see below) |
| `/citizen` | Delhi residents | Installable PWA: street-level AQI and where the air comes from, 24 h outlook with a better window, advice by health profile, clean-commute planner, snap-and-report |
| `/policy` | CAQM decision makers | Command-centre dashboard: 72 h plume scrubber, source attribution, directives with confirmation (GRAP-II lights the citizen banner and creates work orders) |
| `/ops` | Municipal supervisors | Work orders from directives: accept, then complete with a photo and GPS (demo photo and location work on laptops) |
| `/buyer` | Straw buyers (e.g. Bio-CNG plants) | Claim open straw offers, record weighbridge receipts; payment stays held until the satellite no-fire check and the weighbridge reconciliation both pass |

### Judge demo mode

**Judge demo mode** on the landing page runs a guided tour in the same order as the **System prototypes** menu:

**FPO console -> Farmer call -> Citizen app -> CAQM dashboard -> Municipal portal** (`/fpo?tour=1` to `/ops?tour=5`)

The tour panel floats over the pages: drag it by its header, minimise it to a small pill so it never covers a dashboard, and double-click the header (or press Home) to dock it again. It keeps its place across steps.

### Farmer call keypad

| Step | Keys |
| --- | --- |
| Menu | **1** book a machine · **2** straw pickup · **9** talk to an FPO worker |
| After 1: which machine? | **1** Super Seeder · **2** Happy Seeder · **0** back to the menu |
| Confirm | **1** confirm · **0** back to the menu |
| Any step | **\*** repeat (the whole call message at the menu, otherwise the current question) |

Nothing is booked, requested or queued until the confirming 1. No app, no internet and no text input are needed, so it works on any basic phone.

## Run it

Node 22+ for the front end; Python 3.11+ (the spec targets 3.12) for the backend.

**Front end (simulated data, no backend needed):**

```bash
npm install
npm run dev          # http://localhost:5173
```

Optional: put `VITE_MAPBOX_TOKEN=<token>` in `.env.local` for map tiles on `/policy`; without it a schematic basemap is shown.

**Backend API:**

```bash
pip install -e ".[dev]" rasterio      # or: make install
cp .env.example .env
python run_api.py                     # API on http://localhost:8010 (first ingestion cycle takes ~10-20 s)
```

**Simulated or live data.** `/fpo`, `/policy` and `/citizen` have a **Simulated / Live** toggle that switches every page and reloads; the choice is remembered in the browser (`vs.apiMode`). Without it, `VITE_API_MODE` decides (default `mock`). Live mode in the main front end is still partial: its adapter (`src/api/live.ts`) does not yet match all of the backend's `/v1` routes, and the buyer desk has no backend routes yet. For a full run against the API, use the older front end in `apps/web/`, which is wired to it (`cd apps/web && npm ci && npm run dev`, with `VITE_API_MODE=live` in `apps/web/.env.local`). Both front ends use port 5173, so run one at a time.

With the API in `VAYU_ENV=dev`, the front end signs in with development role tokens; production uses a real identity provider.

Local infrastructure (optional, for the SQL migrations): `docker compose up -d postgres redis minio && python scripts/smoke_infra.py`.

## What runs on real data

| Signal | Source |
| --- | --- |
| Fire hotspots, village clusters | NASA FIRMS VIIRS 375 m (public CSV, 15 min poll) |
| PM2.5/PM10/NO2/SO2/CO/dust, 72 h forecast | Copernicus CAMS via Open-Meteo |
| Winds, boundary layer, soil moisture | NWP via Open-Meteo |
| NDVI and its decay slope (harvest timing) | Sentinel-2 L2A (Earth Search STAC, AWS COGs) |
| Ground stations | CPCB via data.gov.in |

Farmers, parcels, phone numbers, the machinery CRM, buyers and payments are private data and are **simulated**. Source attribution is a transparent proxy model, not a receptor model. See [`docs/open-questions.md`](docs/open-questions.md) for exactly what is real, what is simulated, and the spec's open questions.

## Layout

```
src/                    Main front end (Vite + React 19 + strict TS + Tailwind v4 + GSAP + Three + Mapbox)
  features/             home (scroll film), policy, fpo, farmer, citizen, ops, buyer
  api/                  VayuApi contract, mock (default), live adapter
tests/unit, tests/e2e   Vitest and Playwright for the main front end
apps/web/               Older front end, wired to the backend API
services/ingestion/     FIRMS, Sentinel-2, CPCB, Open-Meteo, CRM connectors; fire clustering; calibration; quality metrics
services/agents/        common (bus, idempotency, outbox, health) + the six agents + runtime
services/api/           FastAPI app: RBAC, Problem Details, masking, audit, directives, farmer keypad, photos, /ws/live
services/integrations/  telephony (failover), bhashini, audio, machinery_crm, biocng, mcd, rate limits
packages/domain/        pure risk, attribution, dose, GRAP, ROI, routing + versioned YAML config (incl. farmer call scripts)
packages/contracts/     openapi.json (generated) and event JSON Schemas
db/                     Alembic migrations (PostGIS + TimescaleDB)
infra/                  docker, k8s, terraform
tests/                  Python unit, integration (recorded real-data fixtures), contract, load (k6)
docs/                   adr/ (23 decision records), runbook.md, open-questions.md, data-licences.md
```

`docs/legacy/backend-draft/` holds the earlier backend sketch that preceded the spec, kept for reference only.

## Built with IBM Bob

IBM Bob was the primary AI assistant used across the project lifecycle. Full details in [`ibm_bob_usage.md`](ibm_bob_usage.md).

**Plan Mode, spec first.** Before writing any code, the team used Bob's Plan Mode to design the full system: 12 Architecture Decision Records, all domain logic invariants, the API contract, event schemas, and a 62-task ordered implementation plan. The output became [`vayu-swachh-spec.md`](vayu-swachh-spec.md), the single source of truth for everything that followed.

**Agent Mode, implementation.** Bob translated the spec into working code phase by phase across all 7 phases:

| Phase | What Bob built |
| --- | --- |
| 0 Foundations | Monorepo, Python + Node toolchains, pre-commit hooks, Makefile, Docker Compose |
| 1 Data & schema | Domain logic library (5 functions + Hypothesis property tests), 6 real-data ingestion connectors with offline fixtures, Alembic migrations, OpenAPI + event contract |
| 2 Agents | Common runtime (bus, idempotency, outbox, tracing, health) + all 6 agent workers on Redis Streams |
| 3 API | All 18 REST endpoints + `/ws/live` WebSocket, RBAC 403 matrix, phone masking, audit log, EXIF stripping |
| 4 Integrations | Telephony failover, Bhashini audio cache, CRM optimistic locking, rate limits |
| 5 Front end | The first four interfaces with a mock layer, generated TypeScript client, PWA service worker, i18n (en/pa/hi) |
| 6 Testing & ops | Playwright E2E, k6 load tests, Dockerfiles, Kubernetes manifests, Terraform, GitHub Actions CI/CD, runbook |

**Key Bob features used:** long-context spec retention across 730 lines, multi-file coherent edits, test-first discipline, live todo tracking, and consistent enforcement of every ADR across the codebase (Python, TypeScript, SQL, YAML, HCL and k6 JavaScript) without repeated reminders.

## Checks

**Main front end (root):**

```bash
npm run typecheck     # tsc --noEmit
npm test              # Vitest unit tests
npm run e2e           # Playwright (set PW_CHROMIUM_PATH to reuse an installed Chrome instead of `npx playwright install`)
npm run build         # typecheck + production build
```

**Backend and the older front end:**

```bash
make lint type test           # ruff, mypy --strict, pytest; tsc and vitest for apps/web
make contracts-check          # OpenAPI/event schemas must match the code
pytest -m live                # hits the real public APIs
```

After an API change, regenerate the contract with `python scripts/export_contracts.py` and the `apps/web` client types with `npm run gen:api` (in `apps/web`); `tests/contract/test_contracts.py` fails on drift.

## Status against the spec

| Phase | State |
| --- | --- |
| 0 Foundations | Monorepo, Makefile, ruff/mypy-strict/tsc, pre-commit with secret scanner, typed settings (fail fast). Compose file written; **not started here (no Docker daemon)** |
| 1 Data and schema | Domain library with Hypothesis tests; connectors on real public data with recorded fixtures; clustering; Alembic schema. **SQL not run against a database here**; contracts generated and diff-checked |
| 2 Agents | All six, on an in-memory bus with idempotency, redelivery and outbox. Redis Streams bus implemented but **not exercised against a Redis server** |
| 3 API | All 18 spec endpoints plus labelled extensions (including the farmer keypad), RBAC with a 403 matrix test, masking, rate limits, two-person approval, audit chain, EXIF stripping, `/ws/live`. State is **in memory** (SQL repositories not wired) |
| 4 Integrations | Adapters with tests against doubles. No partner credentials, so no live calls. WhatsApp was removed: farmers act on the keypad only (ADR-09) |
| 5 Front end | Main front end: landing film plus seven pages on simulated data, with a Simulated/Live toggle (live adapter partial). `apps/web`: wired to the spec API with a typed client generated from OpenAPI and a WebSocket with polling fallback |
| 6 Testing/ops | Vitest and Playwright for both front ends; k6 scripts, Dockerfiles, k8s, Terraform, CI and runbook written; **load tests, containers, cluster and Terraform not run here** |
