"""
Real-time global AIS vessel stream via aisstream.io.

Architecture: ais_worker.py runs as a child subprocess with its own
Python interpreter + clean event loop, streams vessels to
data/real/ais_live.json every 5 seconds. This server reads that file.

When NATS is available, vessel data is also published to ais.batch
for real-time frontend updates (2s instead of 30s polling).

Set AISSTREAM_API_KEY in backend/.env to activate.
Free key: https://aisstream.io
"""

import asyncio
import json
import logging
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

# NATS publisher (lazy loaded to avoid import errors if nats-py not installed)
_ais_publisher = None
_nats_publish_task = None

PROJECT_ROOT = Path(__file__).parent.parent
LIVE_FILE    = PROJECT_ROOT / "data" / "real" / "ais_live.json"
WORKER       = Path(__file__).parent / "ais_worker.py"
API_KEY      = os.getenv("AISSTREAM_API_KEY", "").strip()

_proc: subprocess.Popen | None = None

# ── OAE conflict detection ────────────────────────────────────────────────────

_OAE_ZONES = [
    {"lat": 35.2, "lon": -121.4},
    {"lat": 32.8, "lon": -118.8},
    {"lat": 34.0, "lon": -118.4},
]

def _has_conflict(lat: float, lon: float) -> bool:
    return any(
        math.sqrt((lat - z["lat"])**2 + (lon - z["lon"])**2) < 1.5
        for z in _OAE_ZONES
    )


# ── Subprocess management ─────────────────────────────────────────────────────

async def stream_forever() -> None:
    """Launch ais_worker.py as a subprocess. FastAPI startup hook."""
    global _proc, _ais_publisher, _nats_publish_task

    # Start NATS AIS publisher if available
    try:
        from nats_client import is_nats_available
        from publishers.ais_pub import get_ais_publisher

        if await is_nats_available():
            _ais_publisher = get_ais_publisher()
            await _ais_publisher.start()
            # Start background task to push file data to NATS
            _nats_publish_task = asyncio.create_task(_nats_file_bridge())
            logger.info("AIS NATS publisher started")
    except ImportError:
        logger.debug("NATS modules not available for AIS streaming")
    except Exception as e:
        logger.warning(f"AIS NATS publisher failed to start: {e}")

    if not API_KEY:
        logger.info("AISSTREAM_API_KEY not set — using curated AIS data. "
                    "Free key: https://aisstream.io")
        return

    logger.info("AIS: starting worker subprocess…")
    _proc = await asyncio.create_subprocess_exec(
        sys.executable, str(WORKER),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env={**os.environ},         # inherit env including AISSTREAM_API_KEY
    )

    # Log worker stdout in the background
    async def _drain():
        assert _proc and _proc.stdout
        async for line in _proc.stdout:
            logger.info("AIS worker: %s", line.decode().rstrip())

    asyncio.create_task(_drain())
    logger.info(f"AIS worker PID {_proc.pid} started")


async def _nats_file_bridge() -> None:
    """
    Bridge between file-based AIS data and NATS publisher.
    Reads the ais_live.json file every 2 seconds and pushes to NATS.
    This keeps the architecture simple - worker writes to file,
    this bridge publishes to NATS.
    """
    global _ais_publisher

    while True:
        try:
            if _ais_publisher:
                data = _read_live_file()
                if data and "vessels" in data:
                    vessels_dict = {
                        v.get("mmsi", v.get("vessel_id", str(i))): v
                        for i, v in enumerate(data["vessels"])
                    }
                    _ais_publisher.set_vessels(vessels_dict)
        except Exception as e:
            logger.debug(f"NATS file bridge error: {e}")

        await asyncio.sleep(2)


# ── Public API ────────────────────────────────────────────────────────────────

def is_connected() -> bool:
    if _proc is None:
        return False
    if _proc.returncode is not None:
        return False            # process died
    return LIVE_FILE.exists()


def vessel_count() -> int:
    data = _read_live_file()
    return data.get("count", 0) if data else 0


def get_vessels(max_age: int = 30) -> list[dict]:
    """Return vessels from the live file written by the worker subprocess."""
    data = _read_live_file()
    if not data:
        return []
    return data.get("vessels", [])


def _read_live_file() -> dict | None:
    if not LIVE_FILE.exists():
        return None
    age = time.time() - LIVE_FILE.stat().st_mtime
    if age > 120:
        return None   # file is stale — worker probably died
    try:
        with open(LIVE_FILE) as f:
            return json.load(f)
    except Exception:
        return None
