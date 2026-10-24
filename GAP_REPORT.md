# Gap report: repo (built on spec v1.0) vs spec v2.0

Written before any v2.0 code change. Baseline: `pytest -m "not live"` = 121 passed, 1 skipped.
Status is judged against the section 15 acceptance criteria, not just file existence.

| # | Item | Status | Evidence | What is missing |
| --- | --- | --- | --- | --- |
| 1 | Feature flags, two-person approval (T0.4) | MISSING | No `config/` directory, no `features.yaml`, no `/admin/features`. `grep -ri features services` finds nothing. | Everything. |
| 2 | Telephony: Exotel primary, Twilio standby (ADR-13, T4.1) | PARTIAL | `services/integrations/telephony/__init__.py` has Exotel and Twilio providers, signed webhooks, failover after 3 failures. `services/api/app.py` wires `FakeProvider` and defaults `telephony_primary` to `twilio` (`services/api/settings.py`). | Exotel is not the default. No `TELEPHONY_ENABLED` gate on `/calls/trigger`. No calling-hours check (08:00-19:00 IST). No disclosure line. |
| 3 | Audio: library default, Bhashini behind `TTS_PROVIDER`, no ASR (ADR-10, T4.2) | PARTIAL | `services/integrations/bhashini/__init__.py` has SHA-256 cache and TTS. | `BhashiniClient.transcribe` is an ASR path (must go). No pre-recorded library, no `TTS_PROVIDER`, no static DTMF prompt fallback. |
| 4 | Partner rates from config/tables; buy-back line conditional (ADR-17, T4.5) | MISSING | Rates are hard-coded in `packages/domain/config/farmer_scripts_v1.yaml` (`prices`) and always rendered by `render_script` in `services/agents/advisory_agent/__init__.py`. `request_collection` and `/collections/summary` always return the floor price. | `config/partner_rates.yaml`, `partner_contract` and `partner_rate` tables, active-contract lookup, conditional script line. |
| 5 | Traffic: no transmission, signed PDF, `GET /directives/{id}/export` (ADR-14, T4.6, T3.4) | PARTIAL | `services/api/directives.py` has two-person approval, self-approval refusal, audit before dispatch. `services/integrations/traffic/__init__.py` is a sender with a `transport` hook. | The sender contradicts ADR-14. No PDF, no signing, no export endpoint, no `ADVISORY_EXPORT_ENABLED` check, no no-network test. Directive dispatch for non-diversion types should stay. |
| 6 | MCD: supervisor portal endpoints, `/ops` route, no MCD adapter (ADR-15, T3.6, T5.8) | PARTIAL | Work orders are created by `municipal_agent`. `services/integrations/mcd/__init__.py` is an in-process dispatch adapter. | No `municipal_supervisor` role, no `/work-orders*` endpoints, no `work_order_event`, no accept step (`dispatched` to `completed` allowed), no `/ops` frontend route. Adapter must become a stub behind an interface. |
| 7 | Forecast inputs: CAMS, ERA5, kriging with external drift; GNN and WRF-Chem off (ADR-16, T2.4, T1.4) | PARTIAL | `services/ingestion/openmeteo.py` pulls Open-Meteo air quality (a CAMS-derived feed) and NWP weather. IDW fallback exists in `services/agents/forecast_agent/downscale.py`. | No dedicated CAMS or ERA5 connector with fixtures, no kriging, no OSM covariates. GNN `load_model` is active whenever `VAYU_GNN_ARTIFACT` is set; needs a flag defaulting OFF. No WRF-Chem code found. |
| 8 | `data_source` table and `docs/data-licences.md` (ADR-20, T1.7) | MISSING | Migration `0001_schema.py` has no such table. | Table, seed, connector registry check, generated doc. |
| 9 | Baseline: FIRMS Sangrur 2023-25, CPCB for Anand Vihar and Patparganj, Delhi controls (ADR-21, T1.6) | MISSING | Only live 24 h FIRMS and Open-Meteo. `data_gov_in_key` CPCB fetch is live-only. No baseline loader or snapshot ID. No Sangrur station dependency (good). | Loader, snapshot ID, pre-period check, ADR. |
| 10 | Keypad 9 to agronomist queue or callback slot (ADR-22) | PARTIAL | `Ops.handle_key` appends a callback record for key 9. | No staffed-hours logic, no queue vs callback distinction, no config. |
| 11 | Disclaimers from `config/disclaimers.yaml` (ADR-18) | MISSING | Health advice payloads carry no disclaimer. The only disclaimer is on the landing page. | Config file, loader, disclaimer on advice payloads and UI. |
| 12 | Risk Phase 1 weights from config; no Phase 2 (T2.3, T2.8) | PARTIAL | `packages/domain/risk.py` reads `packages/domain/config/risk_weights.yaml`. No classifier. | Config lives outside `config/`. Weights differ from spec 6.1 (spec: sowing .30, NDVI .25, machinery .20, fire density .15, soil .10; repo: .30/.20/.15/.25/.10). Tier cut-offs differ (spec .35/.60/.80; repo 40/70/85). No calibration script. |
| 13 | Observability, retention jobs, threat model (T6.8-T6.10) | MISSING | Trace id middleware and `/pipeline/health` exist. No OpenTelemetry, Prometheus, retention job, `docs/threat-model.md`, `tests/security/`. | All three. Only the retention job and threat model are in this run's scope. |

## Summary

- DONE: 0
- PARTIAL: 7 (items 2, 3, 5, 6, 7, 10, 12)
- MISSING: 6 (items 1, 4, 8, 9, 11, 13)

## Other findings that affect the plan

- Existing config sits in `packages/domain/config/`. v2.0 puts versioned config in a root `config/`. Plan: root `config/` is authoritative; `load_yaml` reads it first and falls back to the old directory.
- State is in-process (`World`, `AuditLog`, `DirectiveService`), not DB-backed. New tables are added by migration; the running services keep their in-memory stores, and the migration is checked by the existing test pattern in `tests/integration/test_migrations.py`.
- `git status` shows uncommitted user edits to `README.md` and `vayu-swachh-spec.md`, and untracked `docs/ibm_bob_usage.md`. These are left out of the step commits.
