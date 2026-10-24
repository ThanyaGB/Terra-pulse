# Data licences

Generated from the `data_source` registry by `scripts/gen_data_licences.py`. Do not edit by hand.
Only open-licence sources are ingested (ADR-20). Attribution is shown in every UI that displays derived data.
Gate G5 (licence check) is not passed until the data lead has verified each row below.

| Source | ID | Data | Cadence | Licence | Attribution shown | Redistribution |
| --- | --- | --- | --- | --- | --- | --- |
| NASA FIRMS | `firms` | VIIRS 375 m, MODIS 1 km hotspots | Poll every 15 min | NASA open data policy | NASA FIRMS | Open; attribution requested |
| Sentinel-2 | `sentinel2` | Surface reflectance to NDVI | Every 5 days per tile | Copernicus open licence | Contains modified Copernicus Sentinel data | Free, full and open; attribution required |
| CPCB CAAQMS | `cpcb` | Station PM2.5, PM10, NO2 | Every 15 min | Government Open Data Licence - India, via data.gov.in | Source: CPCB via data.gov.in | Redistribution allowed with attribution |
| CAMS | `cams` | Global atmospheric forecast grids | Every 12 h | Copernicus licence | Copernicus Atmosphere Monitoring Service | Free, full and open; attribution required |
| ERA5 | `era5` | Reanalysis meteorology (PBL, wind, temperature) | Hourly | Copernicus licence | Copernicus Climate Change Service | Free, full and open; attribution required |
| Open-Meteo NWP forecast | `nwp` | Forecast winds and boundary-layer height for the 72 h plume (ERA5 is reanalysis and cannot look ahead) | Hourly | CC BY 4.0 (Open-Meteo) | Weather data by Open-Meteo.com | Attribution required |
| OpenStreetMap | `osm` | Roads, land use | Monthly extract | ODbL | © OpenStreetMap contributors | Share-alike for derived databases; attribution required |
| Low-cost IoT sensors | `iot` | Sensor PM2.5 | 1-5 min | Owned or contracted per deployment | Per contract | Per contract |
| Machinery CRM | `crm` | Machine status, PTO and GPS hours | Event-driven + 5 min | Partner data agreement | Internal | Internal only; not redistributed |

Raw IMD feeds are not used in v2.0.
