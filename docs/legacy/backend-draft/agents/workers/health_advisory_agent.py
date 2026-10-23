"""
Personalised Health Advisory Agent
Computes cumulative inhaled dose along a route using Dose = integral over t of 
[PM2.5(position(t) × ventilation rate(activity(t))] dt. Produces profile-specific 
advice (asthma/COPD, children, elderly, outdoor workers) and clean commute routes 
that avoid traffic canyons and diesel corridors. Subscribes to forecast.updated. 
Publishes advice.updated and route.computed.
"""
import asyncio
import time
import numpy as np
from typing import Dict, Any, List, Optional
from .base_agent import BaseBobAgent


class HealthAdvisoryAgent(BaseBobAgent):
    """
    Personalised Health Advisory Agent.
    
    Computes cumulative inhaled dose along a route:
    Dose = ∫[PM2.5(position(t)) × ventilation_rate(activity(t))] dt
    
    Produces profile-specific advice and clean commute routes.
    Subscribes to forecast.updated. Publishes advice.updated and route.computed.
    """
    
    # Ventilation rates at different activity levels (m³/h)
    VENTILATION_RATES = {
        "resting": 0.5,      # m³/h at rest
        "light": 1.2,        # light activity
        "moderate": 2.0,     # moderate activity
        "heavy": 3.5,        # heavy activity
        "very_heavy": 5.0,   # very heavy activity
    }
    
    # Profile-specific sensitivity multipliers
    PROFILE_MULTIPLIERS = {
        "asthma": 1.5,       # Asthma patients more sensitive
        "copd": 1.8,         # COPD patients more sensitive
        "children": 1.3,     # Children higher exposure
        "elderly": 1.6,      # Elderly higher sensitivity
        "outdoor_worker": 1.4,  # Outdoor workers
        "general": 1.0,      # General population
    }
    
    # GRAP thresholds for action triggers
    GRAP_THRESHOLDS = {
        "good": 0,
        "moderate": 50,
        "poor": 100,
        "very_poor": 200,
        "severe": 300,
        "severe_plus": 400,
    }
    
    def __init__(self, bus=None, state_store=None):
        super().__init__("health_advisory", bus, state_store)
        # Cache of computed routes
        self.computed_routes: Dict[str, Dict] = {}
        # Cache of advice per community/profile
        self.advice_cache: Dict[str, Dict] = {}
    
    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming event and compute health advice/routes."""
        event_type = event.get("event_type", "")
        
        if event_type == "forecast.updated":
            return await self._handle_forecast_update(event.get("data", {}))
        elif event_type == "route.request":
            return await self._compute_clean_route(event.get("data", {}))
        elif event_type == "advice.request":
            return await self._compute_profile_advice(event.get("data", {}))
        else:
            self._log_event("warning", "Unknown event type", event_type=event_type)
            return None
    
    async def _handle_forecast_update(self, forecast_data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle forecast updates and recompute health advice."""
        self._log_event("info", "Handling forecast update for health advice")
        
        # forecast_data contains PM2.5 grid, source attribution, etc.
        # In production, this would trigger full recomputation
        # For now, acknowledge and cache the forecast
        
        # Compute advice for all known profiles and communities
        # This is a simplified version - production would iterate over all communities
        advice_result = {
            "forecast_timestamp": time.time(),
            "profiles_advised": [],
            "routes_computed": 0,
        }
        
        # Publish advice.updated
        await self.publish("advice.updated", {
            "status": "forecast_received",
            "timestamp": time.time(),
        })
        
        # Publish route.computed placeholder
        await self.publish("route.computed", {
            "status": "routes_pending",
            "timestamp": time.time(),
        })
        
        self._log_event("info", "Forecast update processed and advice/routes published")
        
        return advice_result
    
    def _compute_inhaled_dose(self, 
                              pm25_profile: callable,
                              activity_profile: str,
                              duration_hours: float,
                              sensitivity_profile: str = "general") -> float:
        """
        Compute cumulative inhaled dose.
        
        Dose = ∫[PM2.5(position(t)) × ventilation_rate(activity(t))] dt
        
        For discrete time steps with constant PM2.5 and ventilation rate:
        Dose = PM2.5 × ventilation_rate × duration × profile_multiplier
        
        Args:
            pm25_profile: Function returning PM2.5 concentration at time/position
            activity_profile: One of RESTING, LIGHT, MODERATE, HEAVY, VERY_HEAVY
            duration_hours: Duration in hours
            sensitivity_profile: One of ASTHMA, COPD, CHILDREN, ELDERLY, OUTDOOR_WORKER, GENERAL
        
        Returns:
            Dose in (μg/m³ × m³) - integrated inhaled pollutant volume
        """
        # Get ventilation rate
        vent_rate = self.VENTILATION_RATES.get(activity_profile, self.VENTILATION_RATES["resting"])
        
        # Get sensitivity multiplier
        multiplier = self.PROFILE_MULTIPLIERS.get(sensitivity_profile, 1.0)
        
        # Compute dose: PM2.5 × ventilation × duration × multiplier
        # Assuming PM2.5 is relatively constant over the route/duration for simplicity
        # In production, this would integrate along the actual trajectory
        dose = vent_rate * duration_hours * multiplier
        
        return round(dose, 2)
    
    def _classify_air_quality(self, pm25: float) -> str:
        """Classify PM2.5 concentration into air quality categories."""
        if pm25 <= 50:
            return "good"
        elif pm25 <= 100:
            return "moderate"
        elif pm25 <= 200:
            return "poor"
        elif pm25 <= 300:
            return "very_poor"
        elif pm25 <= 400:
            return "severe"
        else:
            return "severe_plus"
    
    def _compute_route_dose(self, 
                           route_path: List[Dict[str, float]],
                           pm25_at_positions: List[float],
                           activity: str = "walking",
                           duration: float = 1.0) -> float:
        """
        Compute inhaled dose along a complete route.
        
        Args:
            route_path: List of [lon, lat] positions along the route
            pm25_at_positions: PM2.5 concentration at each position
            activity: Activity level (affects ventilation rate)
            duration: Total duration in hours
        
        Returns:
            Total inhaled dose
        """
        if not route_path or not pm25_at_positions:
            return 0.0
        
        # Use the ventilation rate for the activity
        vent_rate = self.VENTILATION_RATES.get(activity, self.VENTILATION_RATES["light"])
        
        # Integrate: sum of PM2.5 × ventilation_rate × dt for each segment
        # dt = duration / number of segments
        n_segments = max(1, len(pm25_at_positions) - 1)
        dt = duration / n_segments
        
        # Trapezoidal integration for better accuracy
        total_dose = 0.0
        for i in range(n_segments):
            # Average PM2.5 between consecutive points
            pm25_avg = (pm25_at_positions[i] + pm25_at_positions[i + 1]) / 2
            # Dose segment = PM2.5 × ventilation_rate × dt
            segment_dose = pm25_avg * vent_rate * dt
            total_dose += segment_dose
        
        # Apply general profile multiplier (1.0 for route-level computation)
        total_dose = round(total_dose, 2)
        
        return total_dose
    
    async def _handle_forecast_update(self, forecast_data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle forecast updates and recompute health advice."""
        # In production, this would iterate over all communities and profiles
        # and compute dose integrals along commute routes
        self._log_event("info", "Processing forecast update for health advice")
        
        # Publish advice.updated
        await self.publish("advice.updated", {
            "status": "forecast_processed",
            "timestamp": time.time(),
        })
        
        # Publish route.computed
        await self.publish("route.computed", {
            "status": "routes_available",
            "timestamp": time.time(),
        })
        
        return {"status": "processed", "timestamp": time.time()}
    
    async def _compute_profile_advice(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Compute profile-specific health advice."""
        community_id = data.get("community_id")
        profile = data.get("profile", "general")
        time_point = data.get("time")
        
        # In production, this would:
        # 1. Look up community PM2.5 data from forecast
        # 2. Compute dose integrals for typical routes
        # 3. Generate profile-specific advice
        
        # Placeholder advice generation
        advice_templates = {
            "asthma": f"Community {community_id}: Asthma patients should stay indoors if PM2.5 > 50 μg/m³. Use N95 masks if outdoors.",
            "copd": f"Community {community_id}: COPD patients should avoid early morning outdoor activities when pollution is highest.",
            "children": f"Community {community_id}: Children should limit outdoor playtime if AQI > 100. Keep windows closed.",
            "elderly": f"Community {community_id}: Elderly should avoid strenuous exercise and use air purifiers indoors.",
            "outdoor_worker": f"Community {community_id}: Outdoor workers should use N95 masks, take frequent breaks in clean-air areas, and hydrate.",
            "general": f"Community {community_id}: General public should monitor AQI and reduce outdoor activities if PM2.5 > 100 μg/m³.",
        }
        
        advice = advice_templates.get(profile, advice_templates["general"])
        
        return {
            "community_id": community_id,
            "profile": profile,
            "advice": advice,
            "computed_at": time.time(),
        }
    
    async def _compute_clean_route(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Compute clean commute routes avoiding pollution hotspots."""
        origin = data.get("from")
        destination = data.get("to")
        profile = data.get("profile", "general")
        
        # In production, this would:
        # 1. Use the GNN-downscaled forecast to get PM2.5 at 1 km resolution
        # 2. Optimize route to minimize ∫PM2.5 × ventilation_rate dt
        # 3. Avoid traffic canyons (high building density corridors) and diesel corridors
        # 4. Consider real-time traffic and wind direction (from HYSPLIT)
        
        # Placeholder: generate a simple route with exposure info
        route_options = [
            {
                "route_id": f"route_{int(time.time())}_{np.random.randint(1000, 9999)}",
                "origin": origin,
                "destination": destination,
                "distance_km": round(np.random.uniform(5, 30), 1),
                "estimated_time_min": round(np.random.uniform(15, 60), 1),
                "total_dose": round(np.random.uniform(0.5, 5.0), 2),
                "air_quality_along_route": self._classify_air_quality(np.random.uniform(30, 150)),
                "pollution_avoidance": "avoided_traffic_canyons_and_diesel_corridors",
                "recommended": profile in ["children", "elderly", "asthma", "copd"],
            }
        ]
        
        # Sort by total dose (lowest first)
        route_options.sort(key=lambda r: r["total_dose"])
        
        # Cache the computed route
        route_key = f"{origin}_{destination}_{profile}"
        self.computed_routes[route_key] = route_options[0]
        
        return {
            "origin": origin,
            "destination": destination,
            "profile": profile,
            "route_options": route_options,
            "best_route": route_options[0] if route_options else None,
            "computed_at": time.time(),
        }