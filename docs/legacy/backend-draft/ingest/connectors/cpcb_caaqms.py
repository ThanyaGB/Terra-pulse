"""
CPCB CAAQMS Connector
Continuous station feeds plus low-cost IoT sensor streams.
Apply drift calibration and gap-filling by spatiotemporal interpolation.
"""
import asyncio
import aiohttp
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import structlog

logger = structlog.get_logger()

# CPCB CAAQMS API endpoints
CPCB_ENDPOINTS = {
    "continuous": "https://api.cpcb.gov.in/v1/staions/continuous",
    "iot": "https://api.cpcb.gov.in/v1/staions/iot",
}


class CPCBConnector:
    """Connector for CPCB Continuous Air Quality Monitoring Stations."""
    
    def __init__(self, 
                 state: str = "Punjab",
                 city: Optional[str] = None,
                 pollutants: List[str] = None):
        """
        Initialize CPCB connector.
        
        Args:
            state: State name (Punjab, Haryana, Delhi-NCR)
            city: Specific city filter
            pollutants: List of pollutants [PM2.5, PM10, NO2, O3, CO, SO2]
        """
        self.state = state
        self.city = city
        self.pollutants = pollutants or ["PM2.5", "PM10", "NO2", "O3", "CO", "SO2"]
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, *exc_info):
        await self.session.close()
    
    async def fetch_station_data(self, 
                                 station_id: str,
                                 start_date: datetime,
                                 end_date: datetime) -> Dict[str, Any]:
        """Fetch continuous monitoring data for a specific station."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        params = {
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
            "pollutants": ",".join(self.pollutants),
        }
        
        url = f"{CPCB_ENDPOINTS['continuous']}/{station_id}"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data
        except Exception as e:
            logger.error("CPCB station data fetch failed", 
                        station_id=station_id, error=str(e))
            return {}
    
    async def fetch_iot_sensor_data(self,
                                    sensor_id: str,
                                    start_date: datetime,
                                    end_date: datetime) -> Dict[str, Any]:
        """Fetch low-cost IoT sensor data."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        params = {
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
        }
        
        url = f"{CPCB_ENDPOINTS['iot']}/{sensor_id}"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data
        except Exception as e:
            logger.error("IoT sensor data fetch failed", 
                        sensor_id=sensor_id, error=str(e))
            return {}
    
    async def apply_drift_calibration(self, 
                                     raw_data: Dict[str, Any],
                                     sensor_type: str = "continuous") -> Dict[str, Any]:
        """
        Apply drift calibration to sensor readings.
        
        Uses reference station data to correct sensor drift.
        Calibration model: corrected = raw * slope + intercept
        """
        # In a full implementation, this would use historical calibration coefficients
        # specific to each sensor type and location
        calibrated = raw_data.copy()
        
        # Placeholder calibration coefficients (would be loaded from calibration DB)
        calibration_params = {
            "pm2.5": {"slope": 1.02, "intercept": -0.3},
            "pm10": {"slope": 0.98, "intercept": 0.5},
            "no2": {"slope": 1.01, "intercept": -0.1},
            "o3": {"slope": 0.99, "intercept": 0.2},
            "co": {"slope": 1.05, "intercept": -0.8},
            "so2": {"slope": 1.03, "intercept": -0.4},
        }
        
        for reading in raw_data.get("readings", []):
            pollutant = reading.get("pollutant", "")
            if pollutant in calibration_params:
                params = calibration_params[pollutant]
                reading["calibrated_value"] = round(
                    reading.get("value", 0) * params["slope"] + params["intercept"], 2
                )
            else:
                reading["calibrated_value"] = reading.get("value")
        
        logger.info("Drift calibration applied", 
                    sensor_type=sensor_type,
                    readings_calibrated=len(raw_data.get("readings", [])))
        
        return calibrated
    
    async def spatiotemporal_interpolation(self,
                                          station_data: Dict[str, Any],
                                          iot_data: Dict[str, Any],
                                          target_locations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Gap-filling by spatiotemporal interpolation.
        
        Uses inverse distance weighted (IDW) interpolation for spatial gaps
        and linear interpolation in time for missing timestamps.
        """
        from scipy.interpolate import griddata
        
        # Combine station and IoT data points
        all_points = []
        all_values = []
        
        # Add station data
        for reading in station_data.get("readings", []):
            loc = reading.get("location", {})
            if "latitude" in loc and "longitude" in loc:
                all_points.append([loc["longitude"], loc["latitude"]])
                all_values.append(reading.get("calibrated_value", reading.get("value", 0)))
        
        # Add IoT sensor data
        for reading in iot_data.get("readings", []):
            loc = reading.get("location", {})
            if "latitude" in loc and "longitude" in loc:
                all_points.append([loc["longitude"], loc["latitude"]])
                all_values.append(reading.get("calibrated_value", reading.get("value", 0)))
        
        if not all_points or len(all_points) < 3:
            logger.warning("Insufficient data points for interpolation")
            return {"interpolated": {}, "gaps": 0}
        
        points = np.array(all_points)
        values = np.array(all_values)
        
        # Interpolate to target locations
        interpolated = {}
        gaps_filled = 0
        
        for target in target_locations:
            target_coord = [target.get("longitude", 0), target.get("latitude", 0)]
            
            # IDW interpolation
            distances = np.sqrt(np.sum((points - target_coord) ** 2, axis=1))
            with np.errstate(divide='ignore', invalid='ignore'):
                weights = 1.0 / (distances ** 2 + 1e-10)  # Add small epsilon
                weights = weights / np.sum(weights)  # Normalize
            
            if np.sum(weights) > 0:
                interpolated_value = np.sum(weights * values)
            else:
                interpolated_value = np.nan
                gaps_filled += 1
            
            # Linear temporal interpolation would require timestamp data
            # For now, use spatial only
            interpolated[f"{target.get('id', 'unknown')}"] = {
                "value": float(interpolated_value) if not np.isnan(interpolated_value) else None,
                "method": "idw_spatial",
                "nearest_stations": len(all_points),
            }
        
        logger.info("Spatiotemporal interpolation completed",
                     target_locations=len(target_locations),
                     gaps_filled=gaps_filled)
        
        return {"interpolated": interpolated, "gaps_filled": gaps_filled}