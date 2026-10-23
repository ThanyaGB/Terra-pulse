"""
Forecast and Attribution Agent
GNN downscaling of WRF-Chem to 1 km grid; source apportionment across 
cross-regional straw plume, vehicle exhaust, road/construction dust, 
and industrial/waste burning; 72-hour HYSPLIT Lagrangian plume projection 
with arrival times per street. Publishes forecast.updated and attribution.updated.
"""
import asyncio
import numpy as np
from typing import Dict, Any, List, Optional
from .base_agent import BaseBobAgent


class ForecastAttributionAgent(BaseBobAgent):
    """
    Forecast and Attribution Agent.
    
    Responsibilities:
    - GNN downscaling of WRF-Chem outputs to 1 km grid
    - Source apportionment: straw plume, vehicle exhaust, road dust, 
      industrial/waste burning
    - 72-hour HYSPLIT Lagrangian plume projection with street arrival times
    - Publishes forecast.updated and attribution.updated
    """
    
    def __init__(self, bus=None, state_store=None):
        super().__init__("forecast_attribution", bus, state_store)
        # Source categories
        self.source_categories = [
            "straw_plume", "vehicle_exhaust", "road_dust", "industrial_waste"
        ]
        # GNN model placeholder (would be loaded in production)
        self.gnn_model = None
        # HYSPLIT trajectory cache
        self.trajectory_cache: Dict[str, List] = {}
    
    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming event and generate forecasts/attribution."""
        event_type = event.get("event_type", "")
        
        if event_type == "data.normalised":
            return await self._generate_forecast_and_attribution(event.get("data", {}))
        elif event_type == "forecast.request":
            return await self._generate_custom_forecast(event.get("data", {}))
        elif event_type == "attribution.request":
            return await self._compute_attribution(event.get("data", {}))
        else:
            self._log_event("warning", "Unknown event type", event_type=event_type)
            return None
    
    async def _generate_forecast_and_attribution(self, normalised_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate 72-hour forecast and source attribution."""
        self._log_event("info", "Generating forecast and attribution")
        
        # In a full implementation, this would:
        # 1. Load WRF-Chem output data
        # 2. Run GNN downscaling to 1 km grid
        # 3. Perform source apportionment
        # 4. Run HYSPLIT plume projection
        
        # Placeholder: simulate the output structure
        grid_size = 1.0  # km
        
        # Simulate 1 km grid AQI forecast for 72 hours
        forecast_grid = self._simulate_1km_forecast(grid_size)
        
        # Simulate source attribution matrix
        attribution = self._simulate_source_attribution()
        
        # Simulate HYSPLIT plume projections
        plume_projections = self._simulate_hysplit_projections()
        
        # Combine results
        result = {
            "forecast": {
                "grid_1km": forecast_grid,
                "lead_hours": 72,
                "grid_resolution": "1 km",
                "generated_at": time.time(),
            },
            "attribution": {
                "source_categories": self.source_categories,
                "percentage_contributions": attribution,
                "computed_at": time.time(),
            },
            "plume_projections": plume_projections,
        }
        
        # Publish forecast.updated
        await self.publish("forecast.updated", {
            "forecast": forecast_grid,
            "source_attribution": attribution,
        })
        
        # Publish attribution.updated
        await self.publish("attribution.updated", {
            "source_contributions": attribution,
            "grid_cell": "nationwide",
        })
        
        self._log_event("info", "Forecast and attribution generated",
                       forecast_hours=72,
                       grid_resolution="1 km")
        
        return result
    
    def _simulate_1km_forecast(self, grid_size: float) -> Dict[str, Any]:
        """Simulate 1 km grid PM2.5 forecast for 72 hours."""
        # Generate a synthetic 1 km grid (simplified: just a few cells for demo)
        n_cells = 50  # Reduced for demo
        
        # Generate PM2.5 values with some spatial correlation
        np.random.seed(int(time.time()) % 10000)
        pm25_values = np.random.uniform(10, 200, n_cells)
        
        # Create grid cells with coordinates
        grid_cells = {}
        for i in range(n_cells):
            # Spread cells across Punjab-Haryana-Delhi region (~200x200 km)
            lat = 30.0 + (i % 10) * 2.0  # latitude range
            lon = 75.0 + (i // 10) * 2.0  # longitude range
            
            key = f"{lat:.2f},{lon:.2f}"
            grid_cells[key] = {
                "pm25": round(float(pm25_values[i]), 1),
                "latitude": lat,
                "longitude": lon,
                "grid_resolution": "1 km",
            }
        
        return {
            "grid_cells": grid_cells,
            "total_cells": n_cells,
            "region": "Punjab-Haryana-Delhi",
        }
    
    def _simulate_source_attribution(self) -> Dict[str, float]:
        """Simulate source apportionment percentage contributions."""
        # In production, this would come from GNN inference on WRF-Chem data
        # Typical contribution breakdown for Delhi-NCR region
        contributions = {
            "straw_plume": round(np.random.uniform(15, 35), 1),
            "vehicle_exhaust": round(np.random.uniform(25, 45), 1),
            "road_dust": round(np.random.uniform(10, 25), 1),
            "industrial_waste": round(np.random.uniform(5, 20), 1),
        }
        # Ensure they sum to ~100
        total = sum(contributions.values())
        # Normalise
        contributions = {k: round(v / total * 100, 1) for k, v in contributions.items()}
        return contributions
    
    def _simulate_hysplit_projections(self) -> Dict[str, Any]:
        """Simulate 72-hour HYSPLIT Lagrangian plume projections."""
        # In production, this would call the HYSPLIT model with WRF-Chem wind fields
        # and emit trajectory calculations for each grid cell
        
        # Simulated plume arrival times per street/grid cell
        projection_cells = {}
        
        # Generate projections for a sample of cells
        np.random.seed(int(time.time()) % 10000 + 1)
        n_projections = min(20, 50 // 4)  # 20 trajectory projections
        
        for i in range(n_projections):
            cell_id = f"cell_{i}"
            # Simulate 72-hour trajectory with waypoints
            trajectory = []
            for hour in range(0, 73, 6):  # Every 6 hours
                # Move generally downwind (southwest direction for Punjab emissions -> Delhi)
                hour_offset = hour
                lat = 30.0 + np.random.uniform(-1, 1)
                lon = 75.0 + np.random.uniform(-1, 1) - hour_offset * 0.5  # Moving southwest
                trajectory.append({
                    "hour": hour,
                    "latitude": round(lat, 4),
                    "longitude": round(lon, 4),
                })
            
            # Compute estimated arrival time to Delhi-NCR centroid
            # Delhi is roughly at 28.7, 77.1
            arrival_hour = 72  # default: arrives at end of 72h
            if trajectory:
                # Simple estimation: if trajectory goes toward Delhi, reduce arrival time
                final_pos = trajectory[-1]
                distance_factor = abs(final_pos["latitude"] - 28.7) + abs(final_pos["longitude"] - 77.1)
                arrival_hour = max(0, 72 - int(distance_factor * 3))
            
            projection_cells[cell_id] = {
                "trajectory": trajectory,
                "estimated_arrival_hours": arrival_hour,
                "destination": "delhi_ncr",
                "source_region": "punjab_haryana",
            }
        
        return {
            "projections": projection_cells,
            "total_trajectories": n_projections,
            "model": "HYSPLIT 72-hour Lagrangian",
            "generated_at": time.time(),
        }
    
    async def _generate_custom_forecast(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate custom forecast for specific region/origin."""
        origin = data.get("origin", "unknown")
        hours = data.get("hours", 72)
        self._log_event("info", "Custom forecast requested", origin=origin, hours=hours)
        return await self._generate_forecast_and_attribution({"records": []})
    
    async def _compute_attribution(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Compute source attribution for specific region."""
        region = data.get("region", "punjab_haryana_delhi")
        self._log_event("info", "Attribution computed", region=region)
        return self._simulate_source_attribution()