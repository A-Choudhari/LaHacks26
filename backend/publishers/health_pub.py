"""
Health beacon publisher - publishes system health every 1 second.
Subject: health.backend
"""

import asyncio
import logging
import subprocess

from nats_client import get_nats
from config import JULIA_SCRIPT, JULIA_INSTALLED, MOCK_DATA_DIR
import ais_stream

logger = logging.getLogger(__name__)

HEALTH_SUBJECT = "health.backend"
PUBLISH_INTERVAL_S = 1.0


class HealthPublisher:
    """Publishes health status to NATS every second."""

    def __init__(self):
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self):
        """Start the health publisher background task."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._publish_loop())
        logger.info("Health publisher started")

    async def stop(self):
        """Stop the health publisher."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Health publisher stopped")

    def _check_ollama(self) -> bool:
        """Check if Ollama is available."""
        try:
            result = subprocess.run(
                ["curl", "-s", "http://localhost:11434/api/tags"],
                capture_output=True,
                timeout=1,
            )
            return result.returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return False

    async def _publish_loop(self):
        """Main publish loop - runs every PUBLISH_INTERVAL_S."""
        nats = get_nats()

        while self._running:
            try:
                # Gather health data
                julia_ok = JULIA_SCRIPT.exists() and JULIA_INSTALLED
                mock_ok = MOCK_DATA_DIR.exists() and any(MOCK_DATA_DIR.glob("*.json"))
                ollama_ok = self._check_ollama()

                health_data = {
                    "status": "ok",
                    "julia_available": julia_ok,
                    "mock_data_available": mock_ok,
                    "ollama_available": ollama_ok,
                    "ais_live": ais_stream.is_connected(),
                    "ais_vessels": ais_stream.vessel_count(),
                }

                # Publish to NATS
                await nats.publish(HEALTH_SUBJECT, health_data)

            except Exception as e:
                logger.warning(f"Health publish error: {e}")

            await asyncio.sleep(PUBLISH_INTERVAL_S)


# Singleton instance
_health_publisher: HealthPublisher | None = None


def get_health_publisher() -> HealthPublisher:
    global _health_publisher
    if _health_publisher is None:
        _health_publisher = HealthPublisher()
    return _health_publisher
