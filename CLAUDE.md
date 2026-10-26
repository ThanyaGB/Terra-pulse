# Vayu-Swachh: project context for Claude Code

IBM national-level hackathon (social impact). Vayu-Swachh is an air-quality action platform for stubble burning: it predicts paddy-straw burning in Punjab (Sangrur pilot), calls farmers to book machines instead, forecasts the smoke reaching Delhi-NCR (Anand Vihar / Patparganj), and closes the loop with city work orders and measured results. The name was "TerraPulse" for a while and was renamed back to **Vayu-Swachh** on 26 Oct 2026: use Vayu-Swachh everywhere.

- Repo: https://github.com/ThanyaGB/Terra-pulse, branch `main`. Team of 4. The user develops on Windows (PowerShell) in `C:\Users\Shravani\Desktop\Vayu-swachh`.
- Before pushing: `git pull --rebase`, then `git push origin main`. Never force-push or reset `main` (the root front end was lost once that way).

## Layout: two front ends + a Python backend

| Path | What it is |
| --- | --- |
| `src/`, `index.html`, `package.json` (`vayu-swachh-web`), `vite.config.ts`, `tests/unit`, `tests/e2e` | **Main front end** (the one demoed). Vite + React 19 + strict TS + Tailwind v4 + GSAP + Three + Mapbox. Runs on mock data by default. `npm install`, `npm run dev` → http://localhost:5173 |
| `apps/web/` | Teammate's older front end, wired to the backend (`apps/web/src/api/live.ts`). Same port 5173, so run only one at a time |
| `services/`, `packages/`, `config/*.yaml`, `db/` | Python backend: FastAPI API (`python run_api.py`, port 8010), six agents, integrations |

Scripts (root): `npm run build`, `npm run typecheck`, `npm test` (Vitest), `npm run e2e` (Playwright). Backend: `pytest -m "not live"`, `ruff check services packages scripts tests db run_api.py`, `mypy services packages scripts run_api.py`, `python scripts/export_contracts.py --check`.

## Main front end (src/)

- API: every component reads through `VayuApi` in `src/api/contract.ts`; the mock is `src/api/mock/` (`?mock=error|empty|slow` forces states), the live adapter is `src/api/live.ts`.
- Shared demo state uses localStorage keys with the `vayuswachh.` prefix and window events with `vayuswachh:` (`src/lib/orders.ts`, `src/lib/workorders.ts`).
- Pages:
  - `/`: scroll-story landing (`src/features/home`).
    - The film is a 9000 px section with a sticky stage; `--p` drives three Canvas2D views (`film/scene.ts`).
    - `film/pacing.ts` gives the burning stretch (progress 0.665–0.83) all the extra scroll; other stages are paced for 7200 px.
    - The end title "VAYU. SWACHH." is particles that settle into a crisp full-resolution wordmark.
    - Captions are in `content.ts`.
  - `/policy`: dark command-centre dashboard. Issuing GRAP-II shows a banner on `/citizen` and creates 3 work orders on `/ops`.
  - `/fpo`: FPO console: machinery ring gauges, + Truck (+8 t), eco-credits (`src/lib/ecocredits.ts`: straw × 1.5 = CO₂e avoided, × 10 = credits; farmer income = straw × ₹1,650/t, shown separately).
  - `/farmer`: phone-call simulator. Full 12-key keypad: menu 1 = machine, 2 = straw pickup, 9 = FPO worker; then 1 = confirm, 0 = back. Nothing is booked before the confirming 1. No WhatsApp anywhere.
  - `/citizen`: PWA with AQI, 24 h forecast "better window", clean commute, snap-and-report.
  - `/ops`: municipal supervisor portal. Accept, then Complete with photo + GPS (demo photo and demo location buttons for laptops).
- Judge tour: `/fpo?tour=1..5` (fpo → farmer → citizen → policy → ops), same order as the landing "System prototypes" menu (D1–D5). The tour panel (`src/design/TourBar.tsx`) floats: drag it by its header, minimise it to a pill, double-click or Home to dock; position and minimised state persist in `vayuswachh.tour.ui`.

## Backend notes

- Farmer call: `POST /calls/keypress {parcel_id, key: 0|1|2|9, lang}` is two-step (`services/api/services.py` `Ops.handle_key`, pending choice per parcel). Prompts live in `packages/domain/config/farmer_scripts_v1.yaml` (v3). Key 9 goes to `services/api/fpo_desk.py` (`config/fpo_desk.yaml`).
- Data sources: NASA FIRMS (VIIRS fires), Sentinel-2 NDVI (harvest timing), CPCB stations (data.gov.in), CAMS and ERA5 via Open-Meteo, OpenStreetMap (placeholder covariates), simulated machinery CRM.
- Safety rules: masked phones, two-person approval for diversions and external feature flags, calls only 08:00–19:00 IST, an audit hash chain, and risky flags off by default.
- WhatsApp was removed entirely (integration, flag, tests, UI).
- `packages/contracts/openapi.json` and `apps/web/src/api-client/schema.d.ts` were hand-edited for the keypad change. Regenerate with `python scripts/export_contracts.py` and `npm run gen:api` if they drift.

## Conventions and open items

- Keep demo data clearly labelled as simulated. Hindi and Punjabi copy is machine-drafted and needs native review.
- README.md is outdated (mentions WhatsApp, the 4-step tour and old setup). Update it when asked.
- GitHub CI: `web` and `secrets` pass. `python` may still need test fixes. Deploy jobs need Kubernetes and are expected to fail.
- A stale Vite "Failed to resolve import" error usually needs `Remove-Item -Recurse -Force node_modules\.vite` and a restart of `npm run dev`.
