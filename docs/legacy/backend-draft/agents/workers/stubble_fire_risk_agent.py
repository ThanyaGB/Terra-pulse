"""
Stubble Fire Risk Agent
Starts 7–10 days before harvest. Computes village/parcel risk score:
Risk Score = f(NDVI decay slope, sowing window days remaining, soil moisture index, 
historical fire density, local machinery shortfall).
Tiers: low, medium, high, critical. Publishes risk.updated and sends the list to the FPO.
"""
import asyncio
import numpy as np
from typing import Dict, Any, List, Optional
from .base_agent import BaseBobAgent


class StubbleFireRiskAgent(BaseBobAgent):
    """
    Stubble Fire Risk Agent.
    
    Computes village/parcel risk score for stubble burning based on:
    - NDVI decay slope (vegetation state)
    - Sowing window days remaining until next crop
    - Soil moisture index
    - Historical fire density
    - Local machinery shortfall (Super Seeder/Happy Seeder availability)
    
    Risk Tiers: low (0-3), medium (3.1-6), high (6.1-8), critical (8.1-10)
    """
    
    def __init__(self, bus=None, state_store=None):
        super().__init__("stubble_fire_risk", bus, state_store)
        # Risk score thresholds
        self.tiers = {
            "low": (0, 3),
            "medium": (3.1, 6),
            "high": (6.1, 8),
            "critical": (8.1, 10),
        }
        # Historical fire density lookup (village_id -> density)
        self.historical_fire_density: Dict[str, float] = {}
        # Machinery shortfall cache
        self.machinery_shortfall: Dict[str, float] = {}
    
    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming event and compute risk scores."""
        event_type = event.get("event_type", "")
        
        if event_type == "data.normalised":
            return await self._compute_risk_scores(event.get("data", {}))
        elif event_type == "harvest.calendar.update":
            return await self._update_harvest_schedule(event.get("data", {}))
        elif event_type == "risk.threshold.update":
            return await self._update_thresholds(event.get("data", {}))
        else:
            self._log_event("warning", "Unknown event type", event_type=event_type)
            return None
    
    async def _compute_risk_scores(self, normalised_data: Dict[str, Any]) -> Dict[str, Any]:
        """Compute risk scores for all villages/parcels."""
        records = normalised_data.get("records", [])
        
        # Group records by village/parcel
        village_data: Dict[str, List[Dict]] = {}
        for record in records:
            # Use a village/parcel identifier from the record
            # In production, this would come from a parcel registry
            village_id = record.get("village_id", record.get("parcel_id", "unknown"))
            if village_id not in village_data:
                village_data[village_id] = []
            village_data[village_id].append(record)
        
        risk_results = []
        for village_id, village_records in village_data.items():
            risk_score = self._calculate_village_risk(village_id, village_records)
            risk_results.append(risk_score)
        
        # Sort by risk score (highest first)
        risk_results.sort(key=lambda x: x["risk_score"], reverse=True)
        
        # Determine tiers
        for result in risk_results:
            tier = self._classify_tier(result["risk_score"])
            result["tier"] = tier
            # Categorise machinery shortfall
            result["machinery_shortfall_pct"] = self._estimate_machinery_shortfall(village_id)
        
        # Publish risk updated
        risk_event = {
            "event_type": "risk.updated",
            "source": self.agent_name,
            "agent_id": self.agent_id,
            "trace_id": self.trace_id,
            "timestamp": time.time(),
            "data": {
                "risk_results": risk_results,
                "computed_at": time.time(),
            }
        }
        await self.publish("risk.updated", risk_event.data)
        
        # Send list to FPO (would be via dedicated FPO channel in production)
        self._log_event("info", "Risk scores computed and published",
                       village_count=len(risk_results))
        
        return {"event_type": "risk.updated", "risk_results": risk_results}
    
    def _calculate_village_risk(self, village_id: str, records: List[Dict[str, Any]]) -> float:
        """
        Calculate village risk score (0-10).
        
        Risk Score = f(NDVI decay slope, sowing window days remaining, 
                       soil moisture index, historical fire density, 
                       local machinery shortfall)
        
        Each component is weighted and normalized to 0-10 scale.
        """
        if not records:
            return 5.0  # Default medium risk for unknown areas
        
        # 1. NDVI decay slope component (weight: 0.3, inverted so decay = higher risk)
        ndvi_decays = []
        for record in records:
            slope = record.get("ndvi_decay_slope", 0)
            # Negative slope means decay; we invert so decay contributes to risk
            # Clamp to reasonable range and invert
            decay_factor = max(0, -slope)  # Positive if decaying
            ndvi_decays.append(decay_factor)
        
        avg_ndvi_decay = np.mean(ndvi_decays) if ndvi_decays else 0
        # Normalise: assume slopes range from -0.3 (rapid decay) to 0.0 (stable)
        ndvi_component = min(10, avg_ndvi_decay * 20)  # 0.05 slope -> 1, 0.3 slope -> 6
        
        # 2. Sowing window days remaining component (weight: 0.25)
        # More days remaining = more time for intervention = lower risk
        sowing_days = self._get_sowing_days_remaining(village_id)
        # Assume 120-day sowing window; days_remaining from 0-120
        # Invert: 120 days = low risk (0), 0 days = critical risk (10)
        sowing_component = max(0, 10 - (sowing_days / 12) if sowing_days else 10)
        if sowing_days is None:
            sowing_component = 10  # No data = max risk
        
        # 3. Soil moisture index component (weight: 0.2)
        # Lower soil moisture = higher fire risk when burning occurs
        soil_moisture_values = []
        for record in records:
            sm = record.get("soil_moisture_index", 0.5)  # default 0.5
            soil_moisture_values.append(sm)
        avg_soil_moisture = np.mean(soil_moisture_values) if soil_moisture_values else 0.5
        # Normalise: 0 = very dry (high risk), 1 = very wet (low risk)
        soil_component = (1 - avg_soil_moisture) * 10
        
        # 4. Historical fire density component (weight: 0.15)
        hist_density = self.historical_fire_density.get(village_id, 0.1)
        # Normalise density (fires per season per 100 km²)
        density_component = min(10, hist_density * 50)
        
        # 5. Local machinery shortfall component (weight: 0.1)
        machinery_shortfall = self.machinery_shortfall.get(village_id, 0.1)
        # Normalise: 0 = full machinery, 1 = complete shortfall
        machinery_component = min(10, machinery_shortfall * 10)
        
        # Weighted sum
        risk_score = (
            ndvi_component * 0.3 +
            sowing_component * 0.25 +
            soil_component * 0.20 +
            density_component * 0.15 +
            machinery_component * 0.10
        )
        
        return round(risk_score, 2)
    
    def _classify_tier(self, risk_score: float) -> str:
        """Classify risk score into tier."""
        for tier, (low, high) in self.tiers.items():
            if low <= risk_score <= high:
                return tier
        return "low"  # fallback
    
    def _get_sowing_days_remaining(self, village_id: str) -> Optional[int]:
        """Get days remaining in sowing window for a village."""
        # In production, this would query a harvest calendar DB
        # For now, return a placeholder based on season
        from datetime import datetime
        month = datetime.utcnow().month
        # Punjab Haryana rabi season: Oct-Nov sowing, Apr-May harvest
        # Simplified: days remaining decreases as we approach harvest
        if month in [10, 11, 12]:  # Sowing season
            return 90  # Approximate days remaining
        elif month in [1, 2, 3, 4, 5]:  # Near harvest
            # Days decrease from ~90 to 0
            day_offset = datetime.utcnow().day
            return max(0, 90 - day_offset * 3)
        elif month in [6, 7, 8, 9]:  # Post-harvest
            return 0
        else:
            return 50  # Default
    
    def _estimate_machinery_shortfall(self, village_id: str) -> float:
        """Estimate machinery shortfall proportion for a village."""
        return self.machinery_shortfall.get(village_id, 0.1)
    
    async def _update_harvest_schedule(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update historical fire density from harvest calendar."""
        village_id = data.get("village_id")
        fire_density = data.get("fire_density")
        if village_id and fire_density is not None:
            self.historical_fire_density[village_id] = fire_density
            self._log_event("info", "Historical fire density updated",
                           village_id=village_id, density=fire_density)
        return {}
    
    async def _update_thresholds(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update risk score thresholds."""
        new_tiers = data.get("tiers", self.tiers)
        self.tiers = new_tiers
        self._log_event("info", "Risk thresholds updated", tiers=new_tiers)
        return {}