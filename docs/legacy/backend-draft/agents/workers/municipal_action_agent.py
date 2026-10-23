"""
Municipal Action Agent
Maps attribution and peak alerts to GRAP tiers. Generates dust-suppression work 
orders, dispatches sweepers and fog cannons, issues diesel truck diversion orders 
in coordination with traffic authorities, tracks SLA, and measures ΔPM2.5 4–12 hours 
after each action for ROI. Subscribes to attribution.updated. Publishes workorder.created 
and roi.measured.
"""
import asyncio
import numpy as np
import time
from typing import Dict, Any, List, Optional
from .base_agent import BaseBobAgent


class MunicipalActionAgent(BaseBobAgent):
    """
    Municipal Action Agent.
    
    Responsibilities:
    - Maps source attribution and peak alerts to GRAP (Graded Response Action Plan) tiers
    - Generates dust-suppression work orders for fog cannons and sweepers
    - Issues diesel truck diversion orders in coordination with traffic authorities
    - Tracks Service Level Agreement (SLA) for each action
    - Measures ΔPM2.5 4–12 hours after each action for ROI calculation
    - Subscribes to attribution.updated
    - Publishes workorder.created and roi.measured
    """
    
    # GRAP tier thresholds and corresponding actions
    GRAP_TIERS = {
        "40-100 (Moderate)": {
            "name": "Moderate",
            "actions": ["continuous_monitoring", "public_awareness"],
            "fog_cannon_threshold": False,
            "sweeper_dispatch": False,
        },
        "100-200 (Poor)": {
            "name": "Poor",
            "actions": ["traffic_diversion", "road_sprinkling"],
            "fog_cannon_threshold": True,
            "sweeper_dispatch": True,
        },
        "200-300 (Very Poor)": {
            "name": "Very Poor",
            "actions": ["industrial_suspension", "brick_kiln_closure", "fog_cannon_dust_suppression"],
            "fog_cannon_threshold": True,
            "sweeper_dispatch": True,
        },
        "300-400 (Severe)": {
            "name": "Severe",
            "actions": ["thermal_power_suspension", "construction_ban", "odd_even_vehicle_restriction",
                       "mandatory_fog_cannon_deployment"],
            "fog_cannon_threshold": True,
            "sweeper_dispatch": True,
        },
        "400+ (Severe Plus)": {
            "name": "Severe Plus",
            "actions": ["all_measures", "school_closures", "stop_all_construction", "emergency_measures"],
            "fog_cannon_threshold": True,
            "sweeper_dispatch": True,
        },
    }
    
    # SLA timeframes (hours) for different action types
    SLA_TIMEFRAMES = {
        "diversion_order": 2,     # Must be issued within 2 hours of alert
        "fog_cannon_deploy": 4,   # Must deploy within 4 hours
        "sweeper_dispatch": 6,    # Must dispatch within 6 hours
        "workorder_complete": 24, # Work order completion SLA
    }
    
    # ROI measurement windows (hours after action)
    ROI_WINDOWS = {
        "immediate": 4,    # ΔPM2.5 measured 4 hours after action
        "short_term": 12,  # ΔPM2.5 measured 12 hours after action
    }
    
    def __init__(self, bus=None, state_store=None):
        super().__init__("municipal_action", bus, state_store)
        # Active work orders tracking
        self.active_workorders: Dict[str, Dict] = {}
        # ROI measurements per pilot area
        self.roi_measurements: Dict[str, List[Dict]] = {}
        # Traffic authority coordination state
        self.traffic_coordination: Dict[str, bool] = {}
        # GRAP current tier state
        self.current_grap_tier = "40-100 (Moderate)"
        # Last attribution data
        self.last_attribution: Dict[str, Any] = {}
    
    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming event and trigger municipal actions."""
        event_type = event.get("event_type", "")
        
        if event_type == "attribution.updated":
            return await self._handle_attribution_update(event.get("data", {}))
        elif event_type == "roi.measurement.request":
            return await self._measure_roi(event.get("data", {}))
        elif event_type == "sla.check":
            return await self._check_sla(event.get("data", {}))
        else:
            self._log_event("warning", "Unknown event type", event_type=event_type)
            return None
    
    async def _handle_attribution_update(self, attribution_data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle attribution updates and determine GRAP tier actions."""
        self.last_attribution = attribution_data
        
        # Get source attribution percentages
        source_contributions = attribution_data.get("source_contributions", {})
        
        # Determine the dominant source category
        if source_contributions:
            dominant_source = max(source_contributions, key=source_contributions.get)
        else:
            dominant_source = "unknown"
        
        # Determine GRAP tier based on current PM2.5 levels
        # In production, this would use actual monitored PM2.5 data
        current_pm25 = attribution_data.get("current_pm25", 150)  # placeholder
        grap_tier = self._determine_grap_tier(current_pm25)
        
        # Update current tier if changed
        if grap_tier != self.current_grap_tier:
            self.current_grap_tier = grap_tier
            self._log_event("info", "GRAP tier updated", 
                           old_tier=self.current_grap_tier if hasattr(self, 'current_grap_tier') else 'N/A',
                           new_tier=grap_tier,
                           pm25=current_pm25)
        
        # Generate work orders based on GRAP tier actions
        workorders = self._generate_workorders(grap_tier, source_contributions)
        
        # Publish workorder.created for each generated work order
        for workorder in workorders:
            booking_event = {
                "event_type": "workorder.created",
                "source": self.agent_name,
                "agent_id": self.agent_id,
                "trace_id": self.trace_id,
                "timestamp": time.time(),
                "data": workorder,
            }
            await self.publish("workorder.created", booking_event.data)
        
        self._log_event("info", "Attribution update handled, GRAP tier actions triggered",
                       grap_tier=grap_tier,
                       workorders_generated=len(workorders),
                       dominant_source=dominant_source)
        
        return {"grap_tier": grap_tier, "workorders": workorders, "dominant_source": dominant_source}
    
    def _determine_grap_tier(self, pm25: float) -> str:
        """Determine GRAP tier based on PM2.5 concentration."""
        for tier_range, tier_data in self.GRAP_TIERS.items():
            # Parse range like "100-200 (Poor)"
            parts = tier_range.split("-")
            lower = float(parts[0].strip())
            upper = float(parts[1].strip())
            if lower <= pm25 <= upper:
                return tier_range
        # Default to the highest tier if above all ranges
        return "400+ (Severe Plus)"
    
    def _generate_workorders(self, grap_tier: str, source_contributions: Dict[str, float]) -> List[Dict[str, Any]]:
        """Generate work orders based on GRAP tier and source contributions."""
        tier_data = self.GRAP_TIERS.get(grap_tier, self.GRAP_TIERS["100-200 (Poor)"])
        actions = tier_data.get("actions", [])
        
        workorders = []
        
        for action in actions:
            workorder = self._create_workorder_for_action(action, grap_tier, source_contributions)
            if workorder:
                workorders.append(workorder)
        
        return workorders
    
    def _create_workorder_for_action(self, action: str, grap_tier: str, 
                                    source_contributions: Dict[str, float]) -> Optional[Dict[str, Any]]:
        """Create a specific work order for a given action type."""
        
        # Determine deployment parameters based on action type
        if action == "fog_cannon_dust_suppression":
            return {
                "workorder_id": f"wo_fog_{int(time.time())}",
                "action_type": "fog_cannon_dust_suppression",
                "grap_tier": grap_tier,
                "priority": "high" if grap_tier in ["200-300 (Very Poor)", "300-400 (Severe)", "400+ (Severe Plus)"] else "medium",
                "deployment_type": "fog_cannon",
                "target_areas": self._determine_target_areas(grap_tier, source_contributions),
                "sla_hours": self.SLA_TIMEFRAMES.get("fog_cannon_deploy", 4),
                "status": "pending",
                "created_at": time.time(),
                "trace_id": self.trace_id,
            }
        
        elif action == "sweeper_dispatch":
            return {
                "workorder_id": f"wo_sweeper_{int(time.time())}",
                "action_type": "sweeper_dispatch",
                "grap_tier": grap_tier,
                "priority": "high" if grap_tier in ["200-300 (Very Poor)", "300-400 (Severe)", "400+ (Severe Plus)"] else "medium",
                "deployment_type": "sweeper",
                "target_areas": self._determine_target_areas(grap_tier, source_contributions),
                "sla_hours": self.SLA_TIMEFRAMES.get("sweeper_dispatch", 6),
                "status": "pending",
                "created_at": time.time(),
                "trace_id": self.trace_id,
            }
        
        elif action == "diesel_truck_diversion":
            return {
                "workorder_id": f"wo_diversion_{int(time.time())}",
                "action_type": "diesel_truck_diversion",
                "grap_tier": grap_tier,
                "priority": "high" if grap_tier in ["200-300 (Very Poor)", "300-400 (Severe)", "400+ (Severe Plus)"] else "medium",
                "deployment_type": "traffic_diversion",
                "target_areas": self._determine_target_areas(grap_tier, source_contributions),
                "sla_hours": self.SLA_TIMEFRAMES.get("diversion_order", 2),
                "status": "pending",
                "requires_second_approver": True,  # Policy officer second approver
                "created_at": time.time(),
                "trace_id": self.trace_id,
            }
        
        elif action == "industrial_suspension":
            return {
                "workorder_id": f"wo_industrial_{int(time.time())}",
                "action_type": "industrial_suspension",
                "grap_tier": grap_tier,
                "priority": "high",
                "deployment_type": "industrial_compliance",
                "target_areas": self._determine_target_areas(grap_tier, source_contributions),
                "sla_hours": self.SLA_TIMEFRAMES.get("workorder_complete", 24),
                "status": "pending",
                "created_at": time.time(),
                "trace_id": self.trace_id,
            }
        
        elif action == "construction_ban":
            return {
                "workorder_id": f"wo_construction_{int(time.time())}",
                "action_type": "construction_ban",
                "grap_tier": grap_tier,
                "priority": "high",
                "deployment_type": "regulatory_enforcement",
                "target_areas": self._determine_target_areas(grap_tier, source_contributions),
                "sla_hours": self.SLA_TIMEFRAMES.get("workorder_complete", 24),
                "status": "pending",
                "created_at": time.time(),
                "trace_id": self.trace_id,
            }
        
        else:
            # Generic workorder for unrecognized actions
            return {
                "workorder_id": f"wo_generic_{int(time.time())}",
                "action_type": action,
                "grap_tier": grap_tier,
                "priority": "medium",
                "deployment_type": "general",
                "target_areas": self._determine_target_areas(grap_tier, source_contributions),
                "sla_hours": self.SLA_TIMEFRAMES.get("workorder_complete", 24),
                "status": "pending",
                "created_at": time.time(),
                "trace_id": self.trace_id,
            }
    
    def _determine_target_areas(self, grap_tier: str, source_contributions: Dict[str, float]) -> List[str]:
        """Determine target areas for work order deployment."""
        # In production, this would use spatial analysis of attribution data
        # to identify hotspots and at-risk areas
        
        # Placeholder: return major areas in Delhi-NCR
        areas = [
            "noida", "ghaziabad", "faridabad", "gurugram", "new_delhi",
            "west_delhi", "east_delhi", "north_delhi", "south_delhi"
        ]
        
        # Could filter based on source contributions
        if "straw_plume" in source_contributions and source_contributions["straw_plume"] > 30:
            # Add Punjab-adjacent areas if straw burning is dominant
            areas.extend["ludhiana", "jalandhar", "ambala"]
        
        return areas
    
    async def _measure_roi(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Measure ROI: ΔPM2.5 4-12 hours after each action."""
        workorder_ids = data.get("workorder_ids", [])
        pilot_area = data.get("pilot_area", "default")
        
        roi_results = []
        
        for wo_id in workorder_ids:
            # In production, this would:
            # 1. Retrieve the work order created at a known time
            # 2. Get PM2.5 measurements from monitoring stations at t=0 (before action)
            #    and at t=4h and t=12h after action
            # 3. Compute ΔPM2.5 = PM2.5_before - PM2.5_after
            # 4. Compute ROI metric: (ΔPM2.5 / action_cost) × 100
            
            # Placeholder ROI measurement
            pm25_before = np.random.uniform(200, 400)  # hypothetical before value
            pm25_after_4h = np.random.uniform(150, pm25_before)  # after 4 hours
            pm25_after_12h = np.random.uniform(100, pm25_after_4h)  # after 12 hours
            
            delta_4h = round(pm25_before - pm25_after_4h, 1)
            delta_12h = round(pm25_before - pm25_after_12h, 1)
            
            # Simulated action cost (INR)
            action_cost = np.random.uniform(50000, 500000)
            
            # ROI metric: percentage improvement per 10k INR spent
            if action_cost > 0:
                roi_metric = round((delta_12h / action_cost) * 100000, 2)
            else:
                roi_metric = 0.0
            
            roi_result = {
                "workorder_id": wo_id,
                "pilot_area": pilot_area,
                "pm25_before": pm25_before,
                "pm25_after_4h": pm25_after_4h,
                "pm25_after_12h": pm25_after_12h,
                "delta_pm25_4h": delta_4h,
                "delta_pm25_12h": delta_12h,
                "action_cost": action_cost,
                "roi_metric": roi_metric,  # μg/m³ improvement per 10k INR
                "measurement_window": "12h",
                "measured_at": time.time(),
            }
            
            roi_results.append(roi_result)
            
            # Store in ROI measurements cache
            if pilot_area not in self.roi_measurements:
                self.roi_measurements[pilot_area] = []
            self.roi_measurements[pilot_area].append(roi_result)
        
        self._log_event("info", "ROI measurements completed",
                       workorders_measured=len(roi_results),
                       pilot_area=pilot_area)
        
        # Publish roi.measured
        await self.publish("roi.measured", {
            "pilot_area": pilot_area,
            "roi_results": roi_results,
            "measured_at": time.time(),
        })
        
        return {"roi_results": roi_results, "pilot_area": pilot_area}
    
    async def _check_sla(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Check SLA compliance for work orders."""
        workorder_id = data.get("workorder_id")
        
        if workorder_id in self.active_workorders:
            wo = self.active_workorders[workorder_id]
            created_at = wo.get("created_at", time.time())
            elapsed = time.time() - created_at
            
            # Determine SLA based on action type
            action_type = wo.get("action_type", "")
            sla_hours = self.SLA_TIMEFRAMES.get(action_type, 24)
            
            sla_compliant = elapsed <= sla_hours * 3600  # Convert hours to seconds
            
            sla_status = {
                "workorder_id": workorder_id,
                "action_type": action_type,
                "elapsed_hours": round(elapsed / 3600, 2),
                "sla_hours": sla_hours,
                "compliant": sla_compliant,
                "status": "compliant" if sla_compliant else "violated",
            }
            
            self._log_event("warning" if not sla_compliant else "info", "SLA check completed",
                           workorder_id=workorder_id,
                           elapsed_hours=sla_status["elapsed_hours"],
                           sla_hours=sla_hours,
                           compliant=sla_compliant)
            
            return sla_status
        else:
            self._log_event("error", "Work order not found for SLA check", workorder_id=workorder_id)
            return {"workorder_id": workorder_id, "compliant": False, "error": "workorder_not_found"}