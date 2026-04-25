"""
Fleet status endpoint for Arista "Connect the Dots" challenge.
Ships are positioned at real California port berths so routes
depart from land rather than open ocean.
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
    OAE fleet berthed at real California port terminals.
    Ships depart from port, transit to deployment zones, then return.
    """
    return [
        ShipStatus(
            ship_id="ship-001",
            name="Pacific Guardian",
            # Port of Los Angeles — Berth 100, main channel, San Pedro
            position={"lat": 33.7346, "lon": -118.2560},
            status="deploying",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=847.3,
            alkalinity_deployed_kg=12500.0,
            heading=247.0,   # outbound southwest toward open ocean
            speed_kn=6.2,
        ),
        ShipStatus(
            ship_id="ship-002",
            name="Ocean Sentinel",
            # Port of Long Beach — Pier J terminal, Middle Harbor
            position={"lat": 33.7541, "lon": -118.2165},
            status="active",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=623.1,
            alkalinity_deployed_kg=9200.0,
            heading=215.0,   # outbound south-southwest
            speed_kn=9.4,
        ),
        ShipStatus(
            ship_id="ship-003",
            name="Reef Protector",
            # Port of San Diego — National City Marine Terminal, Pier 26
            position={"lat": 32.6967, "lon": -117.1319},
            status="idle",
            last_simulation=None,
            co2_removed_tons=189.6,
            alkalinity_deployed_kg=2800.0,
            heading=270.0,   # ready to depart west
            speed_kn=0.0,
        ),
    ]
