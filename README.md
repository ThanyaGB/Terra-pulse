# Vayu-Swachh front end

Four interfaces for the Vayu-Swachh air-quality action platform (Punjab/Haryana farm belt → Delhi-NCR), sharing one design system.

| Route | Audience | What it is |
|---|---|---|
| `/` | Everyone | Scroll-story landing: a pinned film (rice field → harvest → fire → smoke → clear-sky particle title) driven by scroll, then problem, closed loop and four acts |
| `/policy` | CAQM, CPCB/SPCBs, NCAP expert group | 2×2 decision dashboard: source attribution, 72 h plume map with scrubber, compliance/ROI, pipeline health, plus directive toolbar with confirmation modals |
| `/fpo` | FPOs / custom hiring centres (Sangrur, 14 villages) | Machinery cards, biomass purchase, sortable/filterable farmer risk table, call panel |
| `/farmer` | Farmers on basic phones | Phone-frame voice-call simulator (ਪੰਜਾਬੀ / हिंदी / English), subtitles, waveform, 1/2/9 keypad |
| `/citizen` | East Delhi residents | Installable mobile PWA: AQI, health advice, alerts, clean-commute planner, snap-and-report |

## Features worth knowing about

- **Landing film** (`src/features/home`): one rAF loop paints three Canvas2D views from scroll progress; it adapts quality by fps, honours `prefers-reduced-motion`, and falls back when canvas is unavailable. The wind sound toggle is optional WebAudio. The title font is `@fontsource/bebas-neue`.
- **Judge demo mode:** the landing nav button opens `/policy?tour=1`; a stepper (`?tour=1..4`) walks /policy → /fpo → /farmer → /citizen.
- **`/policy`** uses the dark command-centre theme (`.theme-command` in `src/index.css`) and logs confirmed directives in an Administrative orders tile. Issuing GRAP-II writes `localStorage['vayu.grap']`, which shows a banner on `/citizen` in the same browser.
- **`/fpo`:** KPI tiles, ring gauges, `+ Truck` (+8 t), an eco-credits tile (demo rule: 1 credit per tonne; the real scheme is not in the brief), and both Voice alert and Assign machine on every row.
- **`/farmer`:** English gloss under non-English subtitles, a WhatsApp booking sheet after key 1 (₹500 deposit is demo only, nothing is charged). The WhatsApp number in `src/features/home/content.ts` (`WA_BASE`) is a **placeholder**: replace it.
- **`/citizen`:** 24 h curve with a "better window" (an estimate scaled from the live reading, not a model forecast), schematic route map with demo navigation, per-street AQI in the picker, and a demo municipal ticket timeline after a report.

## Setup

```bash
npm install
cp .env.example .env     # optional – defaults run fully on mock data
npm run dev              # http://localhost:5173
```

Other scripts: `npm run build`, `npm run preview`, `npm run typecheck`, `npm test` (Vitest), `npm run e2e` (Playwright; run `npx playwright install chromium` once).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_MODE` | `mock` | `mock` uses in-browser fixtures; `live` calls the backend |
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` (in `.env.example`) | Base URL for REST calls in live mode |
| `VITE_WS_URL` | `ws://localhost:8000/ws/v1/stream` (in `.env.example`) | WebSocket URL for live AQI, fire alerts and agent status. If empty or the socket drops, the app polls |
| `VITE_POLL_INTERVAL_MS` | `15000` | Polling interval for the fallback |
| `VITE_MAPBOX_TOKEN` | _(empty)_ | Enables the Mapbox basemap on `/policy`. Without it a built-in SVG schematic basemap is used |

## Switching from mock to live API

1. Set `VITE_API_MODE=live` and `VITE_API_BASE_URL` (and `VITE_WS_URL`) in `.env`.
2. The contract lives in `src/api/contract.ts` (the `VayuApi` interface and all types). **The backend contract was not included in the original brief, so these shapes are my proposal** – adjust the types and `src/api/live.ts` paths to match the real service. Every UI component reads only through `VayuApi`, so nothing else changes.
3. The mock (`src/api/mock/`) implements the same interface. Append `?mock=error`, `?mock=empty` or `?mock=slow` to any route to force those states while in mock mode.

## Architecture notes

- **Stack:** Vite, React, strict TypeScript, Tailwind v4 (tokens in `src/index.css`), GSAP (page/modal transitions, respects reduced motion), Three.js (plume particle layer), Mapbox GL (lazy-loaded).
- **Real-time:** `RealtimeClient` uses WebSocket, falls back to polling, and reconnects. In mock mode a simulator jitters the values.
- **States:** `useAsync` + `AsyncBoundary` give every panel loading, error (with retry), offline and empty states. Last-good data is cached in `localStorage`; citizen reports made offline are queued and sent on reconnect.
- **i18n:** `src/i18n` – English is the source of truth; Hindi is complete; Punjabi covers farmer, common and nav strings and falls back to English elsewhere. `/farmer` defaults to Punjabi when the browser locale is `pa*` or `*-IN` Punjab-region.
- **AQI bands:** Good → Severe+ (>450), following the CPCB scale and GRAP Stage-IV threshold. Colour pairs are unit-tested for ≥4.5:1 contrast; status is never conveyed by colour alone.
- **Phone numbers** are always masked (`98721-XXXXX`) via `maskPhone`.
- **PWA:** `public/manifest.webmanifest`, `public/sw.js` (shell cache-first; navigation and `/api/` network-first with offline snapshot), install prompt (Android) and iOS hint. The service worker registers in production builds only.
- **Accessibility:** WCAG 2.1 AA targets – native `<dialog>` modals, skip link, visible focus, ≥56 px keypad keys, keyboard 1/2/9 on the farmer screen, `aria-live` confirmations, no horizontal scroll at 360 px.

## Tests

- `tests/unit` – AQI formatting/bands/contrast, exposure calculations, risk tiers, phone masking, keypad state machine and component, realtime fallback.
- `tests/e2e` – one happy path per interface (plus empty/error/offline checks).

## Known limitations

- The Hindi and Punjabi copy was machine-drafted and **needs native-speaker review** before field use. Citizen screens are only partly translated into Punjabi.
- Voice-call audio uses the browser's speech synthesis when no recorded audio file is configured; if the device has no Punjabi voice, subtitles run on a timer.
- The plume layer needs WebGL; without it the map shows the street markers and a notice.
- Mapbox rendering needs a token you supply.
