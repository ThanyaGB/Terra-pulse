"""
Sentinel-2 Connector
Surface reflectance tiles. Compute NDVI and its decay slope per field parcel.
"""
import asyncio
import aiohttp
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import structlog

logger = structlog.get_logger()

# Sentinel-2 API endpoints (Copernicus / STAC)
SENTINEL2_ENDPOINTS = {
    "stac": "https://earth-search.open-metadata.cloud/stac/search",
    "copernicus": "https://catalogue.dataspace.copernicus.eu/api/v1/search",
}


class Sentinel2Connector:
    """Connector for Sentinel-2 surface reflectance data."""
    
    def __init__(self, 
                 bbox: List[float],
                 start_date: datetime,
                 end_date: datetime,
                 cloud_filter: float = 20.0):
        """
        Initialize Sentinel-2 connector.
        
        Args:
            bbox: Bounding box [min_lon, min_lat, max_lon, max_lat] for field parcels
            start_date: Start of observation window
            end_date: End of observation window
            cloud_filter: Maximum cloud percentage (0-100)
        """
        self.bbox = bbox
        self.start_date = start_date
        self.end_date = end_date
        self.cloud_filter = cloud_filter
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, *exc_info):
        await self.session.close()
    
    async def search_tile(self) -> Dict[str, Any]:
        """Search for Sentinel-2 tiles within the configured bbox and date range."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        # STAC search query
        query = {
            "intersects": {
                "type": "Polygon",
                "coordinates": [
                    [self.bbox[0], self.bbox[1]],
                    [self.bbox[2], self.bbox[1]],
                    [self.bbox[2], self.bbox[3]],
                    [self.bbox[0], self.bbox[3]],
                    [self.bbox[0], self.bbox[1]]
                ]
            },
            "datetime": f"{self.start_date.isoformat()}/{self.end_date.isoformat()}",
            "query": {
                "cloudcover": [0, self.cloud_filter]
            },
            "collections": ["sentinel-2"],
            "limit": 10
        }
        
        url = f"{SENTINEL2_ENDPOINTS['stac']}/search"
        
        try:
            async with self.session.post(url, json=query) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data
        except Exception as e:
            logger.error("Sentinel-2 search failed", error=str(e))
            return {}
    
    async def compute_ndvi(self, 
                          b08: np.ndarray,  # Red band (B08 is actually NIR in Sentinel-2, but naming varies)
                          b04: np.ndarray) -> np.ndarray:
        """
        Compute Normalized Difference Vegetation Index (NDVI).
        
        NDVI = (NIR - Red) / (NIR + Red)
        Sentinel-2 bands: B04 = Red (665nm), B08 = NIR (842nm)
        """
        # Convert to float to avoid integer division
        b08 = b08.astype(float)
        b04 = b04.astype(float)
        
        # Replace zero/negative values with NaN for proper indexing
        with np.errstate(divide='ignore', invalid='ignore'):
            ndvi = (b08 - b04) / (b08 + b04)
            ndvi = np.where((b08 + b04) == 0, np.nan, ndvi)
        
        # Clip to valid NDVI range [-1, 1]
        ndvi = np.clip(ndvi, -1, 1)
        
        return ndvi
    
    async def compute_ndvi_decay_slope(self, 
                                       parcel_id: str,
                                       historical_ndvi: List[float]) -> Dict[str, Any]:
        """
        Compute NDVI decay slope per field parcel.
        
        Uses linear regression on historical NDVI values to determine 
        the rate of vegetation decay.
        
        Returns:
            dict with slope, r_squared, and decay category
        """
        if len(historical_ndvi) < 2:
            return {"slope": 0.0, "r_squared": 0.0, "decay_category": "stable", "parcel_id": parcel_id}
        
        # Create time axis (days)
        times = np.arange(len(historical_ndvi))
        
        # Linear regression: y = slope * x + intercept
        # Using numpy polyfit
        slope, intercept = np.polyfit(times, historical_ndvi, 1)
        
        # Compute R-squared
        y_pred = slope * times + intercept
        ss_res = np.sum((np.array(historical_ndvi) - y_pred) ** 2)
        ss_tot = np.sum((np.array(historical_ndvi) - np.mean(historical_ndvi)) ** 2)
        r_squared = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0.0
        
        # Determine decay category
        if slope > -0.05:
            decay_category = "stable"
        elif slope < -0.15:
            decay_category = "rapid_decay"
        else:
            decay_category = "moderate_decay"
        
        logger.info("NDVI decay computed",
                     parcel_id=parcel_id,
                     slope=float(slope),
                     r_squared=float(r_squared),
                     decay_category=decay_category)
        
        return {
            "parcel_id": parcel_id,
            "slope": float(slope),
            "r_squared": float(r_squared),
            "decay_category": decay_category,
            "historical_ndvi_length": len(historical_ndvi)
        }