"""
Farm Machinery CRM Connector
Machine IoT status (Super Seeder, Happy Seeder, balers), operator assignments, 
and utilisation logs (PTO and GPS/Beidou).
"""
import asyncio
import aiohttp
import json
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import structlog

logger = structlog.get_logger()

# Farm machinery CRM API endpoints
FARM_CRM_ENDPOINTS = {
    "base": "https://api.farmcrm.example.com/v1",
    "machinery": "/machinery",
    "operators": "/operators",
    "utilisation": "/utilisation",
}


class FarmCRMConnector:
    """Connector for Farm Machinery CRM system."""
    
    def __init__(self, 
                 api_base: str = "https://api.farmcrm.example.com/v1",
                 timeout: int = 30):
        """
        Initialize Farm CRM connector.
        
        Args:
            api_base: Base API URL
            timeout: Request timeout in seconds
        """
        self.api_base = api_base.rstrip("/")
        self.timeout = timeout
        self.session: Optional[aiohttp.ClientSession] = None
        self._machinery_cache: Dict[str, Any] = {}
        self._operator_cache: Dict[str, Any] = {}
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=self.timeout)
        )
        return self
    
    async def __aexit__(self, *exc_info):
        await self.session.close()
    
    async def fetch_machinery_status(self,
                                     machine_type: Optional[str] = None,
                                     region: Optional[str] = None) -> Dict[str, Any]:
        """Fetch machinery IoT status across Punjab and Haryana."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        params = {}
        if machine_type:
            params["type"] = machine_type
        if region:
            params["region"] = region
        
        url = f"{self.api_base}{FARM_CRM_ENDPOINTS['machinery']}"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                self._machinery_cache = data
                return data
        except Exception as e:
            logger.error("Farm CRM machinery fetch failed", error=str(e))
            return {}
    
    async def fetch_operator_assignments(self,
                                        village_id: Optional[str] = None,
                                        machine_type: Optional[str] = None) -> Dict[str, Any]:
        """Fetch operator assignments for machinery."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        params = {}
        if village_id:
            params["village_id"] = village_id
        if machine_type:
            params["machine_type"] = machine_type
        
        url = f"{self.api_base}{FARM_CRM_ENDPOINTS['operators']}"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                self._operator_cache = data
                return data
        except Exception as e:
            logger.error("Farm CRM operator fetch failed", error=str(e))
            return {}
    
    async def fetch_utilisation_logs(self,
                                     machine_id: str,
                                     start_date: datetime,
                                     end_date: datetime) -> Dict[str, Any]:
        """Fetch PTO and GPS/Beidou utilisation logs for a machine."""
        if not self.session:
            raise RuntimeError("Session not initialized")
        
        params = {
            "start_date": start_date.strftime("%Y-%m-%d"),
            "end_date": end_date.strftime("%Y-%m-%d"),
        }
        
        url = f"{self.api_base}{FARM_CRM_ENDPOINTS['utilisation']}/{machine_id}"
        
        try:
            async with self.session.get(url, params=params) as resp:
                resp.raise_for_status()
                data = await resp.json()
                return data
        except Exception as e:
            logger.error("Farm CRM utilisation fetch failed", 
                        machine_id=machine_id, error=str(e))
            return {}
    
    def compute_utilisation_metrics(self, 
                                    utilisation_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Compute machinery utilisation metrics from logs.
        
        Returns: total_hours, operating_hours, utilisation_percentage, 
                 average_pto, geographic_coverage
        """
        logs = utilisation_data.get("logs", [])
        
        if not logs:
            return {
                "total_hours": 0,
                "operating_hours": 0,
                "utilisation_percentage": 0.0,
                "average_pto": 0.0,
                "geographic_coverage_km": 0.0,
                "machines_analyzed": 0,
            }
        
        # Extract PTO hours and GPS points
        pto_hours = []
        gps_points = []
        
        for log in logs:
            # PTO status
            pto = log.get("pto_status", {})
            if pto:
                pto_hours.append(pto.get("hours", 0))
            
            # GPS coordinates
            gps = log.get("gps_position", {})
            if gps and "latitude" in gps and "longitude" in gps:
                gps_points.append([gps["longitude"], gps["latitude"]])
        
        total_hours = sum(pto_hours) if pto_hours else 0
        operating_hours = len([h for h in pto_hours if h > 0])
        utilisation_pct = (operating_hours / total_hours * 100) if total_hours > 0 else 0.0
        avg_pto = np.mean(pto_hours) if pto_hours else 0.0
        
        # Geographic coverage: approximate bounding box area
        if len(gps_points) > 2:
            gps_array = np.array(gps_points)
            lon_range = np.ptp(gps_array[:, 0])  # longitude range
            lat_range = np.ptp(gps_array[:, 1])  # latitude range
            # Rough km estimate (1 degree lat ≈ 111 km, 1 degree lon ≈ 111*cos(lat) km)
            avg_lat = np.mean(gps_array[:, 1])
            lon_km = lon_range * 111 * np.cos(np.radians(avg_lat))
            lat_km = lat_range * 111
            coverage_km = np.sqrt(lon_km ** 2 + lat_km ** 2)
        else:
            coverage_km = 0.0
        
        result = {
            "total_hours": total_hours,
            "operating_hours": operating_hours,
            "utilisation_percentage": round(utilisation_pct, 2),
            "average_pto": round(avg_pto, 2),
            "geographic_coverage_km": round(coverage_km, 2),
            "machines_analyzed": len(logs),
            "total_logs": len(logs),
        }
        
        logger.info("Utilisation metrics computed",
                     total_hours=total_hours,
                     operating_hours=operating_hours,
                     utilisation_pct=utilisation_pct,
                     coverage_km=coverage_km)
        
        return result
    
    async def check_machine_availability(self,
                                         machine_type: str,
                                         region: str,
                                         required_time: datetime) -> Dict[str, Any]:
        """
        Check if machinery of a given type is available in a region 
        at a required time.
        
        Considers current utilisation, maintenance status, and operator availability.
        """
        # Fetch current status
        status = await self.fetch_machinery_status(machine_type=machine_type, region=region)
        
        machines = status.get("machines", [])
        available = []
        busy = []
        
        for machine in machines:
            machine_id = machine.get("machine_id")
            status_current = machine.get("status", "unknown")
            
            # Check if machine is available (not maintained, not heavily utilised)
            is_maintenance = machine.get("maintenance_status") == "in_maintenance"
            utilisation_pct = machine.get("current_utilisation", 0)
            
            # A machine is available if not in maintenance and utilisation < 80%
            if not is_maintenance and utilisation_pct < 80:
                available.append({
                    "machine_id": machine_id,
                    "type": machine.get("type"),
                    "current_utilisation": utilisation_pct,
                    "location": machine.get("location"),
                })
            else:
                busy.append({
                    "machine_id": machine_id,
                    "type": machine.get("type"),
                    "current_utilisation": utilisation_pct,
                    "reason": "maintenance" if is_maintenance else "high_utilisation",
                })
        
        return {
            "available": available,
            "busy": busy,
            "region": region,
            "machine_type": machine_type,
        }