"""
NASA FIRMS Connector
Poll VIIRS 375m and MODIS 1km thermal anomalies, cluster hotspots 
spatially into fire clusters per village.
"""
import asyncio
import aiohttp
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import structlog

logger = structlog.get_logger()

# FIRMS API endpoints
FIRMS_ENDPOINTS = {
    "viirs": "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
    "modis": "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
}


class FirmsConnector:
    """Connector for NASA FIRMS thermal anomaly data."""
    
    def __init__(self, bbox: Optional[List[float]] = None, 
                 days_back: int = 1,
                 sensor: str = "viirs"):
        """
        Initialize FIRMS connector.
        
        Args:
            bbox: Bounding box [min_lon, min_lat, max_lon, max_lat] for Punjab/Haryana region
            days_back: Number of days to look back
            sensor: "viirs" or "modis"
        """
        self.bbox = bbox  # [min_lon, min_lat, max_lon, max_lat]
        self.days_back = days_back
        self.sensor = sensor
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, *exc_info):
        await self.session.close()
    
    async def poll_anomalies(self) -> List[Dict[str, Any]]:
        """Poll FIRMS for thermal anomalies within the configured window."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        # Build the FIRMS request with bbox and date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=self.days_back)
        
        # FIRMS expects bbox in: min_lon,min_lat,max_lon,max_lat
        # and dates in YYYY-MM-DD format
        params = {
            "bbox": ",".join(str(x) for x in self.bbox) if self.bbox else "",
            "format": "json",
            "day": start_date.strftime("%Y-%m-%d"),
        }
        
        url = f"{FIRMS_ENDPOINTS[self.sensor]}/latest"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return self._parse_anomalies(data)
        except Exception as e:
            logger.error("FIRMS poll failed", sensor=self.sensor, error=str(e))
            return []
    
    def _parse_anomalies(self, data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Parse FIRMS response into structured anomaly records."""
        anomalies = []
        # FIRMS response format varies by sensor; parse common fields
        for record in data.get("records", []):
            anomaly = {
                "latitude": float(record.get("latitude", 0)),
                "longitude": float(record.get("longitude", 0)),
                "bright_temperature": float(record.get("bright_temperature", 0)),
                "scan": float(record.get("scan", 0)),
                "track": float(record.get("track", 0)),
                "satellite": record.get("satellite", self.sensor.upper()),
                "acquisition_date": record.get("acquisition_date", datetime.utcnow().isoformat()),
                "confidence": record.get("confidence", "medium"),
                "bright_temperature_archive": float(record.get("bright_temperature_archive", 0)),
            }
            anomalies.append(anomaly)
        return anomalies
    
    async def cluster_hotspots(self, anomalies: List[Dict[str, Any]], 
                              eps: float = 0.5, min_samples: int = 3) -> List[Dict[str, Any]]:
        """
        Cluster thermal anomaly hotspots spatially into fire clusters per village.
        
        Uses DBSCAN clustering on (lon, lat) coordinates.
        """
        if not anomalies:
            return []
        
        from sklearn.cluster import DBSCAN
        
        # Extract coordinates
        coords = np.array([[a["longitude"], a["latitude"]] for a in anomalies])
        
        # Apply DBSCAN clustering
        clustering = DBSCAN(eps=eps, min_samples=min_samples).fit(coords)
        
        labels = clustering.labels_
        n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
        
        logger.info("Hotspot clustering completed", 
                     total_anomalies=len(anomalies), 
                     n_clusters=n_clusters,
                     n_noise=sum(1 for l in labels if l == -1))
        
        # Group anomalies by cluster
        clusters = []
        for label in set(labels):
            cluster_anomalies = [a for a, l in zip(anomalies, labels) if l == label]
            if label == -1:
                # Noise cluster - treat individually
                for a in cluster_anomalies:
                    clusters.append({
                        "type": "noise",
                        "anomalies": [a],
                        "center": {"latitude": a["latitude"], "longitude": a["longitude"]},
                        "village_id": None,
                        "size": 1,
                    })
            else:
                # Compute cluster center
                lons = [a["longitude"] for a in cluster_anomalies]
                lats = [a["latitude"] for a in cluster_anomalies]
                center_lat = np.mean(lats)
                center_lon = np.mean(lons)
                
                clusters.append({
                    "type": "fire_cluster",
                    "anomalies": cluster_anomalies,
                    "center": {"latitude": float(center_lat), "longitude": float(center_lon)},
                    "village_id": None,  # Will be matched later
                    "size": len(cluster_anomalies),
                    "confidence": "high" if len(cluster_anomalies) >= min_samples else "medium",
                })
        
        return clusters