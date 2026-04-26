"""
AIS batch publisher - publishes batched vessel updates every 2 seconds.
Subject: ais.batch
"""

import asyncio
import logging
import time
from typing import Any

from nats_client import get_nats

logger = logging.getLogger(__name__)

AIS_SUBJECT = "ais.batch"
PUBLISH_INTERVAL_S = 2.0


class AISPublisher:
    """
    Batches vessel position updates and publishes to NATS every 2 seconds.
    Receives updates via add_vessel() from the AIS worker.
    """

    def __init__(self):
        self._running = False
        self._task: asyncio.Task | None = None
        self._vessels: dict[str, dict[str, Any]] = {}  # mmsi -> vessel data
        self._last_publish = 0.0

    async def start(self):
        """Start the AIS publisher background task."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._publish_loop())
        logger.info("AIS publisher started")

    async def stop(self):
        """Stop the AIS publisher."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("AIS publisher stopped")

    def add_vessel(self, mmsi: str, vessel_data: dict[str, Any]):
        """
        Add or update a vessel in the batch buffer.
        Called by the AIS stream processor.
        """
        self._vessels[mmsi] = {
            **vessel_data,
            "_ts": time.time(),
        }

    def set_vessels(self, vessels: dict[str, dict[str, Any]]):
        """
        Replace all vessels in the buffer (used for batch updates from file).
        """
        self._vessels = vessels

    def get_vessel_count(self) -> int:
        return len(self._vessels)

    async def _publish_loop(self):
        """Main publish loop - runs every PUBLISH_INTERVAL_S."""
        nats = get_nats()

        while self._running:
            try:
                if self._vessels:
                    # Build batch message - strip internal fields
                    batch_vessels = [
                        {k: v for k, v in vessel.items() if not k.startswith("_")}
                        for vessel in self._vessels.values()
                    ]

                    batch_msg = {
                        "count": len(batch_vessels),
                        "vessels": batch_vessels,
                    }

                    # Publish to NATS
                    await nats.publish(AIS_SUBJECT, batch_msg)
                    self._last_publish = time.time()

            except Exception as e:
                logger.warning(f"AIS batch publish error: {e}")

            await asyncio.sleep(PUBLISH_INTERVAL_S)


# Singleton instance
_ais_publisher: AISPublisher | None = None


def get_ais_publisher() -> AISPublisher:
    global _ais_publisher
    if _ais_publisher is None:
        _ais_publisher = AISPublisher()
    return _ais_publisher
