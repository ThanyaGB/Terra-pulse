# Vayu-Swachh: Implementation Specification

**Purpose:** Single source of truth for Claude Code. Covers product scope, architecture decisions, interface contracts, domain logic, and an ordered task list.

**Status:** Draft v2.0. Supersedes v1.1. All previously open questions are closed by decision in section 3. Nothing in this version depends on an unresolved external input.

**Pilot region:** Upstream Sangrur (Punjab), 14 villages → downstream Anand Vihar and Patparganj (East Delhi, NCR)

---

## 1. Product Summary

Vayu-Swachh is a closed-loop air quality action platform for northern India. It connects seasonal crop-residue burning in Punjab and Haryana with urban pollution in Delhi-NCR.

The platform runs this chain:

**Risk prediction → street-level forecast → source attribution → personalised health advice → municipal response → farmer economic alternatives → verified outcome.**

### Problems addressed

| Gap in current system | What Vayu-Swachh does |
| --- | --- |
| Only city-wide average AQI is published | 1 km street-level AQI with source mix |
| Generic broadcast health SMS | Profile-based advice (asthma/COPD, children, elderly, outdoor workers) and time-windowed alerts |
| Source apportionment published months late | Near-real-time attribution across four source classes |
| Alerts without action | Municipal work orders with supervisor portal, SLA tracking, ROI measurement |
| Satellites detect fires only after they start | 7–10 day pre-harvest risk scoring per parcel, with proactive farmer outreach |
| Punitive-only farmer approach | Subsidised machinery matching and off-field straw collection |

### Figures from the source brief

These are planning targets, held in configuration, not hard-coded:
- Straw burned each season: roughly 15–20 million tonnes.
- Bio-CNG floor price: ₹1,650/tonne. Shown to farmers only when an active partner contract backs it (ADR-17).
- Super Seeder subsidised rental: ₹750/acre. Configured the same way.
- Pilot cluster: Sangrur, 14 villages.

---

## 2. Users, Interfaces, and Roles

| # | Interface | Route | Audience | Primary device |
| --- | --- | --- | --- | --- |
| 1 | CAQM Macro Decision Dashboard | `/policy` | CAQM, CPCB/SPCB, NCAP experts | Desktop |
| 2 | FPO Dispatch Command Screen | `/fpo` | FPOs and Custom Hiring Centres (CHCs) | Desktop / tablet |
| 3 | Farmer Voice Call Simulator | `/farmer` | Farmers with basic phones | Mobile (audio-first) |
| 4 | Citizen Micro Health PWA | `/citizen` | East Delhi residents | Mobile (PWA) |
| 5 | Municipal Supervisor Portal | `/ops` | MCD supervisors and sweeper/fog-cannon crews | Mobile (PWA) |

### RBAC roles

- `policy_officer`: Interface 1; issues directives; second approver for diversions.
- `fpo_coordinator`: Interface 2; triggers calls; views parcel risk lists; requests collections.
- `farmer`: Interface 3; confirms bookings.
- `citizen`: Interface 4; AQI, advice, routes, photo reports.
- `municipal_supervisor`: Interface 5; accepts and completes work orders.
- `admin`: pipeline health, configuration, feature flags, audit access.

---

## 3. Scope Decisions for v2.0

Every former open question is closed here. The decision either builds a complete version using sources we can use without external approval, or removes the feature from the pilot. Nothing is left blocked.

| Former question | Decision | Built in pilot | Removed or deferred |
| --- | --- | --- | --- |
| 1. Telephony provider | Exotel primary, Twilio standby | Telephony adapter with both providers; failover | None |
| 2. Risk score weights | Phase 1 weighted score only, with priors in config | Config-driven scoring; calibration analysis script run offline (not a product feature) | Phase 2 trained classifier (post-pilot) |
| 3. Bhashini access | Pre-recorded audio library is the default. Bhashini TTS is an optional provider behind a flag | Audio library pipeline; Bhashini adapter | ASR of farmer speech (removed; keypad input only, per ADR-09) |
| 4. Bio-CNG and subsidy rates | Rates come from contract tables. Buy-back line is omitted from scripts when no active contract exists | Rate tables; conditional script rendering | None |
| 5. Traffic authority channel | The platform never transmits to traffic authorities | Directive record with two-person approval; signed PDF export for officers to send through their own channels | Any automated traffic integration |
| 6. MCD integration | MCD supervisors use our own portal. No MCD API dependency | Supervisor portal; work-order accept and complete flow | MCD REST adapter |
| 7. Model artifacts | No GNN, no WRF-Chem. Open-licence inputs only | CAMS forecast grids and ERA5 meteorology (Copernicus licence), CPCB observations, kriging with external drift using OpenStreetMap road density (ODbL), NOAA HYSPLIT (public domain) | GNN downscaler; WRF-Chem runs (post-pilot) |
| 8. Data licensing | Only open-licence sources. Attribution shown in every UI that uses them | Sources listed in section 7.1 with licence and attribution text | IMD raw feeds; any source without an open licence |
| 9. Legal review | Not a build blocker. Externally facing features ship behind flags that default OFF | All features built; flags control release | Public citizen alerts and traffic advisory export stay OFF until the legal gate (section 17) is passed |
| 10. Pilot baseline | Fire baseline from satellite data. Air-quality baseline from stations that have history. Control via synthetic control | FIRMS 2023–2025 fire baseline for Sangrur; CPCB history for Anand Vihar and Patparganj; difference-in-differences against unaffected Delhi stations | Any dependency on Sangrur ground stations |

### Deferred to post-pilot (not in v2.0 scope)

- Phase 2 trained risk classifier.
- GNN downscaling and in-house WRF-Chem runs.
- Automated traffic authority integration.
- MCD REST integration.
- ASR of farmer speech.
- Expansion beyond Sangrur and East Delhi.

### Feature flags (all in `config/features.yaml`, changed only by admins with audit)

| Flag | Default | Turns on |
| --- | --- | --- |
| `TELEPHONY_ENABLED` | `false` | Outbound farmer calls. Requires gate G1 |
| `TTS_PROVIDER` | `prerecorded` | `prerecorded` or `bhashini` |
| `PUBLIC_ALERTS_ENABLED` | `false` | Citizen PWA push alerts. Requires gate G2 |
| `ADVISORY_EXPORT_ENABLED` | `true` | PDF export of approved diversion advisories for internal use |
| `CALIBRATION_MODE` | `false` | Read-only analysis mode for offline calibration |

---

## 4. Architecture Decisions

### ADR-01: Multi-agent architecture on the IBM Bob framework
**Decision:** Six specialised agents run as Bob workers. They communicate only through the event bus.
**Rationale:** Independent failure domains; agents can be scaled or replaced separately.
**Consequence:** Every agent is idempotent and tolerates duplicate or out-of-order events.

### ADR-02: Redis Streams as the event bus, with PostgreSQL outbox
**Decision:** Redis Streams carry domain events. Redis also holds shared state snapshots and distributed locks. Every event is first written to a PostgreSQL outbox table.
**Rationale:** Low latency for the 190 ms coordination target, with durable history that lets Redis be rebuilt.
**Consequence:** Replay from the outbox is a supported recovery path (runbook, T6.7).

### ADR-03: PostgreSQL with PostGIS and TimescaleDB
**Decision:** PostGIS stores spatial geometry. TimescaleDB stores sensor and AQI time-series.
**Rationale:** Spatial joins and high-frequency time-series both need native support.
**Consequence:** Migrations enable both extensions and create hypertables.

### ADR-04: FastAPI and Python 3.12
**Decision:** All backend services use Python 3.12. FastAPI serves REST and WebSocket. Node.js only where a Bob runtime component requires it.
**Rationale:** One language for agents, data science, and API; Pydantic typing; generated OpenAPI.

### ADR-05: Contract-first API
**Decision:** The OpenAPI spec is the contract. The TypeScript client is generated from it.
**Rationale:** Front end and backend develop in parallel against mocks. Contract tests protect the boundary.

### ADR-06: Phone number masking
**Decision:** Farmer phone numbers are masked (e.g. `98721-XXXXX`) in every response and UI. The only exception is the assigned machinery operator on a live booking, shown to that farmer and the FPO coordinator for that booking.
**Rationale:** Privacy for smallholder farmers.

### ADR-07: Two-person approval for diversion recommendations
**Decision:** Any diversion recommendation needs approval from a second `policy_officer`. Each directive is written to the audit log before it becomes exportable.
**Rationale:** Diversions affect freight and public movement; the decision must be traceable.
**Consequence:** The platform records and exports the recommendation. Traffic authorities act on it through their own channels (ADR-14).

### ADR-08: Economics-first farmer communication
**Decision:** Scripts state prices and earnings directly, avoid punitive wording, and never lead with fines.
**Rationale:** Burning is driven by economics and sowing deadlines.

### ADR-09: Keypad-first farmer interaction
**Decision:** Farmers act on the keypad only, in two steps. Menu: 1 (book a Super Seeder), 2 (straw pickup), 9 (talk to an FPO worker). The call then reads back the choice: 1 confirms, 0 goes back to the menu. Nothing is booked or requested before the confirming 1. No app, no WhatsApp, no speech input.
**Rationale:** Removes literacy and smartphone barriers.

### ADR-10: Audio library first, Bhashini optional
**Decision:** Farmer call audio comes from a library of pre-recorded Punjabi (Malwai) and Hindi (Haryanvi) clips, keyed by script hash. Bhashini TTS can be enabled through `TTS_PROVIDER=bhashini`, with generated audio cached by SHA-256 of the normalised script.
**Rationale:** The library works with no external API dependency. Bhashini adds coverage when available.
**Consequence:** A native speaker records the clip library before the pilot (T4.2). Bhashini quality is benchmarked on Sangrur samples before it is switched on.

### ADR-11: Mock-first front end
**Decision:** The front end runs against fixtures that match the OpenAPI contract. `VITE_API_MODE=mock|live` switches the data source.

### ADR-12: Privacy for photo uploads
**Decision:** Citizen and supervisor photos have EXIF stripped, except the GPS point, which is stored as a 100 m grid cell. Reports get a reference ID and no personal identifiers.

### ADR-13: Exotel primary telephony, Twilio standby
**Decision:** Exotel is primary for outbound IVR. Twilio is hot standby behind the same adapter.
**Rationale:** Local carrier connectivity in India.
**Consequence:** Calls are enabled only after gate G1 (telecom compliance) passes.

### ADR-14: Traffic diversions are recommendations, not transmissions
**Decision:** The platform does not send anything to traffic authorities. An approved diversion becomes a digitally signed PDF advisory that a policy officer downloads and sends through official channels. Traffic authorities take the decision.
**Rationale:** No approved programmatic channel exists, and the platform should not assume an enforcement role.
**Consequence:** Advisory export is internal-only until gate G2 passes.

### ADR-15: MCD dispatch through our supervisor portal
**Decision:** The platform owns the work-order workflow. Supervisors see work orders in the `/ops` portal, accept them, and submit completion photos with GPS. SMS notifications are optional through feature flags.
**Rationale:** The closed loop runs without any external MCD dependency.

### ADR-16: Open-licence forecast inputs with kriging downscaling
**Decision:** The forecast uses CAMS global atmospheric forecast grids and ERA5 meteorology as inputs. CPCB observations correct the forecast. Downscaling to 1 km uses kriging with external drift, where the drift covariates are OpenStreetMap road density and land-use class.
**Rationale:** Avoids WRF-Chem compute and any proprietary model licence. All inputs have open licences.
**Consequence:** The RMSE target (< 25 µg/m³, 24-hour) is measured on this path. Results are reported at the pilot review even if the target is missed.

### ADR-17: Partner rates, risk weights, and GRAP tiers are configuration
**Decision:** Floor prices, subsidy rates, risk weights, and GRAP tiers live in versioned config and partner tables. Farmer-facing rates are rendered only from an active contract row.
**Rationale:** Rates change and must be traceable to a contract.
**Consequence:** Config changes are audited. Scripts read rates at call time.

### ADR-18: Required disclaimers, served from config
**Decision:** Citizen advice states it is environmental exposure guidance, not medical advice. Directives are described as recommendations to authorities. The disclaimer text is stored in config so legal review can change wording without a code release.

### ADR-19: Externally facing features behind flags
**Decision:** Any feature that sends content to the public or to an external party is controlled by a feature flag that defaults to OFF. Flags are listed in section 3.
**Rationale:** Build completeness does not depend on launch approvals.

### ADR-20: Open-licence source policy
**Decision:** Only sources with an open or permissive licence are ingested. Each source is registered in `data_source` with its licence, attribution text, and redistribution rule. Attribution is rendered in every UI that displays derived data.
**Rationale:** Avoids redistribution problems in the citizen PWA.

### ADR-21: Baseline does not depend on Sangrur ground stations
**Decision:** The fire baseline comes from FIRMS satellite data. The air-quality baseline comes from CPCB stations in the Delhi pilot areas. Causal estimates use difference-in-differences with unaffected Delhi stations as controls, plus a synthetic-control variant.
**Rationale:** Sangrur station coverage is not needed to measure the pilot.

### ADR-22: Keypad 9 routes to an FPO worker
**Decision:** Pressing 9 (and confirming with 1) places the farmer in a queue for an FPO worker. The queue is staffed by FPO workers in pilot hours. Outside those hours the call offers a callback slot.
**Rationale:** Avoids promising a human response the pilot cannot provide.

### ADR-23: Sentinel-2 NDVI is kept, refreshed on a 5-day schedule
**Decision:** Sentinel-2 L2A NDVI stays in the risk score as the only direct crop-condition input (weight 0.25 in section 8.1). It is read from the public Earth Search STAC catalogue and cloud-hosted COG bands, which need no account or key. A scheduled job refreshes NDVI every 5 days per tile (matching the revisit cadence), skips scenes above 40% cloud cover, and stores each observation with its scene id and date. The ingestion cycle never reads Sentinel-2 live; it uses the latest stored observations, so a 15-minute cycle is not slowed by raster reads.
**Alternatives considered:**
- *MODIS or VIIRS NDVI (NASA):* free but needs an Earthdata login; 250 m to 1 km resolution is too coarse for parcels but acceptable at village level, with daily revisits. Documented fallback when no clear Sentinel-2 scene exists for more than 10 days.
- *Google Earth Engine:* convenient, but needs an account and has licence limits for operational use.
- *Microsoft Planetary Computer:* the same Sentinel-2 data behind a key; no benefit over Earth Search.
- *Drop NDVI:* the score would lose its crop-condition signal. If ever required, set the NDVI weight to 0 in the weights file and renormalise the others; no code change.
**Consequences:** NDVI observations older than 8 days mark the source `degraded` in the pipeline health monitor, and `down` beyond 24 days. The risk agent uses the age of the newest scene as a quality flag on every score. Under monsoon or heavy smoke cover the newest clear scene can be weeks old; this limit is shown to operators rather than hidden.

---

## 5. Components and Stack

```
Data sources ──► Ingestion services ──► PostGIS / TimescaleDB / object storage
(FIRMS, Sentinel-2, CPCB (OGD), CAMS, ERA5, OSM, machinery CRM)
                                  │
                                  ▼
                       Redis event bus (Streams) + outbox
                                  │
     ┌──────────┬──────────┬──────┴────┬──────────┬──────────┐
     ▼          ▼          ▼           ▼          ▼          ▼
  Ingestion  Stubble    Forecast    Farmer     Health    Municipal
  Agent      Risk Agent & Attrib.   Advisory   Advisory  Action Agent
                                    Agent      Agent     Agent
                                  │
                                  ▼
            FastAPI (REST + WebSocket /ws/live)
                                  │
      ┌───────────────┬───────────┴────────┬──────────────────┐
      ▼               ▼                    ▼                  ▼
  Integrations   Front-end apps       Audit log         Feature flags
  (Exotel/Twilio, (4 + supervisor     (append-only)     (config/features.yaml)
   Bhashini opt.,  portal)
   Machinery CRM,
   Bio-CNG)
```

| Layer | Choice |
| --- | --- |
| Language | Python 3.12 (backend), TypeScript (front end) |
| API | FastAPI, Pydantic v2, OpenAPI 3.1 |
| Agents | IBM Bob Agent Framework (pub/sub, state snapshots) |
| Event bus and cache | Redis 7 (Streams, locks) |
| Database | PostgreSQL 16 + PostGIS + TimescaleDB |
| Object storage | S3-compatible bucket |
| Modelling | PyTorch (Sentinel-2 decay, fire clustering), kriging with external drift (SciPy/PyKrige), NOAA HYSPLIT |
| Speech | Pre-recorded audio library (default); Bhashini TTS (optional) |
| Telephony | Exotel (primary), Twilio (standby) |
| Front end | React, TypeScript, Vite, Tailwind CSS, Three.js, GSAP, Mapbox GL |
| Infrastructure | Docker, Kubernetes, Terraform, GitHub Actions |
| Observability | OpenTelemetry, Prometheus, Grafana, Loki |
| Testing | pytest, Hypothesis, Vitest, Playwright, k6 |

---

## 6. Domain Logic

### 6.1 Stubble Fire Risk Score

```
RiskScore = Σ wᵢ · xᵢ,   where each xᵢ ∈ [0, 1] and Σ wᵢ = 1
```

Inputs, each normalised so that 1 means higher burning risk:

| Input | Normalisation | Phase 1 weight (prior) |
| --- | --- | --- |
| Sowing window days remaining | Fewer days → higher value | 0.30 |
| NDVI decay slope (Sentinel-2) | Faster decay → higher value | 0.25 |
| Local machinery shortfall | Shortfall ratio → higher value | 0.20 |
| Historical fire density (FIRMS, 3 yr) | Density percentile | 0.15 |
| Soil moisture index | Drier → higher value | 0.10 |

- Activated 7–10 days before harvest per village.
- Tiers: `low` < 0.35, `medium` < 0.60, `high` < 0.80, `critical` ≥ 0.80. Boundaries live in config.
- Weights and tiers live in `config/risk_weights.yaml`. An offline calibration script (run under `CALIBRATION_MODE`) can propose new weights from pilot data, but a human approves any change.

### 6.2 Source Attribution

```
C_total = C_straw + C_vehicle + C_dust + C_industrial_waste
```

- Four source classes, reported as percentages per grid cell and per region.
- Shares sum to 100 ± 0.5 %. This is a tested invariant.
- Shares are computed by chemical mass balance on speciated inputs where available. Where speciation is missing, the fallback uses the HYSPLIT tracer fraction for the straw class and the land-use and traffic proxy for the others. The fallback is flagged in the output.

### 6.3 Exposure Dose

```
Dose = ∫₀ᵗ [ PM2.5(position(τ)) × ventilation_rate(activity(τ)) ] dτ
```

- Route is discretised at 60 s steps.
- Ventilation rate by activity: `rest`, `walking`, `cycling`, `vigorous`.
- Exposure reduction (%) = `(Dose_baseline − Dose_recommended) / Dose_baseline × 100`.

### 6.4 GRAP Mapping

Mapped from AQI category and attribution peaks to GRAP response tiers. Stored in `config/grap_tiers.yaml` with a version number. Each tier lists allowed actions and whether they need a second approver.

### 6.5 ROI Measurement

- Window: 4–12 hours after work-order completion.
- Treatment effect: difference-in-differences. Treated = pilot street station. Controls = unaffected Delhi stations matched on pre-period trend.
- Synthetic-control estimate reported alongside, as a robustness check.
- `ΔPM2.5 = (post_treated − pre_treated) − (post_control − pre_control)`.
- Stored in `roi_measurement` with the work-order ID.

### 6.6 Clean Commute Routing

- Candidate routes come from the OpenStreetMap road graph.
- Each route is scored on time and average exposure AQI.
- Recommend the route with the largest dose reduction whose added time is within a configurable limit (default 3 minutes).

---

## 7. Data Specification

### 7.1 Sources and licences

| Source | Data | Cadence | Licence (to be recorded in `data_source`) | Attribution |
| --- | --- | --- | --- | --- |
| NASA FIRMS | VIIRS 375 m, MODIS 1 km hotspots | Poll every 15 min | NASA open data policy | "NASA FIRMS" |
| Sentinel-2 | Surface reflectance → NDVI | Every 5 days per tile | Copernicus open licence | "Contains modified Copernicus Sentinel data" |
| CPCB CAAQMS | Station PM2.5, PM10, NO₂ | Every 15 min | Government Open Data Licence – India, via data.gov.in | "Source: CPCB via data.gov.in" |
| CAMS | Global atmospheric forecast grids | Every 12 h | Copernicus licence | "Copernicus Atmosphere Monitoring Service" |
| ERA5 | Reanalysis meteorology (PBL, wind, temperature) | Hourly | Copernicus licence | "Copernicus Climate Change Service" |
| OpenStreetMap | Roads, land use | Monthly extract | ODbL | "© OpenStreetMap contributors" |
| Low-cost IoT sensors | Sensor PM2.5 | 1–5 min | Owned or contracted per deployment | Per contract |
| Machinery CRM | Machine status, PTO and GPS hours | Event-driven + 5 min | Partner data agreement | Internal |

Raw IMD feeds are not used in v2.0.

Sentinel-2 refresh policy is in ADR-23: scheduled every 5 days per tile, cloud cover below 40%, stored observations only on the 15-minute cycle, with MODIS or VIIRS NDVI as the documented village-level fallback.

### 7.2 Storage

- **Raw:** object storage, partitioned by source and date.
- **Spatial (PostGIS):** `parcel`, `village`, `grid_cell_1km`, `street_segment`, `station`, `data_source`.
- **Time-series (TimescaleDB hypertables):** `aqi_reading`, `sensor_reading`, `fire_hotspot`, `machine_telemetry`, `weather_obs`, `forecast_grid`.
- **Operational (PostgreSQL):** `risk_score`, `call`, `booking`, `collection_request`, `partner_contract`, `partner_rate`, `work_order`, `work_order_event`, `directive`, `roi_measurement`, `citizen_report`, `audit_event`, `outbox_event`.

### 7.3 Retention

- Raw satellite and forecast data: 3 years.
- Sensor and AQI time-series: 5 years.
- Citizen photo reports: 90 days, then deleted. Only the aggregated grid count is kept.
- Call transcripts and recordings: 180 days, then deleted. Intent summaries kept for 2 years.
- Audit log: permanent.

### 7.4 Data quality

Exposed to the pipeline health monitor:
- Freshness per source.
- Station availability (for example, 39 of 40 online).
- Drift flags on low-cost sensors.
- Interpolated-value fraction per grid cell.
- Fallback-path usage in attribution (section 6.2).

---

## 8. API Contract

All endpoints are under `/v1`. Lists use cursor pagination (`limit`, `cursor`). Errors follow RFC 9457 Problem Details.

### 8.1 REST

| Method | Path | Role(s) | Purpose |
| --- | --- | --- | --- |
| GET | `/aqi/grid?bbox=&time=` | citizen, policy_officer | 1 km grid AQI with source mix |
| GET | `/aqi/community/{community_id}` | citizen | Community AQI card and source mix |
| GET | `/plume/projection?origin=&hours=72` | policy_officer | Plume arrival timeline per street |
| GET | `/attribution/summary?region=` | policy_officer | Source attribution matrix |
| GET | `/risk/parcels?village=&tier=` | fpo_coordinator | At-risk parcel list |
| POST | `/calls/trigger` | fpo_coordinator | Body: `parcel_id`. Returns `call_id`. Requires `TELEPHONY_ENABLED` |
| GET | `/calls/{call_id}/log` | fpo_coordinator | Transcript and intent summary (phone masked) |
| POST | `/bookings` | farmer, fpo_coordinator | Body: `machinery_id`, `parcel_id` |
| POST | `/bookings/{id}/confirm` | farmer | Keypad confirmation (DTMF 1) |
| POST | `/collections/request` | farmer, fpo_coordinator | Off-field straw collection. Buy-back rate from active contract only |
| GET | `/machinery/status` | fpo_coordinator | Machinery IoT status and utilisation |
| GET | `/health/advice?profile=&community_id=&time=` | citizen | Profile-specific advice |
| GET | `/routes/clean?from=&to=&profile=` | citizen | Clean commute options |
| POST | `/reports/photo` | citizen | Multipart image + GPS. Returns `reference_id` |
| POST | `/directives` | policy_officer | Create a diversion or other recommendation |
| POST | `/directives/{id}/approve` | policy_officer | Second approver (cannot be the creator) |
| GET | `/directives/{id}/export` | policy_officer | Signed PDF of an approved directive. Requires `ADVISORY_EXPORT_ENABLED` |
| GET | `/work-orders?status=&area=` | municipal_supervisor, policy_officer | List work orders |
| POST | `/work-orders/{id}/accept` | municipal_supervisor | Accept a work order |
| POST | `/work-orders/{id}/complete` | municipal_supervisor | Submit completion with photo and GPS |
| GET | `/roi/summary` | policy_officer, admin | ROI per pilot area |
| GET | `/pipeline/health` | policy_officer, admin | Ingestion and agent status |
| GET | `/admin/features` | admin | Current feature flags |
| PUT | `/admin/features/{name}` | admin | Change a flag (audited, two-person for externally facing flags) |

### 8.2 WebSocket

`/ws/live` with channels `aqi.update`, `alert.fired`, `agent.status`, `booking.update`, `work_order.update`.

Envelope: `{ "channel", "ts", "trace_id", "payload" }`. Clients reconnect with exponential backoff and fall back to polling.

### 8.3 Example: booking

```json
// POST /v1/bookings
{ "machinery_id": "SS-08", "parcel_id": "PCL-SGR-0412" }

// 201 Created
{
  "booking_id": "BK-20261024-0031",
  "status": "pending_confirmation",
  "machinery": { "id": "SS-08", "type": "super_seeder", "operator_phone": "98140-XXXXX", "distance_km": 2.1 },
  "rental_rate_inr_per_acre": 750,
  "rate_source": "partner_contract:PC-0007"
}
```

---

## 9. Event Specification

| Event | Producer | Consumers | Key payload |
| --- | --- | --- | --- |
| `data.normalised` | Ingestion | Risk, Forecast | source, grid_id, window, quality_flags |
| `risk.updated` | Risk | Advisory, FPO UI | parcel_id, score, tier |
| `forecast.updated` | Forecast | Health, Municipal | grid_id, horizon_h, pm25_series, fallback_flag |
| `attribution.updated` | Forecast | Municipal | region, shares{straw, vehicle, dust, industrial} |
| `booking.created` | Advisory | Machinery CRM, UI | booking_id, parcel_id, machinery_id |
| `advice.updated` | Health | Citizen PWA | community_id, profile, advice[] |
| `route.computed` | Health | Citizen PWA | from, to, options[] |
| `workorder.created` | Municipal | Supervisor portal | work_order_id, action_type, location, due_by |
| `workorder.completed` | Supervisor portal | Municipal, ROI | work_order_id, completed_at, gps_cell |
| `roi.measured` | Municipal | Dashboard, ROI store | work_order_id, delta_pm25, method |

Every event carries `event_id` (UUID), `trace_id`, `schema_version`, `emitted_at`. Consumers are idempotent on `event_id`.

---

## 10. Integrations

| Partner | Direction | Mechanism | Notes |
| --- | --- | --- | --- |
| Exotel (primary), Twilio (standby) | Outbound calls; inbound webhooks | REST + signed webhooks | DTMF 1, 2, 9, then 1 (confirm) or 0 (back). Behind `TELEPHONY_ENABLED` |
| Bhashini | Outbound TTS (optional) | REST | Behind `TTS_PROVIDER=bhashini`. Cached by script hash |
| Pre-recorded audio library | Internal | File store | Default TTS path |
| Machinery CRM | Bidirectional | REST + polling | Optimistic locking on `version` |
| Bio-CNG / briquette partners | Outbound requests; inbound receipts | REST + webhook | Weighbridge receipts reconciled to FPO ledger |
| Traffic authorities | None | Export only (ADR-14) | PDF downloaded by officer |
| MCD | None | Supervisor portal (ADR-15) | No external API dependency |

### 10.1 Telephony failover

- Health-check the active provider every 30 s.
- After three consecutive failures, new calls route to the standby and an alert fires.
- Calls in progress are not dropped. Their status events are reconciled once the provider recovers.

### 10.2 Telephony compliance

- Every call opens with a disclosure line naming the platform and the caller. Scripts are stored and versioned.
- Calls are placed only within permitted hours set in config (default 08:00–19:00 IST).
- Per-parcel caps apply (section 11).

---

## 11. Security and Compliance

- **Secrets:** HashiCorp Vault or cloud KMS-backed manager. Never committed.
- **Encryption:** TLS 1.2+ in transit. AES-256 at rest.
- **PII:** farmer phone numbers masked at the API boundary (ADR-06). Photos stripped of EXIF except GPS (ADR-12).
- **Audit log:** append-only, hash-chained. Covers directives, approvals, bookings, calls, work-order events, flag changes, config changes, and exports.
- **Rate limits:** per parcel, 2 calls per 24 h by default. Configurable.
- **RBAC:** enforced in FastAPI dependencies. Each endpoint's role set is tested in contract tests.
- **Dependency and container scanning:** in CI.
- **Threat model:** written before pilot (T6.10).

---

## 12. Front-End Specification

### 12.1 Shared requirements

- React, TypeScript, Vite, Tailwind CSS, Three.js, GSAP, Mapbox GL.
- i18n: English, Punjabi, and Hindi from the start. Farmer interface must be complete in Punjabi and Hindi.
- WCAG 2.1 AA. Citizen PWA, farmer simulator, and supervisor portal work at 360 px.
- Real-time via WebSocket, polling fallback.
- Attribution footer on every screen that shows derived data (ADR-20).
- Each screen implements loading, empty, error, and offline states.

### 12.2 Interface details

**Policy dashboard (`/policy`)**
- Status bar; 2×2 panels; directive toolbar.
- Panels: attribution (donut or stacked bar), 72 h plume (Mapbox with scrubber), compliance and ROI, pipeline health.
- Directive buttons open a confirmation modal. A second approver is requested before export.

**FPO screen (`/fpo`)**
- Machinery cards with utilisation bars.
- Biomass panel: buy-back rate (only if contract active), tonnes removed, cumulative acres.
- High-risk table: sortable and filterable by village and tier.
- Call panel: live log, intent summary, matched machinery, "Trigger voice call" (disabled when `TELEPHONY_ENABLED` is off), "Assign baler on-site".

**Farmer simulator (`/farmer`)**
- Phone frame. Language toggle (ਪੰਜਾਬੀ / हिंदी / English), default by browser locale.
- Caller ID, timer, play/pause with waveform, synced subtitles.
- Keypad: 1 (book Super Seeder), 2 (collection request), 9 (FPO worker queue or callback slot per ADR-22); then 1 to confirm or 0 to go back (ADR-09).
- Keyboard and screen-reader operable.

**Citizen PWA (`/citizen`)**
- Location header with manual neighbourhood switch.
- Community AQI card with source mix.
- Health profile selector; advice varies by profile and time.
- Time-windowed alerts (for example, 06:00–10:30 inversion warning).
- Clean commute planner with two options and percentage reduction.
- Snap-and-report: camera, GPS, category, reference ID.
- Disclaimer from config (ADR-18). Push alerts only when `PUBLIC_ALERTS_ENABLED`.
- Manifest, service worker, offline snapshot, install prompt.

**Supervisor portal (`/ops`)**
- Work-order list for the supervisor's area, sorted by due time.
- Accept, then complete with a photo taken in-app and GPS attached.
- Offline queue: completion submissions wait in the device queue and sync when online.
- Shows the ROI result for each completed order once measured.

---

## 13. Observability, Errors, and Operations

- **Tracing:** OpenTelemetry spans across agents, API, and integrations. `trace_id` on every log line and event.
- **Metrics:** request latency and error rate per endpoint; event lag per consumer; call success and DTMF capture rate; ingestion freshness; ROI pipeline lag.
- **Dashboards:** one per service plus a pilot overview.
- **Alerts:** freshness breach, consumer lag above threshold, telephony failover triggered, error budget burn, audit chain verification failure.
- **Error handling:** every external call has timeout, bounded retry with jitter, and a circuit breaker. Failed events go to a dead-letter stream and are visible in the admin view.
- **Degraded modes:** if CAMS is late, the forecast uses the last good grid and sets `fallback_flag`. If Bhashini is down, the audio library is used. If telephony is down, the failover applies.

---

## 14. Repository Structure

```
vayu-swachh/
├── apps/
│   ├── web/                          # React front end
│   │   ├── src/
│   │   │   ├── routes/               # policy, fpo, farmer, citizen, ops
│   │   │   ├── design-system/
│   │   │   ├── api-client/           # generated from OpenAPI
│   │   │   ├── mocks/
│   │   │   ├── i18n/                 # en, pa, hi
│   │   │   └── pwa/
│   │   └── tests/
├── services/
│   ├── ingestion/                    # FIRMS, Sentinel-2, CPCB, CAMS, ERA5, OSM, CRM
│   ├── agents/
│   │   ├── common/
│   │   ├── ingestion_agent/
│   │   ├── risk_agent/
│   │   ├── forecast_agent/
│   │   ├── advisory_agent/
│   │   ├── health_agent/
│   │   └── municipal_agent/
│   ├── api/
│   └── integrations/
│       ├── telephony/                # Exotel + Twilio adapter
│       ├── audio/                    # pre-recorded library + Bhashini TTS
│       ├── machinery_crm/
│       └── biocng/
├── packages/
│   ├── domain/                       # risk, attribution, dose, GRAP, ROI (pure Python)
│   └── contracts/                    # OpenAPI and event JSON Schema
├── config/                           # versioned YAML
│   ├── features.yaml
│   ├── risk_weights.yaml
│   ├── partner_rates.yaml
│   ├── grap_tiers.yaml
│   └── disclaimers.yaml
├── db/
│   └── migrations/
├── infra/
│   ├── docker/
│   ├── k8s/
│   ├── terraform/
│   └── observability/
├── tests/
│   ├── unit/
│   ├── integration/                  # recorded partner fixtures
│   ├── contract/
│   ├── load/                         # k6
│   └── security/                     # threat-model checks
├── docs/
│   ├── runbook.md
│   ├── data-licences.md
│   ├── threat-model.md
│   └── adr/
└── .github/workflows/
```

---

## 15. Implementation Tasks

Tasks are ordered by dependency. Each has an acceptance criterion. Finish a task and its tests before starting a dependent one.

### Phase 0: Foundations

**T0.1: Monorepo.**
- Create the structure in section 14.
- Python 3.12 (uv or Poetry), pnpm for the front end.
- Lint (ruff, eslint), type-check (mypy strict, tsc strict), pre-commit hooks.
- *Acceptance:* `make lint type test` passes on the empty project.

**T0.2: Local infrastructure.**
- `docker-compose.yml`: PostgreSQL 16 with PostGIS and TimescaleDB, Redis 7, MinIO, OpenTelemetry collector, Prometheus, Grafana.
- *Acceptance:* `docker compose up` gives healthy services; smoke script connects to each.

**T0.3: Settings and secrets.**
- Pydantic Settings from environment. Local vault stub. Secret scanner in pre-commit.
- *Acceptance:* missing settings fail fast; secret scanner blocks a test commit.

**T0.4: Feature flags.**
- Load `config/features.yaml` with defaults from section 3. Read at runtime. Changes audited.
- Two-person approval for flags marked externally facing (`PUBLIC_ALERTS_ENABLED`, `TELEPHONY_ENABLED`).
- *Acceptance:* a flag change without approval is rejected; flag changes appear in the audit log.

### Phase 1: Data and Schema

**T1.1: Migrations.**
- Enable PostGIS and TimescaleDB. Create spatial, time-series, and operational tables from section 7.2 (including `data_source`, `partner_contract`, `partner_rate`, `work_order_event`, `outbox_event`, `forecast_grid`).
- Audit table with hash chaining.
- *Acceptance:* up and down migrations succeed on a clean DB; hypertables and spatial indexes verified; audit chain verifies.

**T1.2: Contracts.**
- OpenAPI 3.1 spec for section 8. JSON Schema for section 9 events.
- TypeScript client generated into `apps/web/src/api-client`.
- *Acceptance:* spec validates; client compiles; generation runs in CI.

**T1.3: Domain library.**
- Pure functions in `packages/domain`: `risk_score`, `tier`, `attribution` (sum invariant, fallback flag), `dose`, `exposure_reduction`, `grap_tier`, `did_delta` (difference-in-differences), `synthetic_control_delta`, `roi_aggregate`.
- *Acceptance:* unit tests per function; Hypothesis property tests for attribution sum and dose non-negativity; GRAP golden table; DiD tested on a synthetic dataset with a known effect.

**T1.4: Ingestion connectors.**
- Connectors with recorded fixtures: NASA FIRMS, Sentinel-2 (NDVI), CPCB via data.gov.in, CAMS, ERA5, OpenStreetMap extract, low-cost IoT, machinery CRM.
- Raw to object storage; normalised to database.
- Drift calibration and spatiotemporal gap-filling for sensors.
- Sentinel-2 NDVI runs as a scheduled 5-day job (ADR-23), not inside the 15-minute cycle; observations carry scene id, date and cloud cover.
- Quality metrics (section 7.4) exposed, including NDVI age.
- *Acceptance:* each connector passes fixture tests; quality metrics queryable; the NDVI job skips scenes above 40% cloud and the source turns `degraded` when the newest observation is older than 8 days.

**T1.5: Fire clustering.**
- Cluster FIRMS hotspots per village.
- *Acceptance:* deterministic output on a fixture; each cluster assigned to a village polygon.

**T1.6: Pilot baseline.**
- Load 2023–2025 October–November FIRMS hotspots for Sangrur villages into `fire_hotspot`. Load CPCB history for Anand Vihar and Patparganj stations, and for the Delhi control stations.
- Pre-period trend check to confirm controls are comparable.
- Versioned snapshot ID.
- *Acceptance:* snapshot reproducible from its ID; baseline distributions stored; control set and pre-period check recorded in `docs/adr/` as an ADR.

**T1.7: Data source registry.**
- Populate `data_source` from section 7.1 with licence, attribution, and redistribution rule. Generate `docs/data-licences.md` from it.
- *Acceptance:* every ingestion connector refuses to run if its source is missing from the registry.

### Phase 2: Agent Core

**T2.1: Agent runtime library.**
- Redis Streams bus client with consumer groups and acknowledgement.
- Outbox writer and replay.
- Idempotency store keyed on `event_id`.
- Structured logs with `trace_id`. Health endpoint per agent. Dead-letter stream.
- *Acceptance:* replayed event processed once; crash mid-handler re-delivers and completes; DLQ receives poison messages.

**T2.2: Data Ingestion Agent.**
- Subscribes to ingest triggers; publishes `data.normalised`.
- *Acceptance:* one event per grid window; duplicate input yields no duplicate event.

**T2.3: Stubble Fire Risk Agent.**
- Activated 7–10 days before harvest per village.
- Phase 1 scoring via `packages/domain` with weights from `config/risk_weights.yaml`.
- Publishes `risk.updated`. FPO list served through the API.
- *Acceptance:* tier boundaries tested; activation window tested with an injected clock; reproduces fixture scores.

**T2.4: Forecast and Attribution Agent.**
- Ingest CAMS grids and ERA5 meteorology. Correct with CPCB observations.
- Downscale to 1 km with kriging and external drift (road density and land use from OpenStreetMap).
- Attribution through `packages/domain`, with fallback flag where speciation is missing.
- 72 h HYSPLIT wrapper producing arrival times per street segment.
- Degraded mode: if CAMS is late, reuse the last good grid and set `fallback_flag`.
- Publishes `forecast.updated` and `attribution.updated`.
- *Acceptance:* attribution invariant holds on every output; degraded-mode path tested; RMSE measured against held-out CPCB readings and reported.

**T2.5: Farmer Advisory and Logistics Agent.**
- Generates Punjabi and Hindi scripts (templated, economics-first per ADR-08).
- Buy-back line included only if an active `partner_contract` exists for the area.
- Matches machinery by proximity and availability. Arranges collection requests.
- Subscribes to `risk.updated`. Publishes `booking.created`.
- *Acceptance:* no punitive wording (blocked-word lint); buy-back line absent when no contract; booking idempotent on parcel and machinery.

**T2.6: Personalised Health Advisory Agent.**
- Dose integral along routes. Profile rules (asthma/COPD, child, elderly, outdoor worker, general) in versioned config.
- Clean commute selection with configurable time limit.
- Disclaimer text from `config/disclaimers.yaml` (ADR-18).
- Subscribes to `forecast.updated`. Publishes `advice.updated` and `route.computed`.
- *Acceptance:* advice differs by profile in fixtures; route reduces dose within the time limit; disclaimer present on every advice payload.

**T2.7: Municipal Action Agent.**
- Maps attribution and peaks to GRAP tiers.
- Creates work orders with `due_by`. Publishes `workorder.created`.
- Consumes `workorder.completed`. Schedules ROI measurement 4–12 h later. Publishes `roi.measured`.
- Diversion recommendations are created as directives, which need second approval (ADR-07).
- *Acceptance:* diversion cannot be exported without second approval; ROI uses DiD with matched controls; a work order cannot skip `accepted`.

**T2.8: Calibration analysis script (offline).**
- Runs under `CALIBRATION_MODE`. Fits candidate risk weights to pilot data and writes a report. Never writes config directly.
- *Acceptance:* report reproduces on the frozen baseline; config unchanged after a run.

### Phase 3: API Layer

**T3.1: FastAPI skeleton.**
- App factory, routers, RBAC dependency, Problem Details, pagination, tracing, feature-flag dependency.
- *Acceptance:* generated OpenAPI matches T1.2 (diff test in CI).

**T3.2: Read endpoints.**
- `/aqi/grid`, `/aqi/community/{id}`, `/plume/projection`, `/attribution/summary`, `/roi/summary`, `/pipeline/health`, `/machinery/status`, `/health/advice`, `/routes/clean`, `/admin/features`.
- *Acceptance:* schemas match contract; 403 tests for each role.

**T3.3: Farmer and FPO endpoints.**
- `/risk/parcels`, `/calls/trigger`, `/calls/{id}/log`, `/bookings`, `/bookings/{id}/confirm`, `/collections/request`.
- Phone masking in the serialiser (ADR-06).
- Rate limits per parcel.
- *Acceptance:* unmasked numbers never appear except in the permitted booking case; rate limit refuses the N+1th call with a reason; `/calls/trigger` returns 503 with a clear reason when telephony is off.

**T3.4: Directives and export.**
- `/directives`, `/directives/{id}/approve`, `/directives/{id}/export`.
- Creator cannot approve their own directive. Audit entry written before the directive can be exported.
- PDF signed with the platform signing key (kept in the vault).
- *Acceptance:* self-approval refused; export refused before approval; signature verifies; export refused when `ADVISORY_EXPORT_ENABLED` is off.

**T3.5: Citizen report endpoint.**
- `/reports/photo`: multipart upload, EXIF strip, GPS to 100 m cell, reference ID.
- *Acceptance:* stored file has no EXIF except the coarse cell; reference retrievable; photo deleted at 90 days (retention job test).

**T3.6: Work-order endpoints.**
- `/work-orders`, `/work-orders/{id}/accept`, `/work-orders/{id}/complete`.
- Completion requires photo and GPS. Photo stripped under ADR-12.
- *Acceptance:* completion before acceptance refused; each transition writes `work_order_event`.

**T3.7: WebSocket.**
- `/ws/live` with channels from section 8.2. Auth on connect; channel authorisation by role.
- *Acceptance:* `alert.fired` delivered within 1 s in an integration test; unauthorised channel refused.

### Phase 4: Integrations

**T4.1: Telephony adapter.**
- Adapter interface. Exotel and Twilio implementations.
- Signed webhooks for call status and DTMF (0, 1, 2, 9).
- Health check and failover (section 10.1). Disclosure line and calling hours (section 10.2).
- Transcript and intent summary stored; recordings retained per section 7.3.
- *Acceptance:* menu 1 then confirm 1 books the machine, 0 books nothing; failover tested with simulated outage; in-progress calls not dropped; calls refused outside permitted hours.

**T4.2: Audio library and Bhashini.**
- Audio library: clips keyed by SHA-256 of the normalised script. Native speakers record the Punjabi and Hindi scripts before the pilot.
- Bhashini TTS adapter behind `TTS_PROVIDER=bhashini`, cached by the same key.
- Remove any ASR code path.
- *Acceptance:* every script in the templates has a clip; with Bhashini off, calls play entirely from the library; second Bhashini request for the same script hits the cache.

**T4.3: WhatsApp integration (removed).**
- Dropped from scope: farmers confirm on the keypad (ADR-09), so there is no WhatsApp sender, template registry or flag.

**T4.4: Machinery CRM sync.**
- Pull status and push bookings with optimistic locking on `version`.
- Version mismatch re-reads and sends the conflict to the FPO queue.
- *Acceptance:* concurrent booking yields exactly one success and one conflict.

**T4.5: Bio-CNG and briquette partners.**
- Partner contracts and rates in tables (ADR-17). Collection request sender.
- Weighbridge receipt webhook. Ledger reconciliation with mismatch items.
- *Acceptance:* a matching receipt reconciles; mismatched weight raises a reconciliation item; no rate is returned for an area without an active contract.

**T4.6: Traffic advisory export.**
- Generates the signed PDF advisory from an approved directive (T3.4).
- No outbound transmission. Export logged in the audit trail.
- *Acceptance:* PDF contains the directive ID, area, action, both approvers, and the disclaimer; no network call to any external traffic system exists in the codebase (asserted by a test).

**T4.7: Rate limiting.**
- Redis-backed per-parcel caps for calls.
- *Acceptance:* caps enforced across instances in a load test.

### Phase 5: Front End

**T5.1: Scaffold and design system.**
- Vite, React, TypeScript, Tailwind, router with five routes, i18n (en, pa, hi), AQI colour tokens, typography, spacing.
- *Acceptance:* routes render; language switch works; tokens exported.

**T5.2: Mock layer.**
- Fixtures for every endpoint including work orders and feature flags. `VITE_API_MODE=mock|live`.
- *Acceptance:* every screen renders from fixtures with no backend.

**T5.3: Policy dashboard.**
- Panels, status bar, directive toolbar with confirmation modal and export button.
- 72 h scrubber drives the plume overlay.
- *Acceptance:* confirmation required before a directive is submitted; export available only after approval; scrubber updates arrival times.

**T5.4: FPO screen.**
- Machinery cards, biomass panel (rate shown only with contract), sortable risk table, call panel.
- *Acceptance:* sort and filter work; masked format `NNNNN-XXXXX`; call button disabled when telephony is off.

**T5.5: Farmer simulator.**
- Phone frame, language toggle, audio with synced subtitles, keypad with tone and confirmation.
- *Acceptance:* keypad flow unit-tested; 360 px layout checked; keyboard-only completion possible; Punjabi and Hindi complete.

**T5.6: Citizen PWA.**
- Location, AQI card, advice, alerts, commute planner, snap-and-report, disclaimer.
- Manifest, service worker, offline snapshot, install prompt.
- *Acceptance:* offline shows last snapshot; Lighthouse PWA passes; exposure percentage matches fixture; push alerts absent when flag off.

**T5.7: Real-time.**
- WebSocket client with reconnect and polling fallback on all interfaces.
- *Acceptance:* socket kill switches to polling within 10 s and recovers.

**T5.8: Supervisor portal.**
- Work-order list, accept, complete with in-app photo and GPS, offline queue with sync, ROI result display.
- *Acceptance:* completion works offline and syncs once; duplicate sync does not create a second completion event.

### Phase 6: Testing, Operations, and Launch Readiness

**T6.1: Contract tests.**
- Each endpoint's schema checked against client types and recorded responses. Breaking changes fail CI.

**T6.2: End-to-end tests.**
- Playwright: policy directive with approval and export; FPO call trigger (with telephony mocked); farmer keypad 1; citizen route planner; supervisor accept and complete.
- *Acceptance:* all pass against staging.

**T6.3: Load tests.**
- k6: 200 concurrent WebSocket clients; 1,000 REST requests per minute.
- *Acceptance:* p95 REST under 300 ms; WebSocket delivery under 1 s p95.

**T6.4: Containers and Kubernetes.**
- Multi-stage non-root Dockerfiles. Manifests with limits, probes, and HPA for the API.
- *Acceptance:* services deploy to a local cluster and pass probes.

**T6.5: Terraform.**
- Modules: managed PostgreSQL with extensions, Redis, object storage, Kubernetes, secrets manager, observability stack.
- *Acceptance:* `terraform plan` clean for staging.

**T6.6: CI/CD.**
- Lint, type-check, tests, contract diff, container build, security scan, staging deploy, smoke tests, manual approval, production promotion.
- *Acceptance:* green pipeline on a sample change; production requires approval.

**T6.7: Runbook.**
- On-call; GRAP escalation; telephony failover; outbox replay; directive rollback; flag rollback; data pipeline recovery.
- *Acceptance:* reviewed by someone who did not write it, who walks through the failover and replay steps.

**T6.8: Observability.**
- Dashboards and alerts from section 13 deployed and tested with injected faults.
- *Acceptance:* each alert fires in a fault drill.

**T6.9: Privacy and retention jobs.**
- Retention jobs for photos, recordings, and raw data (section 7.3).
- *Acceptance:* test data past retention is deleted; audit shows the deletion.

**T6.10: Threat model and security review.**
- Written in `docs/threat-model.md`. Covers spoofed calls, DTMF replay, directive forgery, phone enumeration, photo metadata leakage, and webhook spoofing.
- *Acceptance:* each threat has a control and a test.

**T6.11: Pilot evaluation plan.**
- Written plan for ROI, fire reduction, RMSE, utilisation, and response time: method, data, and reporting cadence. Uses section 18 metrics.
- *Acceptance:* plan approved by the pilot team.

---

## 16. Definition of Done

A task is done when:
1. Code is merged behind passing CI (lint, types, tests, security scan).
2. Acceptance criteria are demonstrated.
3. Any new decision is recorded as an ADR in `docs/adr/`.
4. Public API changes are reflected in the OpenAPI spec and generated client.
5. No secrets, unmasked farmer numbers, or citizen EXIF data appear in logs, fixtures, or exports.
6. New data sources are registered in `data_source` with their licence.

---

## 17. Launch Gates

Build and pilot testing run without these gates. The gates control only when external features are switched on.

| Gate | Controls | Pass condition | Owner |
| --- | --- | --- | --- |
| G1 Telecom compliance | `TELEPHONY_ENABLED` | Exotel and Twilio accounts live; DLT approvals recorded; disclosure script approved | Pilot operations |
| G2 Legal sign-off | `PUBLIC_ALERTS_ENABLED`, advisory export to external officers | Legal approves disclaimers (`config/disclaimers.yaml`), advisory format, and signing method | Legal |
| G3 Partner contract | Buy-back line in farmer scripts | Signed contract and rate row for each area | FPO and partners |
| G4 FPO worker capacity | Keypad 9 queue | Staffed roster in pilot hours, or callback slots configured | FPO coordinators |
| G5 Licence check | Public release of derived data | Attribution text verified for every source in `data-licences.md` | Data lead |
| G6 Accuracy review | Forecast use in public advice | Pilot RMSE and fallback usage reported to the review board | Modelling lead |

Gates are recorded as flag changes in the audit log, using the approval flow from T0.4.

---

## 18. Pilot Metrics

| Metric | Target | Method | Source |
| --- | --- | --- | --- |
| Pre-emptive fire intervention | Active fires in pilot villages down ≥ 40% vs same-period baseline | FIRMS comparison with 2023–2025 baseline | FIRMS |
| Machinery utilisation | ≥ 85% | PTO and GPS operating-hour logs | Machinery CRM |
| Net farmer income gain | ≥ ₹1,500/acre vs burning | FPO bank statements and partner weighbridge receipts | FPO, partners |
| Forecast accuracy | 24 h PM2.5 RMSE < 25 µg/m³ | Held-out CPCB readings; fallback usage reported | CPCB via OGD |
| Exposure reduction for sensitive groups | ≥ 25% lower dose on heavy-pollution days | Dose model with route choice and timing | Platform |
| Municipal response time | < 60 min from warning to on-site deployment | Supervisor portal timestamps | Portal |
| Measured street-level reduction | Reported per work order | DiD with matched controls, synthetic control as check | CPCB via OGD |

---

## 19. Glossary

- **AQI:** Air Quality Index.
- **CAMS:** Copernicus Atmosphere Monitoring Service.
- **CAQM:** Commission for Air Quality Management in NCR.
- **CAAQMS:** Continuous Ambient Air Quality Monitoring Stations.
- **CHC:** Custom Hiring Centre.
- **CPCB / SPCB:** Central / State Pollution Control Board.
- **DiD:** Difference-in-differences.
- **DLT:** Distributed Ledger Technology registry for commercial SMS in India (TRAI).
- **DTMF:** Dual-tone multi-frequency (keypad signals).
- **ERA5:** ECMWF reanalysis dataset.
- **FIRMS:** Fire Information for Resource Management System (NASA).
- **FPO:** Farmer Producer Organisation.
- **GRAP:** Graded Response Action Plan.
- **HYSPLIT:** Hybrid Single-Particle Lagrangian Integrated Trajectory model.
- **NDVI:** Normalised Difference Vegetation Index.
- **OGD:** Open Government Data platform (data.gov.in).
- **ODbL:** Open Database Licence (OpenStreetMap).
- **PBL:** Planetary Boundary Layer.
- **PM2.5 / PM10:** Particulate matter ≤ 2.5 µm / ≤ 10 µm.
- **RBAC:** Role-based access control.
- **RMSE:** Root mean square error.
- **ROI:** Return on investment.
- **SAFAR:** System of Air Quality and Weather Forecasting and Research.
- **SLA:** Service-level agreement.
- **Super Seeder / Happy Seeder:** Machines that sow wheat into residue-covered fields.
- **Bio-CNG:** Compressed biogas from biomass.
