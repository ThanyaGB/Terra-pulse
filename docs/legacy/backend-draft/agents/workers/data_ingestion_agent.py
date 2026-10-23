"""
Data Ingestion Agent
Spatial alignment, gridding, sensor drift calibration, missing-value interpolation.
Publishes data.normalised.
"""
import asyncio
import numpy as np
from typing import Dict, Any, List, Optional
from .base_agent import BaseBobAgent


class DataIngestionAgent(BaseBobAgent):
    """
    Data Ingestion Agent.
    
    Responsibilities:
    - Spatial alignment of multi-source data (FIRMS, Sentinel-2, CPCB, IMD)
    - Gridding to 1 km resolution
    - Sensor drift calibration
    - Missing-value interpolation (spatiotemporal)
    - Publishes data.normalised with normalised spatial and time-series data
    """
    
    def __init__(self, bus=None, state_store=None):
        super().__init__("data_ingestion", bus, state_store)
        # Calibration coefficients cache (loaded from DB in production)
        self.calibration_cache: Dict[str, Dict] = {}
    
    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming event and normalise data."""
        event_type = event.get("event_type", "")
        
        if event_type == "data.raw.ingested":
            return await self._normalise_raw_data(event.get("data", {}))
        elif event_type == "sensor.drift.request":
            return await self._apply_drift_calibration(event.get("data", {}))
        elif event_type == "data.interpolation.request":
            return await self._interpolate_missing_values(event.get("data", {}))
        else:
            self._log_event("warning", "Unknown event type", event_type=event_type)
            return None
    
    async def _normalise_raw_data(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalise raw data from various sources into common schema."""
        source = raw_data.get("source", "")
        records = raw_data.get("records", [])
        
        normalised_records = []
        for record in records:
            normalised = self._normalise_record(record, source)
            normalised_records.append(normalised)
        
        # Grid to 1 km resolution
        gridded_data = self._grid_to_1km(normalised_records)
        
        result = {
            "source": "normalised",
            "records": normalised_records,
            "grid_1km": gridded_data,
            "record_count": len(normalised_records),
            "normalised_at": time.time(),
            "agent": self.agent_name,
        }
        
        await self.publish("data.normalised", result)
        self._log_event("info", "Data normalised and gridded", 
                       record_count=len(normalised_records))
        
        return result
    
    def _normalise_record(self, record: Dict[str, Any], source: str) -> Dict[str, Any]:
        """Normalise a single record to common schema."""
        # Map various source formats to common fields
        field_map = {
            "firms": {
                "latitude": "latitude",
                "longitude": "longitude",
                "value": "bright_temperature",
            },
            "cpcb": {
                "latitude": "location.latitude",
                "longitude": "location.longitude",
                "value": "calibrated_value",
            },
            "imd": {
                "latitude": "coordinates.latitude",
                "longitude": "coordinates.longitude",
                "value": "pbl_height",
            },
        }
        
        mapping = field_map.get(source, {})
        normalised = {
            "latitude": record.get(mapping.get("latitude", "latitude")),
            "longitude": record.get(mapping.get("longitude", "longitude")),
            "value": record.get(mapping.get("value", "value")),
            "source": source,
            "timestamp": record.get("timestamp", time.time()),
        }
        
        # Apply drift calibration if available
        if source in self.calibration_cache:
            cal = self.calibration_cache[source]
            if "value" in normalised and normalised["value"] is not None:
                val = normalised["value"]
                normalised["value"] = round(val * cal.get("slope", 1.0) + cal.get("intercept", 0.0), 2)
        
        return normalised
    
    def _grid_to_1km(self, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Grid point data to 1 km resolution grid.
        
        Uses spatial binning: each point is assigned to a 1 km grid cell
        based on its coordinate divided by 1 km (approximately 0.009 degrees 
        at the equator, adjusted for latitude).
        """
        if not records:
            return {"grid": {}, "cell_count": 0}
        
        # Compute grid cell indices for each record
        # At latitude ~30°N, 1 km ≈ 0.009 degrees
        grid_size = 0.009  # degrees per km at ~30°N
        
        grid_cells = {}
        for record in records:
            lat = record.get("latitude")
            lon = record.get("longitude")
            value = record.get("value")
            
            if lat is None or lon is None or value is None:
                continue
            
            # Compute grid cell indices
            lat_grid = int(lat / grid_size)
            lon_grid = int(lon / grid_size)
            
            key = f"{lat_grid},{lon_grid}"
            if key not in grid_cells:
                grid_cells[key] = {"lats": [], "lons": [], "values": [], "count": 0}
            
            grid_cells[key]["lats"].append(lat)
            grid_cells[key]["lons"].append(lon)
            grid_cells[key]["values"].append(value)
            grid_cells[key]["count"] += 1
        
        # Compute cell aggregates (mean value per cell)
        grid_mean = {}
        for key, cell in grid_cells.items():
            if cell["values"]:
                grid_mean[key] = {
                    "latitude": np.mean(cell["lats"]),
                    "longitude": np.mean(cell["lons"]),
                    "mean_value": round(np.mean(cell["values"]), 2),
                    "point_count": cell["count"],
                    "grid_cell": key,
                }
        
        return {
            "grid": grid_mean,
            "cell_count": len(grid_cells),
            "grid_size_km": 1.0,
            "coordinate_reference": "WGS84,