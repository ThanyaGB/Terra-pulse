# How IBM Bob Was Used in Vayu-Swachh

IBM Bob served as the primary AI coding assistant throughout the entire lifecycle of Vayu-Swachh — from the very first planning conversation to the final deployment manifests. This document explains exactly how Bob was used at each stage, which features were most valuable, and the development workflows it enabled.

---

## 1. Planning and Spec Authoring in Bob's Plan Mode

The project began with nothing but a problem statement: connect crop-residue fire risk in Punjab to street-level health alerts and municipal response in Delhi-NCR. Before writing a single line of code, the team used **IBM Bob's Plan Mode** to think through the entire system.

In Plan Mode, Bob engaged in a structured architectural discussion covering:

- **Product scope** — which user groups to serve (CAQM policy officers, FPO coordinators, farmers, and Delhi citizens), what each interface needed to do, and what the pilot geography should be (Sangrur upstream, Anand Vihar and Patparganj downstream).
- **Architecture decisions** — Bob helped evaluate and articulate 12 Architecture Decision Records (ADRs): multi-agent vs monolith, Redis Streams vs Kafka for the event bus, FastAPI vs Django, mock-first front end, phone-number masking policy, two-person approval for diversion orders, economics-first farmer communication, and more.
- **Domain logic** — the team described the mathematical relationships (fire risk scoring, source attribution, exposure dose integral, GRAP tier mapping, ROI measurement) and Bob helped formalise them into precise function signatures and invariants.
- **Data flows** — Bob mapped out which agents produce which events, which consumers subscribe, and what the event envelope should contain.
- **API contract** — all 18 REST endpoints and the WebSocket channels were designed collaboratively in Plan Mode before any backend code existed.
- **Implementation task ordering** — Bob broke the work into 62 ordered tasks across 7 phases, each with a concrete acceptance criterion, surfacing dependencies and sequencing risks.

The output of this planning session became [`vayu-swachh-spec.md`](../vayu-swachh-spec.md) — a 730-line single source of truth that governed every subsequent coding decision. Plan Mode was the right tool for this stage because it prioritised thinking and discussion over generating code, allowing the team to stress-test the design before committing to it.

---

## 2. Spec-to-Code Translation in Agent Mode

Once the spec was locked, the team switched to **Agent Mode** for all implementation work. Bob held the full specification in context and translated it into working code phase by phase, using the acceptance criteria from the spec as the definition of done for each task.

A key advantage was that Bob never needed the context re-explained. It referenced the correct section number, formula, table, or ADR at every step — and it enforced the project's own architectural rules (masking, idempotency, no punitive wording, two-person approval) across every file it touched, without reminders.

---

## 3. Monorepo Scaffolding and Toolchain (Phase 0)

Bob created the full monorepo skeleton from scratch:

- **Python toolchain** — `pyproject.toml` with ruff (lint), mypy `--strict` (type-check), pytest, and Pydantic Settings configured to fail fast on missing environment variables.
- **Node toolchain** — `pnpm` workspace, `tsconfig.json` in strict mode, Vitest for unit tests.
- **Pre-commit hooks** — secret scanner (detect-secrets), ruff autofix, mypy, and `tsc --noEmit` wired together in `.pre-commit-config.yaml`.
- **Makefile** — unified `make lint type test` and `make contracts-check` targets spanning both languages.
- **Docker Compose** — PostgreSQL 16 (PostGIS + TimescaleDB), Redis 7, MinIO, with a smoke-test script that verifies each service is healthy on startup.

The full quality gate was green before any domain code existed.

---

## 4. Domain Logic and Property-Based Testing (Phase 1)

The spec defined five pure mathematical functions. Bob implemented all of them in `packages/domain/` and wrote the tests:

- `risk_score(inputs, weights)` — configurable YAML weights, no hard-coded numbers.
- `attribution(sources)` — sum-to-100% invariant enforced and verified as a **Hypothesis property test** (Bob chose property-based testing unprompted, recognising the mathematical constraint).
- `dose(route_segments, activity_profile)` — discretised exposure integral with a non-negativity property test.
- `grap_tier(aqi, attribution)` — GRAP tier mapping from a versioned YAML, validated against a golden table.
- `delta_pm25(pre, post)` and ROI aggregation.

Bob also built six real-data ingestion connectors (NASA FIRMS, Sentinel-2, CPCB, IoT, IMD, machinery CRM), each with recorded HTTP fixtures so integration tests run fully offline.

---

## 5. Multi-Agent Architecture (Phase 2)

Six independent agents communicate exclusively through Redis Streams. Bob built the entire layer:

- **Common runtime** (`services/agents/common/`) — Redis Streams bus client, idempotency store (deduplication on `event_id`), PostgreSQL outbox for durable event history, `trace_id` propagation, and per-agent health endpoints.
- **Six agent workers** — Ingestion, Stubble Fire Risk, Forecast & Attribution, Farmer Advisory & Logistics, Personalised Health Advisory, and Municipal Action.
- **`MemoryBus`** — an in-process bus implementation so every agent test runs without a Redis server.
- **Farmer script lint rule** — validates generated Punjabi and Hindi IVR scripts against a blocked-word list; punitive language fails the build.
- **Two-person approval state machine** — diversion orders cannot be dispatched without a second `policy_officer` sign-off; tests assert the same officer cannot approve their own directive.

---

## 6. FastAPI Layer — 18 Endpoints, RBAC, Audit (Phase 3)

Bob generated all 18 REST endpoints and the `/ws/live` WebSocket, including RBAC dependency injection with a full 403 matrix test, phone-number masking at the serialiser layer, an append-only audit log with hash chaining, EXIF stripping on citizen photo uploads, RFC 9457 Problem Details errors, and paginated responses throughout. The OpenAPI output was diff-checked against the contract in CI so any schema drift is caught immediately.

---

## 7. Integration Adapters (Phase 4)

Seven adapters were built against test doubles — no live credentials required:

- **Telephony** (Twilio / Exotel) with an automatic failover state machine that switches providers on three consecutive health-check failures without dropping in-progress calls.
- **Bhashini** ASR/TTS with an SHA-256 audio cache to avoid redundant provider calls on repeated scripts.
- **WhatsApp** template sender that rejects unapproved templates at the code level.
- **Machinery CRM** with optimistic locking and a conflict handler that surfaces booking collisions to the FPO queue.
- **Bio-CNG**, **Traffic**, and **MCD** adapters with per-parcel Redis-backed rate limits.

---

## 8. React Front End — Four Interfaces (Phase 5)

Bob built the complete front end including a mock layer that lets all four interfaces run with zero backend (`VITE_API_MODE=mock`):

- `/policy` — source attribution panels, 72 h plume scrubber over Mapbox, directive toolbar with a confirmation modal.
- `/fpo` — machinery status cards, sortable/filterable risk table, masked phone numbers (`NNNNN-XXXXX`), live call log.
- `/farmer` — phone-frame component with language toggle (ਪੰਜਾਬੀ / हिंदी / English), waveform audio, synced subtitles, and a keypad fully operable by keyboard and screen reader.
- `/citizen` PWA — AQI card, profile-based health advice, time-windowed alerts, clean commute planner, snap-and-report camera flow, service worker with offline snapshot, Lighthouse PWA compliance.

The TypeScript API client was generated from the OpenAPI spec so front-end and backend types are always in sync.

---

## 9. Testing, CI/CD, and Ops (Phase 6)

Bob wrote every layer of the test and delivery pyramid: Playwright end-to-end tests for all four interfaces, k6 load scripts for 200 concurrent WebSocket clients and 1,000 REST requests per minute, multi-stage non-root Dockerfiles, Kubernetes manifests with HPA, Terraform modules for all managed infrastructure, a full GitHub Actions pipeline (lint → type-check → tests → contract diff → build → staging deploy → smoke tests → manual approval → production promote), and an on-call runbook.

---

## 10. Key IBM Bob Features Used

| Feature | How it was used in Vayu-Swachh |
| --- | --- |
| **Plan Mode** | Designed the entire system, authored all 12 ADRs, defined the API contract, and produced the full implementation spec before any code was written. |
| **Agent Mode** | Implemented all 7 phases — 62 tasks — translating spec acceptance criteria directly into code and tests. |
| **Long-context retention** | Bob held the 730-line spec in context throughout, referencing the correct section, formula, or ADR at every step without re-prompting. |
| **Multi-file edits** | A single task often spanned a domain function, its tests, the API router, the OpenAPI spec, and the CI diff check — Bob applied all changes in one coherent pass. |
| **Test-first discipline** | Acceptance-criterion tests were written alongside every implementation, matching the spec's "complete a task and its tests before starting the next" rule. |
| **Todo tracking** | Bob maintained a live checklist across the build, marking each phase complete only after its criteria were met. |
| **Language breadth** | A single project spanned Python 3.12, TypeScript, SQL (PostGIS/TimescaleDB), YAML, HCL (Terraform), and k6 JavaScript — Bob switched fluently between all of them. |
| **Architectural consistency** | Bob enforced every ADR (masking, idempotency, no punitive wording, two-person approval) across every file without needing repeated reminders. |
