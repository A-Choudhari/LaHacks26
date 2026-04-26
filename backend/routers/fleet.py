"""
Fleet status endpoint for Arista "Connect the Dots" challenge.
Ships are positioned at real California port berths so routes
depart from land rather than open ocean.

When NATS is active, fleet state is managed by FleetPublisher
which simulates server-side movement and publishes at 1Hz.
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


def _get_static_fleet() -> list[dict]:
    """Static fleet data when NATS is not active."""
    return [
        {
            "ship_id": "ship-001",
            "name": "Pacific Guardian",
            "position": {"lat": 33.7346, "lon": -118.2560},
            "status": "deploying",
            "last_simulation": datetime.utcnow().isoformat() + "Z",
            "co2_removed_tons": 847.3,
            "alkalinity_deployed_kg": 12500.0,
            "heading": 247.0,
            "speed_kn": 6.2,
        },
        {
            "ship_id": "ship-002",
            "name": "Ocean Sentinel",
            "position": {"lat": 33.7541, "lon": -118.2165},
            "status": "active",
            "last_simulation": datetime.utcnow().isoformat() + "Z",
            "co2_removed_tons": 623.1,
            "alkalinity_deployed_kg": 9200.0,
            "heading": 215.0,
            "speed_kn": 9.4,
        },
        {
            "ship_id": "ship-003",
            "name": "Reef Protector",
            "position": {"lat": 32.6967, "lon": -117.1319},
            "status": "idle",
            "last_simulation": None,
            "co2_removed_tons": 189.6,
            "alkalinity_deployed_kg": 2800.0,
            "heading": 270.0,
            "speed_kn": 0.0,
        },
    ]


@router.get("/fleet", response_model=list[ShipStatus])
async def get_fleet_status():
    """
    OAE fleet berthed at real California port terminals.
    Ships depart from port, transit to deployment zones, then return.

    When NATS is active, returns live fleet state from FleetPublisher.
    Otherwise returns static positions.
    """
    # Try to get live fleet state from publisher
    try:
        from publishers.fleet_pub import get_fleet_publisher
        publisher = get_fleet_publisher()
        ships = publisher.get_ships()
        if ships:
            return [ShipStatus(**s) for s in ships]
    except ImportError:
        pass
    except Exception:
        pass

    # Fallback to static fleet data
    return [ShipStatus(**s) for s in _get_static_fleet()]
