"""
Real-time global AIS vessel stream via aisstream.io WebSocket API.

Set AISSTREAM_API_KEY env var to enable live data.
Free key: https://aisstream.io (takes ~1 minute to sign up)
Without a key: falls back to curated NOAA AIS sample data.

The stream runs as a FastAPI background task on startup,
storing up to 5,000 vessel positions in memory.
"""

import asyncio
import json
import logging
import math
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

AISSTREAM_URL   = "wss://stream.aisstream.io/v0/stream"
API_KEY         = os.getenv("AISSTREAM_API_KEY", "")
MAX_VESSELS     = 5000
MAX_AGE_MINUTES = 30

# In-memory store: MMSI -> vessel dict
_vessels: dict[str, dict] = {}
_connected: bool = False

# ── AIS vessel type code → readable name ──────────────────────────────────────

_TYPE_RANGES = [
    (range(30, 31), "Fishing"),
    (range(31, 33), "Towing"),
    (range(36, 37), "Sailing"),
    (range(37, 38), "Pleasure Craft"),
    (range(60, 70), "Passenger"),
    (range(70, 80), "Cargo"),
    (range(80, 90), "Tanker"),
    (range(90, 100), "Other"),
]

def _type_name(code: int) -> str:
    for r, name in _TYPE_RANGES:
        if code in r:
            return name
    return "Unknown"


# ── OAE zone centroids — used to flag vessels near deployment sites ───────────

_OAE_ZONES = [
    {"name": "Zone Alpha", "lat": 35.2, "lon": -121.4},
    {"name": "Zone Beta",  "lat": 32.8, "lon": -118.8},
    {"name": "Zone Gamma", "lat": 34.0, "lon": -118.4},
]
CONFLICT_RADIUS_DEG = 1.5   # ~150km

def _has_conflict(lat: float, lon: float) -> bool:
    for z in _OAE_ZONES:
        dist = math.sqrt((lat - z["lat"])**2 + (lon - z["lon"])**2)
        if dist < CONFLICT_RADIUS_DEG:
            return True
    return False


# ── Message handler ────────────────────────────────────────────────────────────

def _handle(raw: dict) -> None:
    meta     = raw.get("MetaData", {})
    msg_type = raw.get("MessageType", "")
    mmsi     = str(meta.get("MMSI", "")).strip()

    if not mmsi or msg_type not in (
        "PositionReport",
        "StandardClassBPositionReport",
        "ExtendedClassBCsPositionReport",
    ):
        return

    report = raw.get("Message", {}).get(msg_type, {})
    lat = meta.get("latitude")
    lon = meta.get("longitude")
    if lat is None or lon is None:
        return

    # Skip implausible positions
    if abs(lat) > 90 or abs(lon) > 180:
        return

    sog     = float(report.get("Sog", 0) or 0)
    heading = float(report.get("TrueHeading") or report.get("Cog") or 0)
    now     = datetime.now(timezone.utc).isoformat()

    existing = _vessels.get(mmsi, {})
    ship_name = meta.get("ShipName", "").strip() or existing.get("name") or f"MMSI {mmsi}"

    _vessels[mmsi] = {
        "vessel_id":    mmsi,
        "name":         ship_name,
        "vessel_type":  existing.get("vessel_type", _type_name(int(meta.get("ShipType", 0) or 0))),
        "lat":          round(lat, 5),
        "lon":          round(lon, 5),
        "heading":      round(heading % 360, 1),
        "speed_kn":     round(sog, 1),
        "mmsi":         mmsi,
        "conflict_risk": _has_conflict(lat, lon),
        "last_seen":    now,
    }

    # Prune oldest entries if store is too large
    if len(_vessels) > MAX_VESSELS:
        cutoff_count = len(_vessels) - MAX_VESSELS + 200
        oldest = sorted(_vessels, key=lambda k: _vessels[k].get("last_seen", ""))
        for k in oldest[:cutoff_count]:
            _vessels.pop(k, None)


# ── Background WebSocket task ──────────────────────────────────────────────────

async def stream_forever() -> None:
    """
    Persistent WebSocket connection to aisstream.io.
    Reconnects automatically on disconnect.
    Exits immediately if no API key is configured.
    """
    global _connected

    if not API_KEY:
        logger.info("AISSTREAM_API_KEY not set — using curated AIS data. "
                    "Get a free key at https://aisstream.io")
        return

    # Subscription: global bounding box, position reports only
    subscription = {
        "APIKey":          API_KEY,
        "BoundingBoxes":   [[[-90, -180], [90, 180]]],
        "FilterMessageTypes": [
            "PositionReport",
            "StandardClassBPositionReport",
            "ExtendedClassBCsPositionReport",
        ],
    }

    try:
        import websockets
    except ImportError:
        logger.error("pip install websockets  ← required for live AIS stream")
        return

    while True:
        try:
            logger.info("AIS: connecting to aisstream.io…")
            async with websockets.connect(
                AISSTREAM_URL,
                ping_interval=20,
                ping_timeout=30,
                open_timeout=15,
            ) as ws:
                await ws.send(json.dumps(subscription))
                _connected = True
                logger.info("AIS: connected — streaming global vessel positions")

                async for raw in ws:
                    try:
                        _handle(json.loads(raw))
                    except Exception:
                        pass   # never crash the stream on a bad message

        except Exception as e:
            _connected = False
            logger.warning(f"AIS: disconnected ({e}) — reconnecting in 15s")
            await asyncio.sleep(15)


# ── Public API ─────────────────────────────────────────────────────────────────

def get_vessels(max_age: int = MAX_AGE_MINUTES) -> list[dict]:
    """Return vessels seen within the last `max_age` minutes."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=max_age)).isoformat()
    return [v for v in _vessels.values() if v.get("last_seen", "") >= cutoff]


def is_connected() -> bool:
    return _connected


def vessel_count() -> int:
    return len(_vessels)
