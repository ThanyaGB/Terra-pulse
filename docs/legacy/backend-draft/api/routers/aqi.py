"""
FastAPI Router for Air Quality Index endpoints.
Exposes REST API for AQI grid data and community-level AQI cards.
"""
import time as _time
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from typing import Optional, List
import structlog

router = APIRouter(
    prefix="/v1/aqi",
    tags=["Air Quality Index"],
    responses={404: {"description": "Not found"}},
)

logger = structlog.get_logger()


# Dependency to get database session (placeholder - would use actual DB session)
def get_db():
    """Dependency to get DB session."""
    pass


@router.get(
    "/grid",
    summary="Get 1 km grid AQI with source mix",
    description="Return 1 km grid AQI values with source attribution matrix for the specified bbox and time range.",
    response_model=dict,
)
async def get_aqi_grid(
    bbox: Optional[str] = Query(
        None, 
        description="Bounding box in format min_lon,min_lat,max_lon,max_lat (e.g., 75.0,29.0,78.0,31.0)"
    ),
    time: Optional[str] = Query(
        None, 
        description="ISO format timestamp or time range (e.g., 2024-01-15T10:00:00Z)"
    ),
):
    """
    Get 1 km grid AQI with source mix.
    
    Returns PM2.5 concentration by grid cell along with source contribution breakdown:
    - straw_plume: Agricultural residue burning
    - vehicle_exhaust: Road traffic emissions
    - road_dust: Construction and road dust
    - industrial_waste: Industrial and waste burning
    """
    logger.info("AQI grid request received", bbox=bbox, time=time)
    
    if not bbox:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bounding box (bbox) parameter is required"
        )
    
    # Parse bbox
    try:
        bbox_values = [float(x) for x in bbox.split(",")]
        if len(bbox_values) != 4:
            raise ValueError("Bbox must have exactly 4 values: min_lon,min_lat,max_lon,max_lat")
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid bbox format: {str(e)}"
        )
    
    # In production, this would:
    # 1. Query the 1 km grid from TimescaleDB/PostGIS
    # 2. Join with source attribution data from the Forecast Agent
    # 3. Return structured grid data
    
    # Placeholder response structure
    grid_cells = {}
    # Simulate grid cells within the bbox area
    min_lon, min_lat, max_lon, max_lat = bbox_values
    
    # Generate sample grid cells (in production, these would come from DB)
    lon_step = (max_lon - min_lon) / 10
    lat_step = (max_lat - min_lat) / 10
    
    cell_count = 0
    for i in range(5):  # Reduced for demo
        for j in range(5):
            lon = min_lon + (i + 0.5) * lon_step
            lat = min_lat + (j + 0.5) * lat_step
            key = f"{lat:.4f},{lon:.4f}"
            
            # Simulated PM2.5 value (10-200 μg/m³ range)
            import random
            seed = hash(key) % 10000
            random.seed(seed)
            pm25 = round(random.uniform(10, 200), 1)
            
            # Source mix simulation
            source_contributions = {
                "straw_plume": round(random.uniform(0, 50), 1),
                "vehicle_exhaust": round(random.uniform(20, 60), 1),
                "road_dust": round(random.uniform(0, 30), 1),
                "industrial_waste": round(random.uniform(0, 20), 1),
            }
            total = sum(source_contributions.values())
            source_contributions = {k: round(v / total * 100, 1) for k, v in source_contributions.items()}
            
            grid_cells[key] = {
                "pm25": pm25,
                "latitude": lat,
                "longitude": lon,
                "source_mix": source_contributions,
                "air_quality": classify_aqi(pm25),
            }
            cell_count += 1
    
    result = {
        "bbox": bbox_values,
        "grid_resolution_km": 1.0,
        "region": "Punjab-Haryana-Delhi",
        "cell_count": cell_count,
        "grid_cells": grid_cells,
        "retrieved_at": _time.time(),
    }
    
    logger.info("AQI grid returned", cell_count=cell_count)
    return result


@router.get(
    "/community/{community_id}",
    summary="Get community AQI card and source mix",
    description="Return AQI card for a specific community including source attribution and health advisory links.",
    response_model=dict,
)
async def get_community_aqi(
    community_id: str = Path(..., description="Community identifier (e.g., village or ward code)"),
    time: Optional[str] = Query(
        None, 
        description="ISO format timestamp or time range"
    ),
):
    """
    Get community AQI card and source mix.
    
    Returns:
    - Community ID and location
    - Current AQI and PM2.5
    - Source contribution percentages
    - GRAP tier classification
    - Link to health advisory for the community
    """
    logger.info("Community AQI request", community_id=community_id, time=time)
    
    # In production, this would:
    # 1. Look up community from PostGIS
    # 2. Get current PM2.5 from the 1 km grid
    # 3. Get source attribution from Forecast Agent
    # 4. Determine GRAP tier
    # 5. Generate health advice links
    
    # Placeholder community data
    community_data = {
        "noida": {
            "name": "Noida Sector 18",
            "location": {"latitude": 28.56, "longitude": 77.35},
            "current_pm25": 120.5,
            "current_aqi": 185,
            "source_mix": {
                "straw_plume": 25.0,
                "vehicle_exhaust": 35.0,
                "road_dust": 20.0,
                "industrial_waste": 20.0,
            },
            "grape_tier": "200-300 (Very Poor)",
            "health_advice_url": "/v1/health/advice?community_id=noida",
        },
        "gurugram": {
            "name": "Gurugram",
            "location": {"latitude": 28.46, "longitude": 77.04},
            "current_pm25": 95.3,
            "current_aqi": 145,
            "source_mix": {
                "straw_plume": 15.0,
                "vehicle_exhaust": 45.0,
                "road_dust": 25.0,
                "industrial_waste": 15.0,
            },
            "grape_tier": "100-200 (Poor)",
            "health_advice_url": "/v1/health/advice?community_id=gurugram",
        },
        "default": {
            "name": f"Community {community_id}",
            "location": {"latitude": 28.7, "longitude": 77.2},
            "current_pm25": 150.0,
            "current_aqi": 220,
            "source_mix": {
                "straw_plume": 30.0,
                "vehicle_exhaust": 35.0,
                "road_dust": 20.0,
                "industrial_waste": 15.0,
            },
            "grape_tier": "300-400 (Severe)",
            "health_advice_url": "/v1/health/advice?community_id=" + community_id,
        },
    }
    
    # Look up community or use default
    community = community_data.get(community_id, community_data["default"])
    
    result = {
        "community_id": community_id,
        "community_name": community["name"],
        "location": community["location"],
        "current_pm25": community["current_pm25"],
        "current_aqi": community["current_aqi"],
        "source_mix": community["source_mix"],
        "grape_tier": community["grape_tier"],
        "health_advice_url": community["health_advice_url"],
        "retrieved_at": _time.time(),
    }
    
    logger.info("Community AQI returned", community_id=community_id, aqi=community["current_aqi"])
    return result


def classify_aqi(pm25: float) -> str:
    """Classify PM2.5 into AQI categories."""
    if pm25 <= 50:
        return "Good"
    elif pm25 <= 100:
        return "Moderate"
    elif pm25 <= 150:
        return "Unhealthy for Sensitive Groups"
    elif pm25 <= 200:
        return "Unhealthy"
    elif pm25 <= 300:
        return "Very Unhealthy"
    else:
        return "Hazardous"