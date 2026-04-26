"""
Fleet telemetry publisher - publishes ship positions and status at 1Hz.
Subjects:
  - fleet.{ship_id}.position - position updates
  - fleet.{ship_id}.status - status changes
"""

import asyncio
import logging
import math
import time
from datetime import datetime
from typing import Any

from nats_client import get_nats

logger = logging.getLogger(__name__)

POSITION_SUBJECT_PREFIX = "fleet"
PUBLISH_INTERVAL_S = 1.0  # 1Hz position updates


class Ship:
    """Server-side ship state with movement simulation."""

    def __init__(
        self,
        ship_id: str,
        name: str,
        lat: float,
        lon: float,
        heading: float,
        speed_kn: float,
        status: str,
        co2_removed_tons: float,
        alkalinity_deployed_kg: float,
    ):
        self.ship_id = ship_id
        self.name = name
        self.lat = lat
        self.lon = lon
        self.heading = heading
        self.speed_kn = speed_kn
        self.status = status
        self.co2_removed_tons = co2_removed_tons
        self.alkalinity_deployed_kg = alkalinity_deployed_kg
        self._last_update = time.time()

    def advance(self, dt_s: float):
        """Advance ship position based on heading and speed."""
        if self.speed_kn <= 0:
            return

        # 1 knot = 1.852 km/h
        # At ~34°N: 1° lat ≈ 111 km, 1° lon ≈ 92 km
        km_per_hour = self.speed_kn * 1.852
        km_moved = km_per_hour * (dt_s / 3600)

        heading_rad = math.radians(self.heading)
        delta_lat = (km_moved * math.cos(heading_rad)) / 111.0
        delta_lon = (km_moved * math.sin(heading_rad)) / 92.0

        self.lat += delta_lat
        self.lon += delta_lon

        # Boundary check: reverse heading if too far from California coast
        if self.lat < 32.0 or self.lat > 36.0 or self.lon < -122.0 or self.lon > -117.0:
            self.heading = (self.heading + 180) % 360

        self._last_update = time.time()

    def to_position_msg(self) -> dict[str, Any]:
        """Return position message payload."""
        return {
            "ship_id": self.ship_id,
            "lat": round(self.lat, 5),
            "lon": round(self.lon, 5),
            "heading": round(self.heading, 1),
            "speed_kn": round(self.speed_kn, 1),
        }

    def to_status_msg(self) -> dict[str, Any]:
        """Return status message payload."""
        return {
            "ship_id": self.ship_id,
            "status": self.status,
            "co2_removed_tons": round(self.co2_removed_tons, 1),
            "alkalinity_deployed_kg": round(self.alkalinity_deployed_kg, 1),
        }

    def to_full_state(self) -> dict[str, Any]:
        """Return full ship state for HTTP endpoint."""
        return {
            "ship_id": self.ship_id,
            "name": self.name,
            "position": {"lat": round(self.lat, 5), "lon": round(self.lon, 5)},
            "status": self.status,
            "last_simulation": datetime.utcnow().isoformat() + "Z" if self.status != "idle" else None,
            "co2_removed_tons": round(self.co2_removed_tons, 1),
            "alkalinity_deployed_kg": round(self.alkalinity_deployed_kg, 1),
            "heading": round(self.heading, 1),
            "speed_kn": round(self.speed_kn, 1),
        }


class FleetPublisher:
    """
    Manages server-side fleet state and publishes telemetry to NATS at 1Hz.
    Ship positions are simulated server-side for authoritative state.
    """

    def __init__(self):
        self._running = False
        self._task: asyncio.Task | None = None
        self._ships: dict[str, Ship] = {}
        self._last_status: dict[str, str] = {}  # Track status changes
        self._init_fleet()

    def _init_fleet(self):
        """Initialize fleet with default ships."""
        default_ships = [
            Ship(
                ship_id="ship-001",
                name="Pacific Guardian",
                lat=33.7346,
                lon=-118.2560,
                heading=247.0,
                speed_kn=6.2,
                status="deploying",
                co2_removed_tons=847.3,
                alkalinity_deployed_kg=12500.0,
            ),
            Ship(
                ship_id="ship-002",
                name="Ocean Sentinel",
                lat=33.7541,
                lon=-118.2165,
                heading=215.0,
                speed_kn=9.4,
                status="active",
                co2_removed_tons=623.1,
                alkalinity_deployed_kg=9200.0,
            ),
            Ship(
                ship_id="ship-003",
                name="Reef Protector",
                lat=32.6967,
                lon=-117.1319,
                heading=270.0,
                speed_kn=0.0,
                status="idle",
                co2_removed_tons=189.6,
                alkalinity_deployed_kg=2800.0,
            ),
        ]
        for ship in default_ships:
            self._ships[ship.ship_id] = ship
            self._last_status[ship.ship_id] = ship.status

    async def start(self):
        """Start the fleet publisher background task."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._publish_loop())
        logger.info("Fleet publisher started")

    async def stop(self):
        """Stop the fleet publisher."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Fleet publisher stopped")

    def get_ships(self) -> list[dict[str, Any]]:
        """Get current fleet state for HTTP endpoint."""
        return [ship.to_full_state() for ship in self._ships.values()]

    def get_ship(self, ship_id: str) -> dict[str, Any] | None:
        """Get a single ship's state."""
        ship = self._ships.get(ship_id)
        return ship.to_full_state() if ship else None

    async def _publish_loop(self):
        """Main publish loop - runs every PUBLISH_INTERVAL_S."""
        nats = get_nats()
        last_time = time.time()

        while self._running:
            try:
                now = time.time()
                dt = now - last_time
                last_time = now

                for ship in self._ships.values():
                    # Advance ship position
                    ship.advance(dt)

                    # Publish position update
                    subject = f"{POSITION_SUBJECT_PREFIX}.{ship.ship_id}.position"
                    await nats.publish(subject, ship.to_position_msg())

                    # Publish status change if changed
                    if ship.status != self._last_status.get(ship.ship_id):
                        status_subject = f"{POSITION_SUBJECT_PREFIX}.{ship.ship_id}.status"
                        await nats.publish(status_subject, ship.to_status_msg())
                        self._last_status[ship.ship_id] = ship.status

                    # Slowly increment CO2 for deploying ships
                    if ship.status == "deploying":
                        ship.co2_removed_tons += 0.01 * dt
                        ship.alkalinity_deployed_kg += 0.15 * dt

            except Exception as e:
                logger.warning(f"Fleet publish error: {e}")

            await asyncio.sleep(PUBLISH_INTERVAL_S)


# Singleton instance
_fleet_publisher: FleetPublisher | None = None


def get_fleet_publisher() -> FleetPublisher:
    global _fleet_publisher
    if _fleet_publisher is None:
        _fleet_publisher = FleetPublisher()
    return _fleet_publisher
