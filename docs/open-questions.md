# Open questions (spec section 15) and how the code treats them

These were **not assumed away**. Each one has a seam in the code and a default that is clearly labelled.

| # | Question | Current handling |
| --- | --- | --- |
| 1 | Telephony primary: Twilio or Exotel? | Both implemented behind `TelephonyAdapter` (`integrations/telephony`). Dev runs two `FakeProvider`s; real ones need credentials. Primary is a setting |
| 2 | Final form and weights of the risk score `f` | Weighted sum with weights, normalisers and tier cut-offs in `config/risk_weights.yaml`; nothing hard-coded. Tier cut-offs (40/70/85) match the FPO screen |
| 3 | Bhashini access tier and Malwai/Haryanvi coverage | Client and SHA-256 audio cache implemented; no key, so the simulator uses browser speech synthesis. Punjabi/Hindi copy is machine-drafted and needs native review |
| 4 | Bio-CNG floor price and subsidy amounts | Rs 1,650/t and Rs 750/acre kept in `farmer_scripts_v1.yaml` as **pilot assumptions** to confirm before farmers see them |
| 5 | Traffic authority interface | `TrafficAuthority` sender contract with log-before-send; the transport is a stub |
| 6 | MCD API or manual dispatch | `McdIntegration` with a lifecycle state machine; transport is a stub |
| 7 | GNN downscaling model and WRF-Chem outputs: source and licence | `load_model()` loads a TorchScript artifact from `VAYU_GNN_ARTIFACT` if present; otherwise inverse-distance interpolation of CAMS model points onto the 1 km grid. The response says which method ran (`method`) |
| 8 | Data licensing for CPCB, IMD, NASA FIRMS in the citizen PWA | See data sources below. CPCB and IMD are **not** redistributed: the stand-ins are Open-Meteo/CAMS. Confirm terms before using the real feeds |
| 9 | Legal review of diversion orders and enforcement-adjacent messaging | Diversions are two-person gated and audited; scripts avoid punitive wording by lint. Nothing is sent to a real authority |
| 10 | Pilot metrics baseline | Not available. The risk model uses the current 24 h FIRMS detections as the fire-density input, not a historical season baseline |

## Public data used (all keyless)

| Source | Used for | How |
| --- | --- | --- |
| NASA FIRMS VIIRS 375 m (Suomi-NPP, 24 h, South Asia CSV) | Hotspots, village clusters, upwind straw signal | `ingestion/firms.py`, polled every 15 min |
| Open-Meteo Air Quality (Copernicus CAMS global) | PM2.5, PM10, NO2, SO2, CO, dust per monitored area; 72 h forecast | `ingestion/openmeteo.py`. Stands in for CPCB CAAQMS, which needs a `data.gov.in` key (`VAYU_DATA_GOV_IN_KEY`, connector in `ingestion/cpcb.py`) |
| Open-Meteo Forecast (NWP) | Winds (10 m and 100 m), boundary-layer height, soil moisture | Stands in for IMD, which has no open API |
| Sentinel-2 L2A via Earth Search STAC + AWS COGs | NDVI per village; decay slope over recent clear scenes | `ingestion/ndvi.py` (`VAYU_LIVE_NDVI=true` to read live; recorded scenes otherwise) |
| Open-Meteo geocoder | Village coordinates | Four villages were not found and are marked `approx` in `ingestion/geo.py` |

## Not public, so simulated (and labelled as such)

- Parcel and farmer records, phone numbers: generated (`agents/world.py`). Only village locations are real.
- Machinery CRM: deterministic simulator (`ingestion/crm.py`) behind the CRM interface.
- Low-cost IoT sensors: the drift calibration and gap-fill code is tested on series; no live sensor feed is wired.
- Source attribution is a **transparent proxy model**, not a receptor model (see `agents/forecast_agent`). Treat percentages as indicative.
- Plume projection is a forward Lagrangian advection with real forecast winds at Sangrur, not a HYSPLIT run (the wrapper switches to HYSPLIT if `hycs_std` is installed).
- ROI measurement uses model series, so measured deltas demonstrate the method; real ROI needs CAAQMS readings.
