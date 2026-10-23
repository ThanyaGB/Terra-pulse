"""
Farmer Advisory and Logistics Agent
Generates outbound call scripts in Punjabi and Hindi, matches machinery 
(Super Seeder, Happy Seeder, baler) by proximity and availability, and 
arranges off-field straw collection with Bio-CNG and briquette buyers at 
a guaranteed floor price. Subscribes to risk.updated. Publishes booking.created.
"""
import asyncio
import numpy as np
from typing import Dict, Any, List, Optional
from .base_agent import BaseBobAgent


class FarmerAdvisoryAgent(BaseBobAgent):
    """
    Farmer Advisory and Logistics Agent.
    
    Responsibilities:
    - Generates outbound call scripts in Punjabi and Hindi for farmers
    - Matches Super Seeder, Happy Seeder, baler machinery by proximity and availability
    - Arranges off-field straw collection with Bio-CNG and briquette buyers
    - Guaranteed floor price for straw collection
    - Subscribes to risk.updated events
    - Publishes booking.created events
    """
    
    def __init__(self, bus=None, state_store=None):
        super().__init__("farmer_advisory", bus, state_store)
        # Floor price for straw collection (INR per quintal)
        self.floor_price = 1200  # INR/qtl, configurable per region
        # Bio-CNG and briquette buyers registry
        self.buyers: Dict[str, Dict] = {}
        # Machinery match cache
        self.machinery_matches: Dict[str, List] = {}
        # Call script templates in Punjabi and Hindi
        self.call_templates = {
            "punjabi": [
                "Namaste {farmer_name}, yeh {village} village da farmer {farmer_name}. Aapki zamin par stubble burning ka risk {risk_tier} grade pr hai.",
                "Apne field par Super Seeder ya Happy Seeder use karke waste straw ko field mein hi manage kar sakte hain. Ye environmental bhi healthy rahta hai aur soil bhi.",
                "Agar aap straw collection ke liye interested hain, to guaranteed floor price {price} INR per quintal par collection ho sakti hai. Kya aap call accept karengein?",
            ],
            "hindi": [
                "Namaste {farmer_name}, aap {village} village ke farmer {farmer_name}. Aapki zameen par stubble burning ka risk {risk_tier} grade hai.",
                "Apne field par Super Seeder ya Happy Seeder use karke waste straw ko field manage kar sakte hain. Ye mahaul bhi healthy rahta hai aur soil bhi healthy rehta hai.",
                "Agar aap straw collection ke liye interested hain, to guaranteed floor price {price} INR per quintal par collection ho sakti hai. Kya aap call accept karengein?",
            ],
        }
    
    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process incoming event and handle risk updates."""
        event_type = event.get("event_type", "")
        
        if event_type == "risk.updated":
            return await self._handle_risk_update(event.get("data", {}))
        elif event_type == "booking.request":
            return await self._process_booking_request(event.get("data", {}))
        elif event_type == "machinery.available":
            return await self._update_machinery_availability(event.get("data", {}))
        else:
            self._log_event("warning", "Unknown event type", event_type=event_type)
            return None
    
    async def _handle_risk_update(self, risk_data: Dict[str, Any]) -> Dict[str, Any]:
        """Handle risk score updates and trigger farmer advisories."""
        risk_results = risk_data.get("risk_results", [])
        
        # For high and critical risk villages, generate advisories and machinery matches
        urgent_villages = [r for r in risk_results if r.get("tier") in ["high", "critical"]]
        
        advisories = []
        for village_risk in urgent_villages:
            village_id = village_risk.get("village_id", "unknown")
            risk_tier = village_risk.get("tier", "low")
            risk_score = village_risk.get("risk_score", 0)
            
            # Generate call scripts
            scripts = self._generate_call_scripts(village_id, risk_tier, risk_score)
            
            # Match machinery by proximity and availability
            machinery_matches = await self._match_machinery(village_id, risk_tier)
            
            # Arrange off-field straw collection
            collection_booking = await self._arrange_straw_collection(village_id, machinery_matches)
            
            advisory = {
                "village_id": village_id,
                "risk_tier": risk_tier,
                "risk_score": risk_score,
                "scripts": scripts,
                "machinery_matches": machinery_matches,
                "collection_booking": collection_booking,
            }
            advisories.append(advisory)
        
        # Publish booking.created for each advisory with booking
        for advisory in advisories:
            if advisory["collection_booking"]:
                booking_event = {
                    "event_type": "booking.created",
                    "source": self.agent_name,
                    "agent_id": self.agent_id,
                    "trace_id": self.trace_id,
                    "timestamp": time.time(),
                    "data": advisory["collection_booking"],
                }
                await self.publish("booking.created", booking_event.data)
        
        self._log_event("info", "Risk update handled, advisories generated",
                       urgent_villages=len(urgent_villages),
                       bookings_published=len(advisories))
        
        return {"event_type": "risk.updated", "advisories": advisories, "bookings": len(advisories)}
    
    def _generate_call_scripts(self, village_id: str, risk_tier: str, risk_score: float) -> Dict[str, List]:
        """Generate outbound call scripts in Punjabi and Hindi."""
        # Get farmer name from village data (placeholder)
        farmer_name = "Kisan"  # Would query DB in production
        
        scripts = {
            "punjabi": [template.format(
                farmer_name=farmer_name,
                village=village_id,
                risk_tier=risk_tier,
                price=self.floor_price,
            ) for template in self.call_templates["punjabi"]],
            "hindi": [template.format(
                farmer_name=farmer_name,
                village=village_id,
                risk_tier=risk_tier,
                price=self.floor_price,
            ) for template in self.call_templates["hindi"]],
        }
        
        return scripts
    
    async def _match_machinery(self, village_id: str, risk_tier: str) -> Dict[str, Any]:
        """Match Super Seeder, Happy Seeder, baler by proximity and availability."""
        # In production, this would query the Farm CRM and compute proximity
        # For now, return placeholder machinery availability
        
        # Define machinery types and their typical availability
        machinery_types = ["super_seeder", "happy_seeder", "baler"]
        
        matches = {}
        for mtype in machinery_types:
            # Simulate availability check
            # High risk villages might have better machinery matching
            availability = np.random.uniform(0.3, 0.9)  # 30-90% availability
            
            matches[mtype] = {
                "available": availability > 0.5,
                "availability_percentage": round(availability * 100, 1),
                "proximity_km": round(np.random.uniform(1, 50), 1),  # km from village
                "operator_contact": f"operator_{mtype}_{village_id}",
            }
        
        self.machinery_matches[village_id] = matches
        return matches
    
    async def _arrange_straw_collection(self, village_id: str, machinery_matches: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Arrange off-field straw collection with Bio-CNG and briquette buyers 
        at guaranteed floor price.
        """
        # Check if we have machinery to perform off-field collection
        has_super_seeder = machinery_matches.get("super_seeder", {}).get("available", False)
        has_happy_seeder = machinery_matches.get("happy_seeder", {}).get("available", False)
        
        booking = None
        
        if has_super_seeder or has_happy_seeder:
            # Create collection booking
            booking = {
                "booking_id": f"booking_{village_id}_{int(time.time())}",
                "village_id": village_id,
                "machinery_types": [m for m, mdata in machinery_matches.items() if mdata.get("available", False)],
                "floor_price_per_qtl": self.floor_price,
                "estimated_straw_quantity_qtl": np.random.uniform(50, 500),  # placeholder
                "buyer_type": "bio_cng" if has_super_seeder else "briquette",
                "collection_arranged": True,
                "status": "pending_farmer_confirmation",
                "created_at": time.time(),
            }
        else:
            # No machinery available, but still create a request for buyers
            booking = {
                "booking_id": f"booking_{village_id}_{int(time.time())}",
                "village_id": village_id,
                "machinery_types": [],
                "floor_price_per_qtl": self.floor_price,
                "estimated_straw_quantity_qtl": np.random.uniform(50, 500),
                "buyer_type": "request_only",
                "collection_arranged": False,
                "status": "no_machinery_available",
                "message": "No local machinery available, buyers will be contacted directly",
                "created_at": time.time(),
            }
        
        return booking
    
    async def _process_booking_request(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Process a booking request from another agent or API."""
        booking_id = data.get("booking_id")
        village_id = data.get("village_id")
        machinery_id = data.get("machinery_id")
        
        self._log_event("info", "Booking request processed",
                       booking_id=booking_id, village_id=village_id, machinery_id=machinery_id)
        
        return {"booking_id": booking_id, "status": "processed", "village_id": village_id}