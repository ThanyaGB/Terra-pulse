"""Writes docs/adr/NNNN-*.md from the decisions in vayu-swachh-spec.md section 3, with where each is implemented."""
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "docs" / "adr"
OUT.mkdir(parents=True, exist_ok=True)

ADRS = [
    ("01", "multi-agent-architecture", "Multi-agent architecture on the IBM Bob framework",
     "Six specialised agents run as workers and communicate only through an event bus, never by direct calls. Each has an independent failure domain; every agent must be idempotent and tolerate duplicate or out-of-order events.",
     "Implemented in `services/agents/` on a small in-repo base class (`common/agent.py`): subscription by event type, idempotency on `event_id`, ack-after-success redelivery, health report. **Deviation:** the IBM Bob SDK (`ibm-bob`) is not a public package, so `BaseAgent` provides the same pub/sub, state-snapshot and health contract; swap it behind `BaseAgent` when the SDK is available. The six agents currently share one process and an in-memory `World`; Redis-backed `RedisStreamsBus`/`RedisState` exist for the split into separate deployments."),
    ("02", "redis-event-bus", "Redis as the event bus and shared state store",
     "Redis Streams carry domain events; Redis also holds shared state snapshots and distributed locks. Durable event history is kept in PostgreSQL through an outbox table so Redis can be rebuilt.",
     "`agents/common/bus.py` (`RedisStreamsBus`: one stream per event type, a consumer group per agent, XACK after success), `outbox.py` (SQLite in dev, `outbox` table in the Postgres migration), `state.py`, `idempotency.py`. Per-parcel rate limits use Redis counters (`integrations/ratelimit.py`)."),
    ("03", "postgres-postgis-timescale", "PostgreSQL with PostGIS and TimescaleDB",
     "PostGIS stores spatial geometry (parcels, villages, grid cells, streets); TimescaleDB stores sensor and AQI time series. Migrations enable both extensions and create hypertables.",
     "`db/migrations/versions/0001_schema.py` (Alembic). Verified statically in CI; the up/down test against a real database runs when `VAYU_TEST_DATABASE_URL` is set. The running API still uses in-memory repositories: wiring the SQL repositories is the next step."),
    ("04", "fastapi-python", "FastAPI for the API layer, Python throughout",
     "All backend services are Python. FastAPI serves REST and WebSocket; Pydantic types the contract; OpenAPI is generated.",
     "`services/api/`. Written for Python 3.12 but avoids 3.12-only syntax and is tested on 3.11, the interpreter available during development."),
    ("05", "contract-first-api", "Typed contract-first API",
     "The OpenAPI document is the contract and the TypeScript client is generated from it, so front end and backend can be built against mocks and protected by contract tests.",
     "`scripts/export_contracts.py` writes `packages/contracts/openapi.json` (3.1) and the event JSON Schemas; `--check` fails CI on drift. `npm run gen:api` generates `apps/web/src/api-client/schema.d.ts`, which types the HTTP client path set. Most response bodies are still plain dicts in the schema; promoting them to Pydantic response models is the way to make response types generated too."),
    ("06", "phone-masking", "Phone number masking by default",
     "Farmer phone numbers are masked (`98721-XXXXX`) in every API response and UI display. The only exception is the assigned machinery operator on a confirmed booking, shown to the farmer and FPO coordinator for that booking.",
     "`api/masking.py`: every JSON response passes through `MaskedJSONResponse`, so a handler cannot leak a number by forgetting to mask; the single exception is the explicit `clear()` wrapper used in `booking_view` for confirmed bookings. Tested in `tests/contract/test_api.py`."),
    ("07", "two-person-diversion", "Two-person approval for diversion orders",
     "A directive that diverts traffic needs a second `policy_officer` approver, and every directive is written to an immutable audit log before dispatch.",
     "`api/directives.py` + `api/audit.py` (hash-chained). The same rule is a `CHECK` constraint in the `directive` table, and the audit table has an append-only trigger."),
    ("08", "economics-first-scripts", "Economics-first farmer communication",
     "Farmer scripts state prices and earnings directly and avoid punitive wording.",
     "`packages/domain/config/farmer_scripts_v1.yaml` holds the templates and a per-language blocked-word list; `render_script` refuses to emit a script containing one. Punjabi and Hindi copy is machine-drafted and needs native review."),
    ("09", "keypad-first", "Keypad-first farmer interaction",
     "Farmers act by pressing 1, 2 or 9; no app or text input.",
     "`POST /v1/calls/keypress` (simulator) and the signed telephony webhook share `Ops.handle_key`: 1 books and confirms a machine, 2 requests straw collection at the floor price, 9 requests an agronomist callback."),
    ("10", "bhashini-audio-cache", "Bhashini for speech, with an audio cache",
     "Bhashini ASR/TTS handles Punjabi and Hindi; generated audio is cached by SHA-256 of the normalised script.",
     "`integrations/bhashini`. Needs an API key and confirmation of dialect coverage (open question 3); until then the simulator voices lines with the browser speech synthesis."),
    ("11", "mock-first-frontend", "Mock-first front end",
     "The front end is built against typed mock fixtures that match the contract; one environment variable switches to the live API.",
     "`apps/web/src/mocks` and `VITE_API_MODE=mock|live`. The UI-facing `VayuApi` interface is kept stable; `src/api/live.ts` adapts the spec endpoints onto it (covered by `tests/unit/live-adapter.test.ts`)."),
    ("12", "citizen-photo-privacy", "Privacy for citizen photo reports",
     "Photo uploads are stripped of EXIF except the GPS point, which is stored as a coarse grid reference; reports get a reference ID and no personal identifiers.",
     "`api/images.py` re-encodes the pixels into a new image (no metadata carried over) and writes only a GPS IFD rounded to a ~1 km grid. Tested by reading the saved file's EXIF."),
]

for num, slug, title, decision, impl in ADRS:
    (OUT / f"00{num}-{slug}.md").write_text(
        f"# ADR-{num}: {title}\n\n**Status:** Accepted (from vayu-swachh-spec.md section 3)\n\n## Decision\n\n{decision}\n\n## Implementation\n\n{impl}\n", encoding="utf8")
print("wrote", len(ADRS), "ADRs")
