# Changes: spec v1.0 to v2.0

Baseline before: 121 Python tests passing. After: 207 Python tests passed (1 skipped: needs a live PostGIS/Timescale database), 154 Vitest tests passed, ruff, mypy and `tsc` clean. `make` is not installed on this machine, so `make lint type test` was run as its parts (`ruff`, `mypy`, `tsc`, `pytest`, `vitest`). Playwright e2e was not run.

Nothing was pushed. The uncommitted `README.md`, `vayu-swachh-spec.md` and `docs/ibm_bob_usage.md` were left out of every commit.

## Steps

| Step | What changed | Main files | Tests added |
| --- | --- | --- | --- |
| 1 Gap analysis | `GAP_REPORT.md`: 0 DONE, 7 PARTIAL, 6 MISSING | `GAP_REPORT.md` | none |
| 2 Config and flags | Root `config/` (features, partner_rates, risk_weights at spec 6.1 priors and 35/60/80 tiers, grap_tiers, disclaimers). Flag loader, `GET/PUT /admin/features`, `GET /config/public`. Externally facing flags need a second admin. Exotel is the default primary. | `config/*.yaml`, `packages/domain/{features,partners,disclaimers,config}.py`, `services/api/routers/admin.py` | `test_features.py`, `test_features_api.py`, `test_partners.py` |
| 3 Data sources | Migration 0002 (`data_source` seeded from 7.1, `partner_contract`, `partner_rate`, `work_order_event`, `forecast_grid`, `baseline_snapshot`). Registry check in every connector. CAMS and ERA5 connectors on recorded fixtures. Baseline loader with snapshot ID. `docs/data-licences.md` generated. IMD draft connector removed. | `packages/domain/data_sources.py`, `db/migrations/versions/0002_v2_scope.py`, `services/ingestion/{cams,era5,osm,baseline}.py` | `tests/integration/test_data_sources.py` |
| 4 Forecast and risk | CPCB correction, kriging with external drift (numpy, IDW fallback kept), last-good-grid fallback with `fallback_flag`, GNN behind `FORECAST_GNN_ENABLED` (OFF). Calibration script needs `CALIBRATION_MODE`, writes a report only. | `services/agents/forecast_agent/{kriging,correction,downscale}.py`, `packages/domain/calibration.py`, `scripts/calibrate_risk.py` | `test_forecast_v2.py` |
| 5 Audio, telephony, advisory | Pre-recorded library is the default; Bhashini behind `TTS_PROVIDER` with SHA-256 cache; static DTMF prompts; ASR removed. Calling hours and disclosure line from config. `/calls/trigger` is 503 when off and 409 outside hours. Keypad 9 goes to queue, callback slot, or is recorded with no promised time. Rates and the buy-back line only from an active contract. | `services/integrations/audio`, `services/integrations/telephony`, `services/api/agronomist.py`, `services/agents/advisory_agent` | `test_farmer_calls_v2.py`, `test_audio_agronomist.py` |
| 6 Directives, export, MCD | Directives are recommendation records. `GET /directives/{id}/export` returns an Ed25519-signed PDF, only after approval and with `ADVISORY_EXPORT_ENABLED`; audit entry written first. Traffic sender deleted. MCD adapter replaced by a no-op notifier. `municipal_supervisor` role; `/work-orders` list, accept, complete (photo + GPS, EXIF stripped, 100 m cell, duplicate-sync protection). `/ops` page with offline queue. | `services/api/{directives,advisory_pdf,signing,workorders}.py`, `services/api/routers/workorders.py`, `apps/web/src/routes/ops` | `test_directive_export.py`, `test_work_orders.py`, `ops-queue.test.ts` |
| 7 Frontend | Export button only after approval; floor price and prices only with a contract; Trigger call disabled when telephony is off; alert opt-in hidden unless `PUBLIC_ALERTS_ENABLED`; disclaimer from config; attribution footer on policy, FPO, citizen, ops; key 9 messages; UI risk bands 35/60/80. | `apps/web/src/...` | `flags-and-attribution.test.tsx`, live-adapter additions |
| 8 Verification | WhatsApp sender refuses when `WHATSAPP_ENABLED` is off. Default-flag API test. ADRs 13 to 22 generated; ADR-23 for the baseline. | `services/integrations/whatsapp`, `scripts/gen_adrs.py`, `docs/adr` | whatsapp flag test, default flags test |
| 10 Farmer call: keypad confirm, no WhatsApp | WhatsApp removed everywhere: `integrations/whatsapp`, the `WHATSAPP_ENABLED` flag, its secret and tests, and the WhatsApp booking UI. Keypad is two-step: 1/2/9, then 1 confirms or 0 goes back; nothing is booked before the confirming 1. Key 9 now reaches an FPO worker (was agronomist). | `services/api/{services,fpo_desk}.py`, `services/api/routers/ops.py`, `services/integrations/{telephony,audio}`, `config/{features,fpo_desk}.yaml`, `farmer_scripts_v1.yaml` v3, `apps/web` and root `src` farmer screens | confirm/back/new-session keypad tests, FPO worker script test, WhatsApp-absent test |

Required tests, all present and passing: attribution sum invariant (`test_domain.py`, grid cells); buy-back line absent without contract; export refused before approval; self-approval refused; work-order completion refused before acceptance; unmasked phone never serialised (`test_no_unmasked_farmer_phone_anywhere`); connector refuses unregistered source; every flag defaults to the spec value (parsed from the spec table).

## Not finished or not verified

- Migration 0002 was never run: Docker is not running here. Only static checks pass. Run `VAYU_TEST_DATABASE_URL=... pytest tests/integration/test_migrations.py` before relying on it.
- The new tables are not used by the running services; state is still in-process (`World`, `AuditLog`), as before.
- Gap item 13 was not started: OpenTelemetry/Prometheus dashboards and alerts (T6.8), retention jobs (T6.9), `docs/threat-model.md` (T6.10). They were not in the step list.
- `osm_covariates.json` is a hand-typed placeholder, flagged as such. No forecast RMSE has been measured; only a leave-one-out helper exists.
- Spec 7.1 has no source for 72 h forecast winds (ERA5 cannot look ahead). I registered Open-Meteo NWP as `nwp`. Confirm or replace it.
- No audio clips are recorded; `AudioLibrary.coverage` reports them all missing. Script audio omits nothing, but names make some lines unrecordable as fixed clips: decide whether to drop `{name}` for audio.
- Flag changes need two admins even when turning an external flag OFF (literal reading of the spec). A single-admin kill switch would be safer; your call.
- PDF signature is an Ed25519 platform signature embedded in the PDF, not a PAdES certificate signature; text is Latin-1 so only the English disclaimer is printed. Dev tokens use one identity per role, so two-person flows cannot be exercised through the dev UI; tests use distinct subjects.
- Work orders are not scoped to a supervisor's area (area is a query filter). The citizen alert opt-in has no server-side push delivery.
- Real Exotel/Twilio/Bhashini calls are untested (no credentials). Playwright specs were only text-updated for the policy page; no `/ops` e2e.

## Launch gates

| Gate | Status | Why |
| --- | --- | --- |
| G1 Telecom compliance | BLOCKED | Code side is ready: flags default OFF, 503 and hours enforced. Needs live accounts, DLT approvals, and an approved disclosure (config marks it `approved: false`). |
| G2 Legal sign-off | BLOCKED | `config/disclaimers.yaml` is `legal_review: pending`; the signing method and production signing key are undecided. |
| G3 Partner contract | BLOCKED | `PC-0007` is `unconfirmed`; with no active contract no price is shown anywhere. |
| G4 FPO worker capacity | BLOCKED | `config/fpo_desk.yaml` has an empty roster and no callback slots. |
| G5 Licence check | BLOCKED | Attribution text is seeded from the spec; `verified_at` is empty; OSM covariates are a placeholder. |
| G6 Accuracy review | BLOCKED | No RMSE against held-out CPCB data, no baseline built from real archives, no fallback-usage report. |
