"""
Base IBM Bob Agent for vayu-swachh.
Provides common functionality: event bus subscription, health endpoint, 
trace ID generation, structured logging, and idempotency support.
"""
import asyncio
import uuid
import time
import structlog
from typing import Dict, Any, Optional, Callable, List
from abc import ABC, abstractmethod


class BaseBobAgent(ABC):
    """
    Base class for IBM Bob Agent Framework workers.
    
    Each agent:
    - Publishes/subscribe to events on the bus
    - Emits structured logs with trace IDs
    - Exposes a health endpoint (/health)
    - Is idempotent (re-processing same event has no side effects)
    """
    
    def __init__(self, 
                 agent_name: str,
                 bus=None,
                 state_store=None):
        """
        Initialize base agent.
        
        Args:
            agent_name: Unique name for this agent
            bus: IBM Bob event bus instance
            state_store: Redis or persistent store for state snapshots
        """
        self.agent_name = agent_name
        self.bus = bus
        self.state_store = state_store
        self.agent_id = str(uuid.uuid4())
        self.trace_id = str(uuid.uuid4())
        
        # Performance tracking
        self.start_time = time.time()
        self.events_processed = 0
        self.last_event_time = time.time()
        
        # Structured logger
        self.logger = structlog.get_logger(
            agent=self.agent_name,
            agent_id=self.agent_id,
            trace_id=self.trace_id
        )
    
    def _generate_event(self, event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a structured event with trace ID and timestamp."""
        return {
            "event_type": event_type,
            "source": self.agent_name,
            "agent_id": self.agent_id,
            "trace_id": self.trace_id,
            "timestamp": time.time(),
            "data": data,
        }
    
    def _log_event(self, level: str, message: str, **kwargs):
        """Log a structured event."""
        structured_kwargs = {
            "level": level,
            "agent": self.agent_name,
            "agent_id": self.agent_id,
            "trace_id": self.trace_id,
            "message": message,
            **kwargs,
        }
        self.logger.bind(**structured_kwargs).info(message)
    
    @abstractmethod
    async def process_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Process an incoming event. Must be implemented by subclasses.
        Should be idempotent - re-processing same event data should not cause
        duplicate side effects.
        """
        pass
    
    async def handle_event(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Handle an incoming event from the bus with tracing and timing.
        """
        self.events_processed += 1
        self.last_event_time = time.time()
        
        self._log_event("info", "Received event", 
                       event_type=event.get("event_type"),
                       event_source=event.get("source"))
        
        start = time.time()
        result = await self.process_event(event)
        elapsed = time.time() - start
        
        self._log_event("info", "Event processed",
                       event_type=event.get("event_type"),
                       processing_time_ms=round(elapsed * 1000),
                       events_total=self.events_processed)
        
        return result
    
    async def publish(self, event_type: str, data: Dict[str, Any]) -> None:
        """Publish an event to the bus."""
        event = self._generate_event(event_type, data)
        if self.bus:
            await self.bus.publish(event)
            self._log_event("debug", "Event published", event_type=event_type)
        else:
            self._log_event("warning", "No bus available, event not published")
    
    async def subscribe(self, event_type: str, handler: Callable) -> None:
        """Subscribe to an event type on the bus."""
        if self.bus:
            await self.bus.subscribe(event_type, handler)
            self._log_event("debug", "Subscribed to event", event_type=event_type)
        else:
            self._log_event("warning", "No bus available, cannot subscribe")
    
    def get_health_status(self) -> Dict[str, Any]:
        """Get health check status for this agent."""
        uptime = time.time() - self.start_time
        return {
            "agent": self.agent_name,
            "agent_id": self.agent_id,
            "status": "healthy",
            "uptime_seconds": round(uptime, 2),
            "events_processed": self.events_processed,
            "last_event_timestamp": time.time(),
            "trace_id": self.trace_id,
        }
    
    async def health_check(self) -> Dict[str, Any]:
        """Health check endpoint implementation."""
        status = self.get_health_status()
        status["latency_ms"] = round((time.time() - self.last_event_time) * 1000, 2) if self.events_processed > 0 else 0
        return status