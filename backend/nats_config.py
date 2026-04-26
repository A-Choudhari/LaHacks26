"""
NATS JetStream configuration for OceanOps.
Defines streams and consumers for message persistence and replay.
"""

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Stream configurations
STREAM_CONFIGS: dict[str, dict[str, Any]] = {
    # Health stream - short retention, just for connectivity awareness
    "HEALTH": {
        "name": "HEALTH",
        "subjects": ["health.>"],
        "retention": "limits",  # Delete old messages when limit reached
        "max_msgs": 100,        # Keep last 100 health messages
        "max_age": 60 * 5,      # 5 minutes max retention (in seconds)
        "storage": "memory",    # Memory storage for speed
        "replicas": 1,
    },

    # Fleet telemetry stream - longer retention for replay on reconnect
    "FLEET": {
        "name": "FLEET",
        "subjects": ["fleet.>"],
        "retention": "limits",
        "max_msgs": 10000,      # Keep last 10k position updates
        "max_age": 60 * 60,     # 1 hour max retention
        "storage": "file",      # File storage for persistence
        "replicas": 1,
    },

    # AIS traffic stream - moderate retention
    "AIS": {
        "name": "AIS",
        "subjects": ["ais.>"],
        "retention": "limits",
        "max_msgs": 1000,       # Keep last 1k batches
        "max_age": 60 * 30,     # 30 minutes max retention
        "storage": "file",
        "replicas": 1,
    },
}

# Consumer configurations for replay
CONSUMER_CONFIGS: dict[str, dict[str, Any]] = {
    # Durable consumer for fleet replay
    "fleet-replay": {
        "stream": "FLEET",
        "durable_name": "fleet-replay",
        "deliver_policy": "last_per_subject",  # Get last message per ship
        "ack_policy": "explicit",
        "max_deliver": 3,
    },

    # Durable consumer for AIS replay
    "ais-replay": {
        "stream": "AIS",
        "durable_name": "ais-replay",
        "deliver_policy": "last",  # Get last batch
        "ack_policy": "explicit",
        "max_deliver": 3,
    },
}


async def setup_jetstream_streams():
    """
    Create JetStream streams if they don't exist.
    Called during backend startup.
    """
    try:
        from nats_client import get_nats

        nats = get_nats()
        if not nats.is_connected or not nats.jetstream:
            logger.warning("JetStream not available - skipping stream setup")
            return False

        js = nats.jetstream

        for name, config in STREAM_CONFIGS.items():
            try:
                # Check if stream exists
                try:
                    await js.stream_info(name)
                    logger.info(f"JetStream stream {name} already exists")
                except Exception:
                    # Create stream
                    await js.add_stream(**config)
                    logger.info(f"Created JetStream stream {name}")
            except Exception as e:
                logger.warning(f"Failed to setup stream {name}: {e}")

        return True

    except ImportError:
        logger.debug("nats-py not installed - JetStream streams not configured")
        return False
    except Exception as e:
        logger.warning(f"JetStream setup error: {e}")
        return False


async def setup_jetstream_consumers():
    """
    Create durable consumers for replay functionality.
    Called during backend startup after streams are created.
    """
    try:
        from nats_client import get_nats

        nats = get_nats()
        if not nats.is_connected or not nats.jetstream:
            return False

        js = nats.jetstream

        for name, config in CONSUMER_CONFIGS.items():
            try:
                stream = config.pop("stream")
                try:
                    await js.consumer_info(stream, config["durable_name"])
                    logger.info(f"JetStream consumer {name} already exists")
                except Exception:
                    await js.add_consumer(stream, **config)
                    logger.info(f"Created JetStream consumer {name}")
                config["stream"] = stream  # Restore for next iteration
            except Exception as e:
                logger.warning(f"Failed to setup consumer {name}: {e}")

        return True

    except Exception as e:
        logger.warning(f"JetStream consumer setup error: {e}")
        return False
