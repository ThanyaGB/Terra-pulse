# Vayu-Swachh runbook

Status: **draft for review** (T6.7 requires a reviewer who did not write it to walk through the failover steps).
Commands assume the staging namespace `vayu`. Replace with the production context where stated.

## 0. Quick map

| Component | How to check | Where |
| --- | --- | --- |
| API + agents (one process) | `curl $URL/healthz` -> `{"status":"ok","data_ready":true}` | `deployment/vayu-api` |
| Per-agent health | `GET /v1/pipeline/health` (policy_officer or admin) -> `agents[]` | |
| Data freshness | same endpoint -> `quality.freshness_min`, `quality.status`, `quality.origin` (`live` or `fixture`) | |
| Audit chain | `GET /v1/audit/verify` (admin) -> `{"valid": true}` | |
| Redis / Postgres / bucket | `python scripts/smoke_infra.py` from a pod or bastion | |

`origin: fixture` for a source means the live provider failed and the platform is serving recorded data. Treat as degraded.

## 1. On-call: first five minutes

1. `GET /healthz`. If it fails, `kubectl -n vayu rollout status deploy/vayu-api` and `kubectl -n vayu logs deploy/vayu-api --tail=200`.
2. `GET /v1/pipeline/health`. Any agent `down` or any source `down`/`degraded`: go to section 5.
3. Is a GRAP stage active? Check the policy dashboard; if yes, keep the incident channel open and follow section 2.
4. Record trace ids: every response has `X-Trace-Id`; logs carry the same `trace_id`.

## 2. GRAP escalation

The tier mapping is data, not code: `config/grap_tiers.yaml` (versioned). Tiers from AQI: stage 1 above 200, stage 2 above 300, stage 3 above 400, stage 4 above 450.

| Tier | Automatic | Needs a human |
| --- | --- | --- |
| Stage 1-2 | Municipal agent creates road-sweeping, dust-suppression and fog-cannon work orders and dispatches to MCD | Nothing |
| Stage 2+ | GRAP-II alert can be issued from the policy dashboard (single approver) | Policy officer confirms the modal |
| Stage 3+ | Municipal agent **proposes** a diesel-truck diversion; it waits in `pending_approval` | A **second, different** policy officer approves (`POST /v1/directives/{id}/approve`). The creator cannot approve their own. Legal sign-off applies (spec open question 9) |

Escalation: on-call engineer -> policy officer on duty -> CAQM contact. Do not dispatch a diversion by editing the database: the audit chain would still verify, but the two-person rule exists to protect against exactly that.

## 3. Directive rollback

Directives are append-only. To withdraw one, issue a new directive of the opposite effect (for example, lift a diversion) through the dashboard; both entries stay in the audit log. Never delete rows from `directive` or `audit_event` (the table has an append-only trigger). If a directive was sent to an external authority, also call that authority: dispatch cannot be recalled from our side.

Verify the log after any incident: `GET /v1/audit/verify` must return `valid: true`. If it does not, stop issuing directives, preserve the database, and escalate to the security owner.

## 4. Telephony provider failover

The adapter (`integrations/telephony`) checks the active provider every 30 s and fails over after **3 consecutive failures**, raising an `alert.fired` event (kind `telephony`). Calls already in progress stay on the provider that started them.

Manual failover, if you must act before the automatic switch:

1. Confirm the outage on the provider status page and with `GET /v1/pipeline/health` -> `telephony.active_provider`.
2. Set the other provider as primary (`VAYU_TELEPHONY_PRIMARY`) and restart: `kubectl -n vayu rollout restart deploy/vayu-api`. In-flight webhooks for old calls still verify, because both providers' signing secrets are loaded.
3. Place one test call to an internal number and confirm the DTMF webhook returns 200.
4. Fail back only after the original provider has been healthy for 30 minutes.

Per-parcel limits still apply during failover (max 2 calls per parcel per 24 h): a retry storm will not bypass them.

## 5. Data pipeline recovery

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `firms` degraded/down, `origin: fixture` | FIRMS CSV unreachable | Wait one cycle (15 min). If persistent, check the provider; the platform keeps serving the last fixture |
| `weather` degraded | Open-Meteo outage or rate limit | Same. Winds and boundary-layer alerts become stale; the citizen alerts say "updated at" |
| `sentinel2` down | Scene older than the 8-day SLA | Run `python scripts/record_fixtures.py` or enable `VAYU_LIVE_NDVI=true` |
| An agent `down` | Handler raising on every event | Read logs for `handler failed, will redeliver`; fix, redeploy. Events stay pending and are redelivered once the handler succeeds (idempotent on `event_id`) |
| Redis lost | Node failure | Events are durable in the `outbox` table. Restart the API: the outbox relays unpublished events; the idempotency store rebuilds as events replay |
| Duplicate bookings reported | Should not happen: bookings are idempotent on parcel + machinery and CRM writes use optimistic locking | Check `GET /v1/machinery/status` -> `conflicts[]`, resolve in the FPO queue |

Re-run an ingestion cycle by restarting the API (the first cycle runs at start) or waiting for the 15-minute loop.

## 6. Database

Migrations: `VAYU_DATABASE_URL=... alembic -c db/alembic.ini upgrade head` (down: `downgrade base`). RDS provides PostGIS but not TimescaleDB; use Timescale Cloud or a self-managed instance for the hypertables (see `infra/terraform/main.tf`). **Status:** the SQL schema exists and is statically tested; the API still keeps state in memory until the SQL repositories are wired. Until then a restart loses bookings, calls and work orders (the audit log and outbox persist only if their SQLite/Postgres stores are configured).

## 7. Secrets

Secrets live in the secret manager (`vayu/<env>/...`), never in git or `.env` files that are committed. Rotate the JWT secret by adding the new key, restarting, and letting tokens expire (8 h). The pre-commit scanner (`scripts/secret_scan.py`) blocks keys and unmasked phone numbers.

## 8. Known gaps to read before relying on this runbook

- Not yet exercised in a real cluster (no Docker daemon or cloud access in the development environment). Walk the staging deployment first.
- Real telephony, WhatsApp, Bhashini, MCD and traffic integrations are implemented as adapters with test doubles; credentials and partner interfaces are open questions (see `docs/open-questions.md`).
