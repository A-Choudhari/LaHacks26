"""
Agentic fleet route planning endpoint.

Two-phase:
  1. Deterministic: score zones by CO2 potential, detect MPA conflicts, compute detours.
  2. AI (Gemma4): reason about optimal site ordering and fleet strategy.
"""

import json
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from agents.route_planner import plan_routes
from agents.spatial_intelligence import get_ocean_state

router = APIRouter()
logger = logging.getLogger(__name__)

_MPA_FILE = Path(__file__).parent.parent.parent / "data" / "real" / "mpas.json"


def _load_mpa_features() -> list:
    if _MPA_FILE.exists():
        with open(_MPA_FILE) as f:
            return json.load(f).get("features", [])
    return []


class ShipInput(BaseModel):
    ship_id: str
    ship_name: str
    lat: float
    lon: float
    color: Optional[str] = None


class ZoneInput(BaseModel):
    lat: float
    lon: float
    score: float
    name: Optional[str] = None
    reason: Optional[str] = None


class RoutePlanRequest(BaseModel):
    ships: list[ShipInput]
    zones: list[ZoneInput]


@router.post("/route-plan")
async def route_plan(request: RoutePlanRequest):
    """
    Agentic fleet route planner.

    Deterministic tools compute CO2 potential per zone and MPA conflicts on
    direct segments. Gemma4 then reasons about optimal zone ordering per ship
    and inserts detour waypoints around protected areas.

    Falls back to greedy nearest-neighbor if Gemma4 is unavailable.
    """
    ships = [s.model_dump() for s in request.ships]
    zones = [z.model_dump() for z in request.zones]
    mpa_features = _load_mpa_features()

    # Fetch ocean state for each zone (used for CO2 potential scoring)
    ocean_states: dict = {}
    for z in zones:
        key = f"{round(z['lat'], 1)},{round(z['lon'], 1)}"
        try:
            state = get_ocean_state(z["lat"], z["lon"])
            ocean_states[key] = state
        except Exception:
            pass

    result = await plan_routes(ships, zones, ocean_states, mpa_features)
    return result
