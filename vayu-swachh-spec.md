# Vayu-Swachh: Implementation Specification

**Purpose of this document:** Single source of truth for Claude Code. It summarises the product context, architectural decisions, interface contracts, and an ordered list of implementation tasks.

**Status:** Draft v1.0
**Pilot region:** Upstream Sangrur (Punjab) → downstream Anand Vihar and Patparganj (East Delhi, NCR)

---

## 1. Product Summary

Vayu-Swachh is a closed-loop air quality action platform for northern India. It connects seasonal crop-residue burning in Punjab and Haryana with urban pollution in Delhi-NCR.

The platform runs a chain from prediction to action:

**Risk prediction → street-level downscaled forecast → real-time source attribution → personalised health advice → municipal closed-loop response → farmer economic alternatives.**

### Problems addressed

| Gap in current system | What Vayu-Swachh does |
| --- | --- |
| Only city-wide average AQI is published | 1 km × 1 km street-level AQI with source mix |
| Generic broadcast health SMS | Profile-based advice (asthma/COPD, children, elderly, outdoor workers) and time-windowed alerts |
| Source apportionment published months late | Near-real-time attribution across four source classes |
| Alerts without action | Municipal work orders, fog cannon/sweeper dispatch, diversion orders, SLA and ROI tracking |
| Satellites detect fires only after they start | 7–10 day pre-harvest risk scoring per parcel, with proactive farmer outreach |
| Punitive-only farmer approach | Subsidised machinery matching and guaranteed-floor-price straw collection |

### Key figures from the source brief (treat as targets or assumptions until validated)

- Straw burned each season: roughly 15–20 million tonnes.
- Bio-CNG guaranteed floor price used in the pilot: ₹1,650/tonne.
- Super Seeder subsidised rental: ₹750/acre.
- Pilot cluster: Sangrur, 14 villages.

---

## 2. Users and Interfaces

| # | Interface | Route | Audience | Primary device |
| --- | --- | --- | --- | --- |
| 1 | CAQM Macro Decision Dashboard | `/policy` | CAQM, CPCB/SPCB, NCAP experts | Desktop |
| 2 | FPO Dispatch Command Screen | `/fpo` | FPOs and Custom Hiring Centres (CHCs) | Desktop / tablet |
| 3 | Farmer Voice Call Simulator | `/farmer` | Farmers with basic phones or WhatsApp | Mobile (audio-first) |
| 4 | Citizen Micro Health PWA | `/citizen` | East Delhi residents | Mobile (PWA) |

### RBAC roles

- `policy_officer`: Interface 1, directives.
- `fpo_coordinator`: Interface 2, call triggers, parcel risk lists.
- `farmer`: Interface 3, bookings and confirmations.
- `citizen`: Interface 4, AQI, advice, routes, photo reports.
- `admin`: Pipeline health, configuration, audit access.

---

## 3. Architecture Decisions

Each decision is recorded as an ADR-style entry.

### ADR-01: Multi-agent architecture on the IBM Bob framework
**Decision:** Six specialised agents run as Bob workers. They communicate only through an event bus, not by direct calls.
**Rationale:** Each agent has an independent failure domain and can be scaled or replaced separately. Agent boundaries match the business domains.
**Consequence:** Every agent must be idempotent and must handle duplicate or out-of-order events.

### ADR-02: Redis as the event bus and shared state store
**Decision:** Redis Streams carry domain events. Redis also holds shared state snapshots and distributed locks.
**Rationale:** Low latency for the 190 ms coordination target, and one component to operate in the pilot.
**Consequence:** Durable history of events is kept in PostgreSQL via an outbox table, so Redis can be rebuilt if needed.

### ADR-03: PostgreSQL with PostGIS and TimescaleDB
**Decision:** PostGIS stores spatial geometry (parcels, villages, grid cells, streets). TimescaleDB stores sensor and AQI time-series.
**Rationale:** Spatial joins (parcel-in-village, grid-to-street) and high-frequency time-series both need native support.
**Consequence:** Migrations must enable both extensions and create hypertables for sensor streams.

### ADR-04: FastAPI for the API layer, Python 3.12 throughout
**Decision:** All backend services are Python 3.12. FastAPI serves REST and WebSocket endpoints. Node.js is permitted only for Bob runtime components that require it.
**Rationale:** One language for agents, data science, and API; strong typing with Pydantic; OpenAPI generated automatically.

### ADR-05: Typed contract-first API
**Decision:** The OpenAPI specification is the contract. The TypeScript client for the front end is generated from it.
**Rationale:** Front end and backend can be developed in parallel against mocks that match the contract. Contract tests protect the boundary.

### ADR-06: Phone number masking by default
**Decision:** Farmer phone numbers are masked (e.g. `98721-XXXXX`) in every API response and UI display. The only exception is the assigned machinery operator on a live booking, and that number is shown only to the farmer and FPO coordinator for that booking.
**Rationale:** Privacy of smallholder farmers; reduces exposure from scraped dashboards.

### ADR-07: Two-person approval for diversion orders
**Decision:** Any directive that diverts traffic (diesel truck diversion) requires a second approver with the `policy_officer` role. Every directive is written to an immutable audit log before dispatch.
**Rationale:** Diversion orders affect freight and public movement; errors are costly and must be traceable.

### ADR-08: Economics-first farmer communication
**Decision:** Farmer scripts state prices and earnings directly. They avoid punitive wording. Fines and penalties are not the primary message.
**Rationale:** The burning decision is driven by economics and sowing deadlines. Behaviour change depends on a viable alternative.

### ADR-09: Keypad-first farmer interaction
**Decision:** Farmers complete actions by pressing 1, 2, or 9 on the phone. No app install or text input is needed.
**Rationale:** Removes digital literacy barriers for elderly rural users.

### ADR-10: Bhashini for speech, with audio cache
**Decision:** Bhashini ASR and TTS handle Punjabi (Malwai) and Hindi (Haryanvi). Generated audio is cached by SHA-256 hash of the normalised script.
**Rationale:** Consistent dialect output and lower cost on repeated scripts.

### ADR-11: Mock-first front end
**Decision:** The front end is built against typed mock fixtures that match the OpenAPI contract. A single environment variable switches to the live API.
**Rationale:** Unblocks front-end work before the backend is ready.

### ADR-12: Privacy for citizen photo reports
**Decision:** Photo uploads are stripped of EXIF metadata except the GPS point, which is stored as a coarse grid reference. Reports receive a reference ID and no personal identifiers.

---

## 4. System Components

```
Data sources ──► Ingestion services ──► PostGIS / TimescaleDB / object storage
(NASA FIRMS, Sentinel-2,         │
 CPCB, IMD, machinery CRM)       ▼
                          Redis event bus (Streams)
                                  │
        ┌──────────┬──────────┬───┴────┬──────────┬──────────┐
        ▼          ▼          ▼        ▼          ▼          ▼
     Ingestion   Stubble    Forecast  Farmer    Health    Municipal
     Agent       Risk Agent & Attrib. Advisory  Advisory  Action Agent
                                       Agent    Agent     Agent
                                  │
                                  ▼
                  FastAPI (REST + WebSocket /ws/live)
                                  │
                ┌─────────────────┼──────────────────┐
                ▼                 ▼                  ▼
          Integrations       Front-end apps     Audit log
          (Twilio/Exotel,    (4 interfaces)     (append-only)
           WhatsApp, Bhashini,
           CRM, Bio-CNG,
           traffic, MCD)
```

### Technology stack

| Layer | Choice |
| --- | --- |
| Language | Python 3.12 (backend), TypeScript (front end) |
| API | FastAPI, Pydantic v2, OpenAPI 3.1 |
| Agents | IBM Bob Agent Framework (pub/sub, state snapshots) |
| Event bus and cache | Redis (Streams, locks) |
| Database | PostgreSQL + PostGIS + TimescaleDB |
| Object storage | S3-compatible bucket (raw satellite and photo data) |
| Modelling | PyTorch (Sentinel-2 decay, thermal clustering), GNN (1 km downscaling), WRF-Chem outputs, NOAA HYSPLIT |
| Speech | Bhashini ASR/TTS |
| Telephony | Twilio or Exotel IVR (one primary, one failover) |
| Messaging | Meta WhatsApp Business API (pre-approved templates only) |
| Front end | React, TypeScript, Tailwind CSS, Three.js, GSAP, Mapbox GL |
| Infrastructure | Docker, Kubernetes, Terraform, GitHub Actions |
| Testing | pytest, Hypothesis (property tests), Vitest, Playwright, k6 (load) |

---

## 5. Domain Logic Specification

### 5.1 Stubble Fire Risk Score

```
RiskScore = f(NDVI_decay_slope, sowing_window_days_remaining,
              soil_moisture_index, historical_fire_density,
              local_machinery_shortfall)
```

- Activated 7–10 days before harvest start.
- `sowing_window_days_remaining` = working days between complete paddy harvest and the latest safe wheat sowing date.
- Output tiers: `low`, `medium`, `high`, `critical`.
- Each parcel is scored; villages are aggregated for the FPO view.
- Implement `f` as a weighted model with configurable weights in a config file. Do not hard-code weights. The functional form is to be finalised during the pilot.

### 5.2 Source Attribution

```
C_total = C_straw_plume + C_vehicle + C_dust + C_industrial_waste
```

- Four source classes, reported as percentages per grid cell and per region.
- Attribution must sum to 100% (±0.5% rounding tolerance). Test this as an invariant.

### 5.3 Exposure Dose

```
Dose = ∫₀ᵗ [ PM2.5(position(τ)) × ventilation_rate(activity(τ)) ] dτ
```

- Discretise the route into segments with fixed time steps (default 60 s).
- Ventilation rate is a lookup by activity: `rest`, `walking`, `cycling`, `vigorous`.
- Exposure reduction (%) = `(Dose_baseline − Dose_recommended) / Dose_baseline × 100`.

### 5.4 GRAP Mapping

Map AQI category and attribution peaks to GRAP response tiers. The mapping is data-driven (a versioned YAML file), not hard-coded. Each tier defines the allowed actions and their approval requirements.

### 5.5 ROI Measurement

- Measure PM2.5 change 4–12 hours after each completed action, comparing against a matched control station.
- `ΔPM2.5 = mean_pre − mean_post` over the window.
- Store the measurement with the work order ID so ROI can be aggregated per pilot area.

### 5.6 Clean Commute Routing

- Candidate routes come from the road graph.
- Each route is scored by time and average exposure AQI.
- Recommend the route that reduces dose by the largest amount with an added time under a configurable limit (default 3 minutes).

---

## 6. Data Specification

### 6.1 Sources

| Source | Data | Cadence |
| --- | --- | --- |
| NASA FIRMS | VIIRS 375 m, MODIS 1 km hotspots | On overpass; poll every 15 min |
| Sentinel-2 | Surface reflectance → NDVI | Every 5 days (per tile) |
| CPCB CAAQMS | Station PM2.5, PM10, NO₂, etc. | Every 15 min |
| Low-cost IoT | Sensor PM2.5 | Every 1–5 min |
| IMD | NWP, PBL height, inversion, 3D winds | Hourly |
| Machinery CRM | Machine status, PTO/GPS hours, assignments | Event-driven + every 5 min |

### 6.2 Storage

- **Raw:** object storage, partitioned by source and date.
- **Normalised spatial:** PostGIS. Tables: `parcel`, `village`, `grid_cell_1km`, `street_segment`, `station`.
- **Time-series:** TimescaleDB hypertables: `aqi_reading`, `sensor_reading`, `fire_hotspot`, `machine_telemetry`, `weather_obs`.
- **Operational:** PostgreSQL tables: `risk_score`, `call`, `booking`, `collection_request`, `work_order`, `directive`, `roi_measurement`, `citizen_report`, `audit_event`.

### 6.3 Data quality

Expose these metrics for the pipeline health monitor:
- Data freshness per source.
- Station availability (for example, 39 of 40 online).
- Drift flags on low-cost sensors.
- Interpolated-value fraction per grid cell.

---

## 7. API Contract

All endpoints are under `/v1`. Responses use JSON with typed schemas. Lists are paginated with `limit` and `cursor`. Errors follow RFC 9457 (Problem Details).

### 7.1 REST endpoints

| Method | Path | Role(s) | Purpose |
| --- | --- | --- | --- |
| GET | `/aqi/grid?bbox=&time=` | citizen, policy_officer | 1 km grid AQI with source mix |
| GET | `/aqi/community/{community_id}` | citizen | Community AQI card and source mix |
| GET | `/plume/projection?origin=&hours=72` | policy_officer | Plume arrival timeline per street |
| GET | `/attribution/summary?region=` | policy_officer | Source attribution matrix |
| GET | `/risk/parcels?village=&tier=` | fpo_coordinator | At-risk parcel list |
| POST | `/calls/trigger` | fpo_coordinator | Body: `parcel_id`. Returns `call_id` |
| GET | `/calls/{call_id}/log` | fpo_coordinator | Transcript and intent summary (phone masked) |
| POST | `/bookings` | farmer, fpo_coordinator | Body: `machinery_id`, `parcel_id`. Returns booking |
| POST | `/bookings/{id}/confirm` | farmer | Keypad confirmation (DTMF 1) |
| POST | `/collections/request` | farmer, fpo_coordinator | Off-field straw collection at floor price |
| GET | `/machinery/status` | fpo_coordinator | Machinery IoT status and utilisation |
| GET | `/health/advice?profile=&community_id=&time=` | citizen | Profile-specific advice |
| GET | `/routes/clean?from=&to=&profile=` | citizen | Clean commute options |
| POST | `/reports/photo` | citizen | Multipart image + GPS. Returns `reference_id` |
| POST | `/directives` | policy_officer | Issue directive. Two-person approval for diversions |
| POST | `/directives/{id}/approve` | policy_officer | Second approver |
| GET | `/roi/summary` | policy_officer, admin | ROI metrics per pilot area |
| GET | `/pipeline/health` | policy_officer, admin | Ingestion and agent status |

### 7.2 WebSocket

`/ws/live` with channel subscriptions:
- `aqi.update`
- `alert.fired`
- `agent.status`
- `booking.update`

Messages use an envelope: `{ "channel", "ts", "trace_id", "payload" }`. The client reconnects with exponential backoff and falls back to polling.

### 7.3 Example: booking and keypad confirmation

```json
// POST /v1/bookings
{ "machinery_id": "SS-08", "parcel_id": "PCL-SGR-0412" }

// 201 Created
{
  "booking_id": "BK-20261024-0031",
  "status": "pending_confirmation",
  "machinery": { "id": "SS-08", "type": "super_seeder", "operator_phone": "98140-XXXXX", "distance_km": 2.1 },
  "rental_rate_inr_per_acre": 750
}
```

---

## 8. Event Specification

| Event | Producer | Consumers | Key payload |
| --- | --- | --- | --- |
| `data.normalised` | Ingestion | Risk, Forecast | source, grid_id, window, quality_flags |
| `risk.updated` | Risk | Farmer Advisory, FPO UI | parcel_id, score, tier |
| `forecast.updated` | Forecast | Health, Municipal | grid_id, horizon_h, pm25_series |
| `attribution.updated` | Forecast | Municipal | region, shares{straw, vehicle, dust, industrial} |
| `booking.created` | Farmer Advisory | Machinery CRM, UI | booking_id, parcel_id, machinery_id |
| `advice.updated` | Health | Citizen PWA | community_id, profile, advice[] |
| `route.computed` | Health | Citizen PWA | from, to, options[] |
| `workorder.created` | Municipal | MCD integration | work_order_id, action_type, location |
| `roi.measured` | Municipal | Dashboard, ROI store | work_order_id, delta_pm25 |

Every event carries `event_id` (UUID), `trace_id`, `schema_version`, and `emitted_at`. Consumers must be idempotent on `event_id`.

---

## 9. Integrations

| Partner | Direction | Mechanism | Notes |
| --- | --- | --- | --- |
| Twilio / Exotel | Outbound calls, inbound webhooks | REST + signed webhooks | Webhooks for call status and DTMF (1, 2, 9). Primary and failover providers behind one adapter |
| Meta WhatsApp Business | Outbound | Cloud API, pre-approved templates | Voice and text notifications |
| Bhashini | Outbound TTS, inbound ASR | REST | Cache by script hash |
| Machinery CRM | Bidirectional | REST + polling | Optimistic locking (version field) on bookings |
| Bio-CNG / briquette partners | Outbound requests, inbound receipts | REST + webhook | Weighbridge receipts reconciled to FPO ledger |
| Traffic authorities | Outbound directives | Approved interface only | Every directive logged before send |
| MCD | Outbound work orders, inbound GPS and completion | REST + webhook | Fog cannon and sweeper fleets |

### Telephony failover

- Primary provider: Twilio (or Exotel, decided during pilot setup).
- Health-check the active provider every 30 seconds.
- On three consecutive failures, switch new calls to the secondary and raise an alert. Do not drop calls in progress.

---

## 10. Security and Compliance

- **Secrets:** stored in a vault (HashiCorp Vault or cloud KMS-backed secret manager). Never in code or environment files committed to git.
- **Encryption:** TLS 1.2+ in transit; AES-256 at rest for databases and object storage.
- **PII:** farmer phone numbers masked at the API boundary (ADR-06). Citizen photos stripped of EXIF except GPS (ADR-12).
- **Audit log:** append-only table with hash chaining. Covers directives, bookings, calls, approvals, and data exports.
- **Rate limits:** outbound calls and WhatsApp messages limited per parcel (for example, max 2 calls per parcel per 24 h). Configurable.
- **Access control:** RBAC enforced in FastAPI dependencies. Every endpoint has a declared role set, tested in contract tests.

---

## 11. Front-End Specification

### 11.1 Shared requirements

- React + TypeScript, Tailwind CSS, Three.js, GSAP, Mapbox GL.
- i18n layer: English first; Punjabi and Hindi required for the farmer interface from the start.
- WCAG 2.1 AA. Citizen PWA and farmer simulator work at 360 px width, with large tap targets.
- Real-time via WebSocket with polling fallback.
- Typed API client generated from OpenAPI.

### 11.2 Interface details

**Policy dashboard (`/policy`)**
- Top status bar; 2×2 panel grid; bottom directive toolbar.
- Panels: source attribution (donut or stacked bar), 72 h plume projection (Mapbox + scrubber), compliance and ROI, pipeline health.
- Directive buttons open a confirmation modal showing area and action before anything is sent.

**FPO screen (`/fpo`)**
- Machinery status cards with utilisation bars.
- Biomass panel: floor price, tonnes removed today, cumulative acres.
- High-risk table: sortable and filterable by village and tier.
- Call panel: live log, intent summary, matched machinery, "Trigger voice call", "Assign baler on-site".

**Farmer simulator (`/farmer`)**
- Phone-frame component. Language toggle (ਪੰਜਾਬੀ / हिंदी / English), default by browser locale.
- Caller ID, elapsed timer, play/pause with waveform driven by audio.
- Subtitles synced to audio.
- Keypad: Press 1, Press 2, Press 9. Each plays a tone, shows a confirmation state, and calls the API.
- Keyboard and screen-reader operable.

**Citizen PWA (`/citizen`)**
- Location header with manual neighbourhood switch.
- Community AQI card with source mix.
- Health profile selector; advice changes by profile and time.
- Time-windowed alerts (for example, 06:00–10:30 inversion warning; afternoon ventilation window).
- Clean commute planner with two options, exposure AQI, and percentage reduction.
- Snap-and-report: camera + GPS, category selection, reference ID.
- Manifest, service worker, offline cache of last AQI snapshot and advice, install prompt.

### 11.3 Front-end states

Every screen implements loading, empty, error, and offline states.

---

## 12. Repository Structure

```
vayu-swachh/
├── apps/
│   ├── web/                      # React front end (four routes)
│   │   ├── src/
│   │   │   ├── routes/           # policy, fpo, farmer, citizen
│   │   │   ├── design-system/    # tokens, AQI colours, components
│   │   │   ├── api-client/       # generated from OpenAPI
│   │   │   ├── mocks/            # fixtures matching contract
│   │   │   ├── i18n/             # en, pa, hi
│   │   │   └── pwa/              # manifest, service worker
│   │   └── tests/
├── services/
│   ├── ingestion/                # FIRMS, Sentinel-2, CPCB, IMD, CRM connectors
│   ├── agents/
│   │   ├── common/               # bus client, idempotency, tracing, health
│   │   ├── ingestion_agent/
│   │   ├── risk_agent/
│   │   ├── forecast_agent/
│   │   ├── advisory_agent/
│   │   ├── health_agent/
│   │   └── municipal_agent/
│   ├── api/                      # FastAPI app, routers, RBAC, WebSocket
│   └── integrations/
│       ├── telephony/            # Twilio/Exotel adapter + failover
│       ├── whatsapp/
│       ├── bhashini/
│       ├── machinery_crm/
│       ├── biocng/
│       ├── traffic/
│       └── mcd/
├── packages/
│   ├── domain/                   # risk, dose, attribution, GRAP, ROI logic (pure Python)
│   └── contracts/                # OpenAPI spec, event schemas (JSON Schema)
├── db/
│   └── migrations/               # Alembic: PostGIS, TimescaleDB, operational tables
├── infra/
│   ├── docker/
│   ├── k8s/
│   └── terraform/
├── tests/
│   ├── unit/
│   ├── integration/              # recorded partner fixtures
│   ├── contract/
│   └── load/                     # k6 scripts
├── docs/
│   ├── runbook.md
│   └── adr/
└── .github/workflows/            # CI/CD
```

---

## 13. Implementation Tasks

Tasks are ordered by dependency. Each task has an acceptance criterion. Complete a task and its tests before starting the next one that depends on it.

### Phase 0: Foundations

**T0.1: Initialise the monorepo.**
- Create the structure in section 12.
- Configure Python 3.12 with `uv` or Poetry; configure pnpm for the front end.
- Add lint (ruff, eslint), type-check (mypy strict, tsc strict), and pre-commit hooks.
- *Acceptance:* `make lint type test` runs on an empty project and passes.

**T0.2: Local infrastructure.**
- `docker-compose.yml` with PostgreSQL 16 (PostGIS and TimescaleDB images), Redis 7, MinIO.
- *Acceptance:* `docker compose up` yields healthy services; a smoke script connects to each.

**T0.3: Secrets and configuration.**
- Typed settings via Pydantic Settings, loaded from environment.
- Local vault stub; no secrets in repo. Add a pre-commit secret scanner.
- *Acceptance:* missing required settings fail fast with a clear error; secret scanner blocks a test commit.

### Phase 1: Data and Schema

**T1.1: Database migrations.**
- Alembic migrations: enable PostGIS and TimescaleDB; create spatial tables (`parcel`, `village`, `grid_cell_1km`, `street_segment`, `station`) and hypertables (`aqi_reading`, `sensor_reading`, `fire_hotspot`, `machine_telemetry`, `weather_obs`); create operational tables from section 6.2.
- Add the audit table with hash chaining.
- *Acceptance:* migrations up and down succeed on a clean database; spatial index and hypertable existence tested.

**T1.2: Contracts first.**
- Write the OpenAPI 3.1 spec for all endpoints in section 7.
- Write JSON Schema for all events in section 8.
- Generate the TypeScript client into `apps/web/src/api-client`.
- *Acceptance:* spec validates; client compiles; generation is in CI.

**T1.3: Domain logic library.**
- Implement in `packages/domain` as pure functions:
  - `risk_score(inputs, weights)` with weights from config.
  - `attribution(sources)` with sum-to-100 invariant.
  - `dose(route_segments, activity_profile)` with discretised integral.
  - `exposure_reduction(baseline, recommended)`.
  - `grap_tier(aqi, attribution)` from versioned YAML.
  - `delta_pm25(pre, post)` and ROI aggregation.
- *Acceptance:* unit tests for each function; property tests (Hypothesis) for attribution sum and dose non-negativity; GRAP mapping tested against a golden table.

**T1.4: Data ingestion connectors.**
- Implement connectors with recorded fixtures for: NASA FIRMS, Sentinel-2 (NDVI), CPCB CAAQMS, low-cost IoT, IMD, machinery CRM.
- Each connector writes raw data to object storage and normalised data to the database.
- Implement drift calibration and gap-filling by spatiotemporal interpolation for sensor data.
- Expose data quality metrics (section 6.3).
- *Acceptance:* each connector passes integration tests against fixtures; quality metrics visible via a query.

**T1.5: Fire clustering.**
- Cluster FIRMS hotspots spatially into fire clusters per village.
- *Acceptance:* deterministic clustering on a fixture; each cluster assigned to a village polygon.

### Phase 2: Agent Core

**T2.1: Agent runtime common library.**
- Bus client on Redis Streams: publish, subscribe with consumer groups, acknowledgements.
- Idempotency store keyed on `event_id`.
- Structured logging with `trace_id` propagation.
- Health endpoint per agent.
- Outbox pattern to PostgreSQL for event durability.
- *Acceptance:* replayed event processed once; crash mid-handler re-delivers and completes; health endpoint returns status.

**T2.2: Data Ingestion Agent.**
- Subscribes to raw ingest triggers; publishes `data.normalised`.
- *Acceptance:* emits one event per grid window; duplicate input yields no duplicate events.

**T2.3: Stubble Fire Risk Agent.**
- Activates 7–10 days before harvest per village configuration.
- Computes parcel risk via `packages/domain`; publishes `risk.updated`; sends lists to FPO via the API.
- *Acceptance:* tier boundaries tested; activation window tested by clock injection; output reproduces fixture scores.

**T2.4: Forecast and Attribution Agent.**
- GNN downscaling from WRF-Chem output to the 1 km grid (model loaded from artifact store; inference wrapper with a fallback to bilinear interpolation if the model is unavailable).
- Source apportionment through `packages/domain`.
- 72 h HYSPLIT projection wrapper producing arrival times per street segment.
- Publishes `forecast.updated` and `attribution.updated`.
- *Acceptance:* attribution invariant holds on every output; fallback path tested; projection output matches fixture within tolerance.

**T2.5: Farmer Advisory and Logistics Agent.**
- Generates Punjabi and Hindi call scripts (templated, economics-first per ADR-08).
- Matches machinery by proximity and availability.
- Arranges collection requests at floor price.
- Subscribes to `risk.updated`; publishes `booking.created`.
- *Acceptance:* scripts contain no punitive wording (lint rule against a blocked-word list); matching returns the nearest available machine; booking idempotent on parcel + machinery.

**T2.6: Personalised Health Advisory Agent.**
- Dose integral computed along routes (section 5.3).
- Profile-specific advice rules (asthma/COPD, child, elderly, outdoor worker, general), versioned config.
- Clean commute route selection with configurable time limit.
- Subscribes to `forecast.updated`; publishes `advice.updated` and `route.computed`.
- *Acceptance:* advice differs by profile in fixtures; route recommendation reduces dose within time limit.

**T2.7: Municipal Action Agent.**
- Maps attribution and peaks to GRAP tiers.
- Creates work orders; dispatches to MCD via integration; issues diversion proposals that require second approval (ADR-07).
- SLA tracking and ΔPM2.5 measurement 4–12 h after completion.
- Subscribes to `attribution.updated`; publishes `workorder.created` and `roi.measured`.
- *Acceptance:* diversion order cannot dispatch without second approval (tested); ROI measurement uses matched control station.

### Phase 3: API Layer

**T3.1: FastAPI skeleton.**
- App factory, routers per domain, RBAC dependency, Problem Details errors, pagination, request tracing.
- *Acceptance:* OpenAPI output matches the contract from T1.2 (diff test in CI).

**T3.2: Read endpoints.**
- `/aqi/grid`, `/aqi/community/{id}`, `/plume/projection`, `/attribution/summary`, `/roi/summary`, `/pipeline/health`, `/machinery/status`, `/health/advice`, `/routes/clean`.
- *Acceptance:* each endpoint returns the schema in the contract; role restrictions enforced (403 tests).

**T3.3: Farmer and FPO endpoints.**
- `/risk/parcels`, `/calls/trigger`, `/calls/{id}/log`, `/bookings`, `/bookings/{id}/confirm`, `/collections/request`.
- Phone masking applied at the response serialiser (ADR-06); test that unmasked numbers never appear except for the permitted booking case.
- *Acceptance:* masking tests pass; rate limit per parcel enforced.

**T3.4: Directives and approvals.**
- `/directives` and `/directives/{id}/approve` with two-person rule for diversions (ADR-07).
- Every action written to the audit log before dispatch.
- *Acceptance:* same user cannot approve their own directive; audit chain verifies.

**T3.5: Citizen report endpoint.**
- `/reports/photo`: multipart upload, EXIF stripping, GPS coarsened, reference ID returned.
- *Acceptance:* uploaded file has no EXIF except GPS; reference ID retrievable.

**T3.6: WebSocket.**
- `/ws/live` with channel subscriptions and envelope from section 7.2.
- Authentication on connect; channel authorisation by role.
- *Acceptance:* client receives `alert.fired` within 1 s of publication in an integration test; unauthorised channel rejected.

### Phase 4: Integrations

**T4.1: Telephony adapter with failover.**
- Adapter interface; Twilio implementation; Exotel implementation.
- Signed webhook handler for call status and DTMF (1, 2, 9).
- Health check and failover logic (section 9).
- Store transcript and intent summary.
- *Acceptance:* DTMF 1 triggers booking confirm; failover tested with a simulated provider outage; in-progress calls not dropped.

**T4.2: Bhashini integration.**
- ASR for recorded responses; TTS for call audio.
- Audio cache keyed by SHA-256 of normalised script.
- *Acceptance:* second request for identical script served from cache (no provider call).

**T4.3: WhatsApp integration.**
- Template message sender; template registry; rejects non-approved templates.
- *Acceptance:* unapproved template raises an error in tests.

**T4.4: Machinery CRM sync.**
- Pull status and push bookings with optimistic locking on `version`.
- Conflict handler: on version mismatch, re-read and surface the conflict to the FPO queue.
- *Acceptance:* concurrent booking test yields exactly one success and one conflict.

**T4.5: Bio-CNG and briquette partners.**
- Collection request sender; weighbridge receipt webhook; ledger reconciliation.
- *Acceptance:* a receipt matching a request reconciles; mismatched weight raises a reconciliation item.

**T4.6: Traffic and MCD integrations.**
- Traffic: approved-interface sender, every directive logged.
- MCD: work order dispatch; GPS and completion webhook updates work order status.
- *Acceptance:* work order lifecycle from created → dispatched → completed tested end to end with fixtures.

**T4.7: Rate limiting.**
- Per-parcel limits for outbound calls and WhatsApp messages (Redis-backed).
- *Acceptance:* the (N+1)th call within the window is refused with a clear reason.

### Phase 5: Front End

**T5.1: Scaffold and design system.**
- Vite + React + TypeScript; Tailwind; router with four routes; i18n with en, pa, hi.
- AQI colour tokens for good through severe-plus; typography and spacing tokens.
- *Acceptance:* routes render; tokens exported; language switch works.

**T5.2: Mock layer.**
- Fixtures for every endpoint; a switch via `VITE_API_MODE=mock|live`.
- *Acceptance:* every screen renders from fixtures with no backend.

**T5.3: Policy dashboard.**
- Four panels, status bar, directive toolbar with confirmation modal.
- 72 h scrubber drives plume overlay.
- *Acceptance:* confirmation required before a directive is submitted; scrubber updates arrival times.

**T5.4: FPO screen.**
- Machinery cards, biomass panel, sortable and filterable risk table, call panel.
- Phone numbers shown masked.
- *Acceptance:* sort and filter work; masked format matches `NNNNN-XXXXX`.

**T5.5: Farmer simulator.**
- Phone frame, language toggle, audio with synced subtitles, keypad with tone and confirmation state.
- Keyboard and screen-reader operation.
- *Acceptance:* keypad flow unit-tested; 360 px layout checked; keyboard-only completion possible.

**T5.6: Citizen PWA.**
- Location, AQI card, profile advice, time-windowed alerts, commute planner, snap-and-report.
- Manifest, service worker, offline snapshot, install prompt.
- *Acceptance:* offline mode shows last snapshot; Lighthouse PWA check passes; exposure percentage displayed correctly from a fixture.

**T5.7: Real-time.**
- WebSocket client with reconnect and polling fallback on all four interfaces.
- *Acceptance:* killing the socket switches to polling within 10 s and recovers.

### Phase 6: Testing, Ops, and Delivery

**T6.1: Contract tests.**
- Verify each endpoint's schema against the front-end client types and against recorded responses.
- *Acceptance:* contract suite runs in CI and fails on any breaking change.

**T6.2: End-to-end tests.**
- Playwright: one happy path per interface (policy directive with confirmation; FPO trigger call; farmer keypad 1; citizen route planner).
- *Acceptance:* all four pass against the staging environment.

**T6.3: Load tests.**
- k6 scripts: 200 concurrent WebSocket clients; 1,000 REST requests per minute.
- *Acceptance:* p95 REST latency under 300 ms at target load; WebSocket delivery under 1 s p95.

**T6.4: Containers and Kubernetes.**
- Dockerfiles for each service (multi-stage, non-root).
- Kubernetes manifests with resource limits, readiness and liveness probes, and HPA for the API.
- *Acceptance:* services deploy to a local cluster and pass probes.

**T6.5: Terraform.**
- Modules for database (managed PostgreSQL with extensions), Redis, object storage, Kubernetes cluster, secrets manager.
- *Acceptance:* `terraform plan` is clean for a staging workspace.

**T6.6: CI/CD.**
- GitHub Actions: lint, type-check, tests, contract diff, container build, deploy to staging, smoke tests, manual approval gate, promote to production.
- *Acceptance:* pipeline green on a sample change; production deploy requires approval.

**T6.7: Runbook.**
- On-call procedures; GRAP escalation steps; telephony provider failover steps; directive rollback; data pipeline recovery.
- *Acceptance:* reviewed by one person who did not write it, who walks through the failover steps.

---

## 14. Definition of Done

A task is complete when:
1. Code is merged behind passing CI (lint, types, tests).
2. Acceptance criteria are demonstrated.
3. Any new decision is recorded as an ADR in `docs/adr/`.
4. Public API changes are reflected in the OpenAPI spec and generated client.
5. No secrets, unmasked farmer phone numbers, or citizen EXIF data appear in logs or fixtures.

---

## 15. Open Questions

These must be resolved before or during the pilot. Claude Code should flag them rather than assume an answer.

1. **Telephony provider:** Twilio or Exotel as primary?
2. **Risk score function `f`:** final functional form and weights, to be fitted on historical pilot data.
3. **Bhashini access:** confirm API access tier and dialect coverage for Malwai Punjabi and Haryanvi Hindi.
4. **Bio-CNG floor price and subsidy amounts:** confirm with partners before showing them to farmers.
5. **Traffic authority interface:** what approved channel exists for diversion orders?
6. **MCD integration:** confirm API availability or whether dispatch is manual in the pilot.
7. **Model artifacts:** source and licence for the GNN downscaling model and WRF-Chem outputs.
8. **Data licensing:** confirm terms for CPCB, IMD, and NASA FIRMS data redistribution in the citizen PWA.
9. **Legal review:** diversion orders and any enforcement-adjacent messaging require legal sign-off.
10. **Pilot metrics baseline:** historical fire counts and PM2.5 baselines for the Sangrur and East Delhi pilot areas.

---

## 16. Glossary

- **AQI:** Air Quality Index.
- **PM2.5 / PM10:** Particulate matter ≤ 2.5 µm / ≤ 10 µm.
- **CAQM:** Commission for Air Quality Management in NCR.
- **CPCB / SPCB:** Central / State Pollution Control Board.
- **CAAQMS:** Continuous Ambient Air Quality Monitoring Stations.
- **GRAP:** Graded Response Action Plan (Delhi-NCR emergency measures).
- **FPO:** Farmer Producer Organisation.
- **CHC:** Custom Hiring Centre (machinery rental).
- **Super Seeder / Happy Seeder:** Machines that sow wheat directly into residue-covered fields.
- **Bio-CNG:** Compressed biogas produced from biomass.
- **PBL:** Planetary Boundary Layer.
- **NDVI:** Normalised Difference Vegetation Index.
- **FIRMS:** Fire Information for Resource Management System (NASA).
- **HYSPLIT:** Hybrid Single-Particle Lagrangian Integrated Trajectory model.
- **WRF-Chem:** Weather Research and Forecasting model with chemistry.
- **Bhashini:** India's national language translation and speech platform.
- **DTMF:** Dual-tone multi-frequency (phone keypad signals).
- **RBAC:** Role-based access control.
- **SLA:** Service-level agreement.
- **ROI:** Return on investment.
