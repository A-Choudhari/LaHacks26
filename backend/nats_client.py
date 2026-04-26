"""
NATS client singleton for OceanOps.
Manages connection lifecycle and provides publish/subscribe utilities.
"""

import asyncio
import json
import logging
import os
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# Lazy import to avoid startup crash if nats-py not installed
_nats_module = None
_nats_js_module = None


def _ensure_nats():
    """Lazy import NATS modules."""
    global _nats_module, _nats_js_module
    if _nats_module is None:
        try:
            import nats
            from nats.js import JetStreamContext
            _nats_module = nats
            _nats_js_module = JetStreamContext
        except ImportError:
            logger.warning("nats-py not installed - NATS streaming disabled")
            return False
    return True


# Configuration
NATS_URL = os.environ.get("NATS_URL", "nats://localhost:4222")


class NATSClient:
    """Singleton NATS connection manager with auto-reconnect."""

    _instance: Optional["NATSClient"] = None

    def __init__(self):
        self._nc = None  # NATS connection
        self._js = None  # JetStream context
        self._connected = False
        self._reconnecting = False
        self._seq_counters: dict[str, int] = {}  # Per-subject sequence numbers

    @classmethod
    def get_instance(cls) -> "NATSClient":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @property
    def is_connected(self) -> bool:
        return self._connected and self._nc is not None

    @property
    def jetstream(self):
        """Get JetStream context (None if not connected)."""
        return self._js

    async def connect(self) -> bool:
        """
        Connect to NATS server with auto-reconnect.
        Returns True if connected, False if NATS unavailable.
        """
        if not _ensure_nats():
            return False

        if self._connected:
            return True

        try:
            self._nc = await _nats_module.connect(
                servers=[NATS_URL],
                reconnect_time_wait=2,
                max_reconnect_attempts=-1,  # Infinite reconnects
                error_cb=self._on_error,
                disconnected_cb=self._on_disconnect,
                reconnected_cb=self._on_reconnect,
                closed_cb=self._on_close,
            )

            # Initialize JetStream
            self._js = self._nc.jetstream()
            self._connected = True
            logger.info(f"NATS connected to {NATS_URL}")
            return True

        except Exception as e:
            logger.warning(f"NATS connection failed: {e}")
            self._connected = False
            return False

    async def disconnect(self):
        """Gracefully disconnect from NATS."""
        if self._nc:
            try:
                await self._nc.drain()
                await self._nc.close()
            except Exception as e:
                logger.warning(f"NATS disconnect error: {e}")
            finally:
                self._nc = None
                self._js = None
                self._connected = False
                logger.info("NATS disconnected")

    def next_seq(self, subject: str) -> int:
        """Get next monotonic sequence number for a subject."""
        self._seq_counters[subject] = self._seq_counters.get(subject, 0) + 1
        return self._seq_counters[subject]

    async def publish(self, subject: str, data: dict[str, Any]) -> bool:
        """
        Publish a JSON message to a subject.
        Automatically adds timestamp (ts) and sequence number (seq).
        Returns True if published, False if not connected.
        """
        if not self.is_connected:
            return False

        try:
            import time
            msg = {
                "ts": int(time.time() * 1000),  # Unix ms
                "seq": self.next_seq(subject),
                **data,
            }
            payload = json.dumps(msg).encode("utf-8")
            await self._nc.publish(subject, payload)
            return True
        except Exception as e:
            logger.warning(f"NATS publish error on {subject}: {e}")
            return False

    async def publish_to_stream(self, subject: str, data: dict[str, Any]) -> bool:
        """
        Publish to JetStream (persisted).
        Same as publish() but uses JetStream for guaranteed delivery.
        """
        if not self.is_connected or not self._js:
            return False

        try:
            import time
            msg = {
                "ts": int(time.time() * 1000),
                "seq": self.next_seq(subject),
                **data,
            }
            payload = json.dumps(msg).encode("utf-8")
            await self._js.publish(subject, payload)
            return True
        except Exception as e:
            logger.warning(f"NATS JetStream publish error on {subject}: {e}")
            return False

    async def subscribe(
        self,
        subject: str,
        callback: Callable[[dict[str, Any]], None],
        queue: Optional[str] = None,
    ):
        """
        Subscribe to a subject with a callback.
        Callback receives parsed JSON dict.
        """
        if not self.is_connected:
            logger.warning(f"Cannot subscribe to {subject} - not connected")
            return None

        async def msg_handler(msg):
            try:
                data = json.loads(msg.data.decode("utf-8"))
                await callback(data)
            except Exception as e:
                logger.warning(f"NATS message handler error on {subject}: {e}")

        try:
            if queue:
                sub = await self._nc.subscribe(subject, queue=queue, cb=msg_handler)
            else:
                sub = await self._nc.subscribe(subject, cb=msg_handler)
            logger.info(f"NATS subscribed to {subject}")
            return sub
        except Exception as e:
            logger.warning(f"NATS subscribe error on {subject}: {e}")
            return None

    # Connection event handlers
    async def _on_error(self, e):
        logger.error(f"NATS error: {e}")

    async def _on_disconnect(self):
        logger.warning("NATS disconnected")
        self._reconnecting = True

    async def _on_reconnect(self):
        logger.info("NATS reconnected")
        self._reconnecting = False

    async def _on_close(self):
        logger.info("NATS connection closed")
        self._connected = False


# Convenience function for getting the singleton
def get_nats() -> NATSClient:
    return NATSClient.get_instance()


async def is_nats_available() -> bool:
    """Check if NATS server is reachable."""
    client = get_nats()
    if client.is_connected:
        return True
    return await client.connect()
