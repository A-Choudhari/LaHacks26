"""
Health check endpoints.
"""

import subprocess

from fastapi import APIRouter
from pydantic import BaseModel

import ais_stream
from config import JULIA_SCRIPT, JULIA_INSTALLED, MOCK_DATA_DIR
from utils.ocean_physics import fetch_ocean_state

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    julia_available: bool
    mock_data_available: bool
    ollama_available: bool
    ais_live: bool = False
    ais_vessels: int = 0


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Check system health and component availability"""
    julia_ok = JULIA_SCRIPT.exists() and JULIA_INSTALLED
    mock_ok = MOCK_DATA_DIR.exists() and any(MOCK_DATA_DIR.glob("*.json"))

    # Check Ollama
    ollama_ok = False
    try:
        result = subprocess.run(
            ["curl", "-s", "http://localhost:11434/api/tags"],
            capture_output=True, timeout=2
        )
        ollama_ok = result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return HealthResponse(
        status="ok",
        julia_available=julia_ok,
        mock_data_available=mock_ok,
        ollama_available=ollama_ok,
        ais_live=ais_stream.is_connected(),
        ais_vessels=ais_stream.vessel_count(),
    )


@router.get("/ocean-state")
async def get_ocean_state_endpoint(lat: float = 33.80, lon: float = -119.50):
    """
    Real-time ocean conditions for a deployment site.
    SST from NOAA ERDDAP MUR (jplMURSST41), salinity + MLD from nearest CalCOFI station.
    Cached for 10 minutes per location.
    """
    return await fetch_ocean_state(lat, lon)
