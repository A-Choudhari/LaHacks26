"""
Health check endpoints.
"""

from fastapi import APIRouter
from pydantic import BaseModel

import ais_stream
from agents.base import is_ollama_available
from config import DEMO_MODE, MOCK_DATA_DIR, USE_MOCK
from utils.ocean_physics import fetch_ocean_state

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    julia_available: bool
    mock_data_available: bool
    ollama_available: bool
    ais_live: bool = False
    ais_vessels: int = 0
    demo_mode: bool = DEMO_MODE


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Check system health and component availability"""
    mock_ok = MOCK_DATA_DIR.exists() and any(MOCK_DATA_DIR.glob("*.json"))

    return HealthResponse(
        status="ok",
        julia_available=not USE_MOCK,
        mock_data_available=mock_ok,
        ollama_available=await is_ollama_available(),
        ais_live=not DEMO_MODE and ais_stream.is_connected(),
        ais_vessels=0 if DEMO_MODE else ais_stream.vessel_count(),
    )


@router.get("/ocean-state")
async def get_ocean_state_endpoint(lat: float = 33.80, lon: float = -119.50):
    """
    Real-time ocean conditions for a deployment site.
    SST from NOAA ERDDAP MUR (jplMURSST41), salinity + MLD from nearest CalCOFI station.
    Cached for 10 minutes per location.
    """
    return await fetch_ocean_state(lat, lon)
