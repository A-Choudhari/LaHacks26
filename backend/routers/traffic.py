"""
AIS vessel traffic endpoint with live simulation.
"""

import json
import time
import math

from fastapi import APIRouter
from pydantic import BaseModel

import ais_stream
from config import MOCK_DATA_DIR, REAL_DATA_DIR

router = APIRouter()


class VesselTraffic(BaseModel):
    vessel_id: str
    name: str
    vessel_type: str
    lat: float
    lon: float
    heading: float
    speed_kn: float


# ── Live AIS Vessel Simulation ─────────────────────────────────────────────────

_vessel_state: dict = {"vessels": [], "last_update": 0.0}


def _load_base_vessels() -> list[dict]:
    """Load real AIS vessel data (curated from NOAA AIS 2024-01-01, CA coastal waters)."""
    # Prefer real data, fall back to mock
    for ais_file in [REAL_DATA_DIR / "ais_vessels.json", MOCK_DATA_DIR / "ais_vessels.json"]:
        if ais_file.exists():
            with open(ais_file) as f:
                return json.load(f)
    return []


def _simulate_vessel_movement(vessel: dict, elapsed_seconds: float) -> dict:
    """
    Move vessel along heading at speed.
    1 knot ≈ 1.852 km/h ≈ 0.0003 degrees/second at ~34°N latitude.
    """
    # Convert speed from knots to degrees/second (approximate)
    speed_deg_per_sec = vessel["speed_kn"] * 0.0003 / 3600
    distance = speed_deg_per_sec * elapsed_seconds

    heading_rad = math.radians(vessel["heading"])
    new_lat = vessel["lat"] + distance * math.cos(heading_rad)
    new_lon = vessel["lon"] + distance * math.sin(heading_rad)

    # Boundary check - reverse heading if out of Southern California area
    if new_lat < 33.0 or new_lat > 34.5 or new_lon < -119.5 or new_lon > -117.5:
        vessel["heading"] = (vessel["heading"] + 180) % 360

    vessel["lat"] = new_lat
    vessel["lon"] = new_lon
    return vessel


@router.get("/traffic", response_model=list[VesselTraffic])
async def get_vessel_traffic():
    """
    Real-time global AIS vessel traffic via aisstream.io WebSocket.
    Falls back to simulated movement of curated NOAA AIS vessels when
    AISSTREAM_API_KEY is not set or the stream is disconnected.

    Live mode: returns all vessels seen in the last 30 minutes globally.
    Fallback mode: returns 12 curated vessels from NOAA AIS 2024 CA data
                   with simulated position updates based on heading/speed.
    """
    # Prefer live AIS stream
    live = ais_stream.get_vessels()
    if live:
        return [VesselTraffic(**{k: v for k, v in vessel.items()
                                 if k in VesselTraffic.model_fields})
                for vessel in live]

    # Fallback: curated data with simulated movement
    global _vessel_state
    now = time.time()

    if not _vessel_state["vessels"] or now - _vessel_state["last_update"] > 300:
        _vessel_state["vessels"] = _load_base_vessels()
        _vessel_state["last_update"] = now
        return [VesselTraffic(**{k: v for k, v in vessel.items()
                                 if k in VesselTraffic.model_fields})
                for vessel in _vessel_state["vessels"]]

    elapsed = now - _vessel_state["last_update"]
    _vessel_state["last_update"] = now
    for vessel in _vessel_state["vessels"]:
        _simulate_vessel_movement(vessel, elapsed)

    return [VesselTraffic(**{k: v for k, v in vessel.items()
                             if k in VesselTraffic.model_fields})
            for vessel in _vessel_state["vessels"]]
