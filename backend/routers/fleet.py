"""
Fleet status endpoint for Arista "Connect the Dots" challenge.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class ShipStatus(BaseModel):
    ship_id: str
    name: str
    position: dict           # lat, lon
    status: str              # "active", "idle", "deploying"
    last_simulation: Optional[str]
    co2_removed_tons: float
    alkalinity_deployed_kg: float
    heading: float = 0.0     # degrees true north
    speed_kn: float = 0.0    # knots


@router.get("/fleet", response_model=list[ShipStatus])
async def get_fleet_status():
    """
    Get status of all ships in the OAE fleet.
    Positions are in open Pacific water (Santa Barbara Channel / SoCal Bight).
    Includes heading + speed so the frontend can animate live movement.
    """
    return [
        ShipStatus(
            ship_id="ship-001",
            name="Pacific Guardian",
            # Santa Barbara Channel — open Pacific, deep water, OAE Zone Alpha
            position={"lat": 33.80, "lon": -119.50},
            status="deploying",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=847.3,
            alkalinity_deployed_kg=12500.0,
            heading=262.0,   # west-southwest along Channel
            speed_kn=6.2,
        ),
        ShipStatus(
            ship_id="ship-002",
            name="Ocean Sentinel",
            # Offshore San Diego — open ocean, OAE Zone Beta corridor
            position={"lat": 32.50, "lon": -119.20},
            status="active",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=623.1,
            alkalinity_deployed_kg=9200.0,
            heading=198.0,   # south-southwest transit
            speed_kn=9.4,
        ),
        ShipStatus(
            ship_id="ship-003",
            name="Reef Protector",
            # Offshore Pt. Conception — far offshore, standby
            position={"lat": 35.10, "lon": -121.90},
            status="idle",
            last_simulation=None,
            co2_removed_tons=189.6,
            alkalinity_deployed_kg=2800.0,
            heading=90.0,    # drifting east on current
            speed_kn=1.1,
        ),
    ]
