"""
IMD Connector
India Meteorological Department high-resolution NWP output, 
PBL height, inversion strength, and 3D wind vectors.
"""
import asyncio
import aiohttp
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import structlog

logger = structlog.get_logger()

# IMD API endpoints for NWP data
IMD_ENDPOINTS = {
    "nwp": "https://api.imd.gov.in/v1/nwp",
    "pbl": "https://api.imd.gov.in/v1/pbl",
    "wind": "https://api.imd.gov.in/v1/wind",
}


class IMConnector:
    """Connector for IMD NWP output and meteorological parameters."""
    
    def __init__(self, 
                 domain: str = "highres",
                 variables: List[str] = None):
        """
        Initialize IMD connector.
        
        Args:
            domain: NWP domain (highres, medium, coarse)
            variables: List of meteorological variables
        """
        self.domain = domain
        self.variables = variables or [
            "pbl_height", "inversion_strength", 
            "wind_u", "wind_v", "wind_w",
            "temperature", "humidity", "pressure"
        ]
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, *exc_info):
        await self.session.close()
    
    async def fetch_nwp_output(self,
                             latitude: float,
                             longitude: float,
                             forecast_hours: int = 72,
                             pressure_level: str = "surface") -> Dict[str, Any]:
        """Fetch high-resolution NWP output for a location."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        params = {
            "lat": latitude,
            "lon": longitude,
            "forecast_hours": forecast_hours,
            "pressure_level": pressure_level,
            "domain": self.domain,
            "variables": ",".join(self.variables),
        }
        
        url = f"{IMD_ENDPOINTS['nwp']}/gridpoint"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data
        except Exception as e:
            logger.error("IMD NWP fetch failed", 
                        lat=latitude, lon=longitude, error=str(e))
            return {}
    
    async def fetch_pbl_and_inversion(self,
                                     latitude: float,
                                     longitude: float) -> Dict[str, Any]:
        """Fetch Planetary Boundary Layer height and inversion strength."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        params = {
            "lat": latitude,
            "lon": longitude,
        }
        
        url = f"{IMD_ENDPOINTS['pbl']}/pbl-profile"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data
        except Exception as e:
            logger.error("IMD PBL fetch failed", 
                        lat=latitude, lon=longitude, error=str(e))
            return {}
    
    async def fetch_3d_wind_vectors(self,
                                    latitude: float,
                                    longitude: float,
                                    pressure_levels: List[str] = None) -> Dict[str, Any]:
        """Fetch 3D wind vector components."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        if pressure_levels is None:
            pressure_levels = ["surface", "850hPa", "700hPa", "500hPa"]
        
        params = {
            "lat": latitude,
            "lon": longitude,
            "pressure_levels": ",".join(pressure_levels),
        }
        
        url = f"{IMD_ENDPOINTS['wind']}/3d-vectors"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data
        except Exception as e:
            logger.error("IMD 3D wind fetch failed", 
                        lat=latitude, lon=longitude, error=str(e))
            return {}
    
    async def compute_pbl_stability_index(self,
                                          pbl_data: Dict[str, Any],
                                          surface_temp: float,
                                          surface_temp_dew: float) -> Dict[str, Any]:
        """
        Compute atmospheric stability index from PBL data.
        
        Stability depends on PBL height, temperature gradient, and moisture.
        Lower PBL with strong temperature inversion = stable conditions (traps pollution).
        """
        pbl_height = pbl_data.get("pbl_height", 0)
        temp_gradient = pbl_data.get("temp_gradient", 0)
        dew_depression = surface_temp - surface_temp_dew
        
        # Stability index: combination of PBL height and inversion strength
        # Normalized formula (higher = more stable, trapping pollution)
        if pbl_height > 0:
            stability = (temp_gradient / pbl_height) * 100 + (dew_depression * 0.5)
        else:
            stability = temp_gradient * 50 + dew_depression * 0.5
        
        # Classify stability
        if stability > 70:
            stability_class = "very_stable"  # Poor dispersion, pollution traps
        elif stability > 40:
            stability_class = "stable"  # Moderate trapping
        elif stability > 20:
            stability_class = "neutral"  # Average conditions
        else:
            stability_class = "unstable"  # Good dispersion
        
        logger.info("PBL stability index computed",
                     pbl_height=pbl_height,
                     stability=stability,
                     stability_class=stability_class)
        
        return {
            "stability_index": round(stability, 2),
            "stability_class": stability_class,
            "pbl_height": pbl_height,
            "temp_gradient": temp_gradient,
            "dew_depression": dew_depression,
        }