"""
FastAPI Router for Attribution Summary endpoints.
Exposes source attribution matrix by region.
"""
import time
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, Dict
import structlog

router = APIRouter(
    prefix="/v1/attribution",
    tags=["Source Attribution"],
    responses={404: {"description": "Not found"}},
)

logger = structlog.get_logger()


@router.get(
    "/summary",
    summary="Get source attribution matrix by region",
    description="Return source attribution breakdown (straw plume, vehicle exhaust, road dust, industrial waste) for specified region.",
    response_model=dict,
)
async def get_attribution_summary(
    region: str = Query(
        ..., 
        description="Region name (e.g., 'punjab_haryana_delhi', 'delhi_ncr', 'punjab')"
    ),
):
    """
    Get source attribution summary for a region.
    
    Returns percentage contribution from each source category:
    - straw_plume: Agricultural residue burning
    - vehicle_exhaust: Road traffic emissions  
    - road_dust: Construction and road dust
    - industrial_waste: Industrial and waste burning
    """
    logger.info("Attribution summary request", region=region)
    
    # In production, this would:
    # 1. Query the Forecast Agent's attribution data for the region
    # 2. Use GNN source apportionment results
    # 3. Return structured attribution matrix
    
    # Placeholder attribution data based on region
    attribution_data = {
        "punjab_haryana_delhi": {
            "straw_plume": 30.5,
            "vehicle_exhaust": 35.2,
            "road_dust": 20.1,
            "industrial_waste": 14.2,
            "total": 100.0,
            "dominant_source": "vehicle_exhaust",
            "region": "Punjab-Haryana-Delhi",
        },
        "delhi_ncr": {
            "straw_plume": 25.0,
            "vehicle_exhaust": 42.0,
            "road_dust": 18.5,
            "industrial_waste": 14.5,
            "total": 100.0,
            "dominant_source": "vehicle_exhaust",
            "region": "Delhi-NCR",
        },
        "punjab": {
            "straw_plume": 45.0,
            "vehicle_exhaust": 25.0,
            "road_dust": 20.0,
            "industrial_waste": 10.0,
            "total": 100.0,
            "dominant_source": "straw_plume",
            "region": "Punjab",
        },
        "haryana": {
            "straw_plume": 35.0,
            "vehicle_exhaust": 30.0,
            "road_dust": 25.0,
            "industrial_waste": 10.0,
            "total": 100.0,
            "dominant_source": "straw_plume",
            "region": "Haryana",
        },
    }
    
    # Look up region or use default
    data = attribution_data.get(region, attribution_data["delhi_ncr"])
    data["region"] = region
    
    result = {
        "region": region,
        "source_attribution": data,
        "computed_at": time.time(),
    }
    
    logger.info("Attribution summary returned", region=region, dominant=data.get("dominant_source"))
    return result