#!/usr/bin/env python3
"""
Standalone AIS stream worker — runs as a subprocess, completely isolated
from uvicorn's event loop. Writes vessel data to data/real/ais_live.json.
Main server reads that file every few seconds.

Usage: python ais_worker.py
"""

import asyncio
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import websockets

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
API_KEY       = os.getenv("AISSTREAM_API_KEY", "").strip()
OUT_FILE      = Path(__file__).parent.parent / "data" / "real" / "ais_live.json"
MAX_VESSELS   = 3000
MAX_AGE_MIN   = 30

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

_OAE_ZONES = [
    {"lat": 35.2, "lon": -121.4},
    {"lat": 32.8, "lon": -118.8},
    {"lat": 34.0, "lon": -118.4},
]

def _type_name(code: int) -> str:
    for r, name in _TYPE_RANGES:
        if code in r:
            return name
    return "Unknown"

def _conflict(lat, lon) -> bool:
    return any(
        math.sqrt((lat - z["lat"])**2 + (lon - z["lon"])**2) < 1.5
        for z in _OAE_ZONES
    )

def _flush(vessels: dict) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    cutoff  = (datetime.now(timezone.utc).timestamp() - MAX_AGE_MIN * 60)
    active  = {
        mmsi: v for mmsi, v in vessels.items()
        if v.get("_ts", 0) >= cutoff
    }
    out = [
        {k: v for k, v in vessel.items() if not k.startswith("_")}
        for vessel in active.values()
    ]
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_FILE.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump({"updated": now_iso, "count": len(out), "vessels": out}, f)
    tmp.replace(OUT_FILE)

async def stream():
    if not API_KEY:
        print("[AIS worker] No API key — exiting", flush=True)
        sys.exit(0)

    # Use multiple regional boxes instead of one global box.
    # aisstream.io floods too fast with a single global subscription,
    # overflowing the receive buffer. Regional boxes give manageable rates
    # while covering all major ocean regions.
    subscription = json.dumps({
        "APIKey": API_KEY,
        "BoundingBoxes": [
            [[ 20,  -170], [ 65,  -100]],   # North Pacific + CA coast
            [[-60,  -180], [ 20,  -100]],   # South Pacific
            [[ 20,  -100], [ 65,   -10]],   # North Atlantic
            [[-60,  -100], [ 20,   -10]],   # South Atlantic
            [[ 20,   -10], [ 65,   180]],   # Europe / Indian Ocean
            [[-60,   -10], [ 20,   180]],   # Southern Ocean + Pacific
        ],
        "FilterMessageTypes": [
            "PositionReport",
            "StandardClassBPositionReport",
        ],
    })

    vessels: dict = {}
    last_flush = time.time()

    while True:
        try:
            print("[AIS worker] connecting…", flush=True)
            async with websockets.connect(
                AISSTREAM_URL,
                ping_interval=None,
                open_timeout=20,
                max_size=None,
            ) as ws:
                await ws.send(subscription)
                print(f"[AIS worker] connected — streaming live global AIS", flush=True)

                msg_count = 0
                async for raw in ws:
                    msg_count += 1
                    await asyncio.sleep(0)  # yield to event loop every message
                    try:
                        msg      = json.loads(raw)
                        meta     = msg.get("MetaData", {})
                        msg_type = msg.get("MessageType", "")
                        mmsi     = str(meta.get("MMSI", "")).strip()

                        if not mmsi or msg_type not in (
                            "PositionReport",
                            "StandardClassBPositionReport",
                            "ExtendedClassBCsPositionReport",
                        ):
                            continue

                        report = msg.get("Message", {}).get(msg_type, {})
                        lat    = meta.get("latitude")
                        lon    = meta.get("longitude")
                        if lat is None or lon is None:
                            continue
                        if abs(lat) > 90 or abs(lon) > 180:
                            continue

                        sog     = float(report.get("Sog",  0) or 0)
                        heading = float(report.get("TrueHeading") or report.get("Cog") or 0)
                        name    = meta.get("ShipName", "").strip() or vessels.get(mmsi, {}).get("name") or f"MMSI {mmsi}"
                        typ     = vessels.get(mmsi, {}).get("vessel_type") or _type_name(int(meta.get("ShipType", 0) or 0))

                        vessels[mmsi] = {
                            "vessel_id":    mmsi,
                            "name":         name,
                            "vessel_type":  typ,
                            "lat":          round(lat, 5),
                            "lon":          round(lon, 5),
                            "heading":      round(heading % 360, 1),
                            "speed_kn":     round(sog, 1),
                            "mmsi":         mmsi,
                            "conflict_risk": _conflict(lat, lon),
                            "_ts":          time.time(),
                        }

                        # Prune if too large
                        if len(vessels) > MAX_VESSELS:
                            oldest = sorted(vessels, key=lambda k: vessels[k]["_ts"])
                            for k in oldest[:300]:
                                vessels.pop(k, None)

                    except Exception:
                        pass

                    # Flush to disk every 5 seconds
                    now = time.time()
                    if now - last_flush >= 5:
                        _flush(vessels)
                        last_flush = now
                        print(f"[AIS worker] {len(vessels)} vessels cached", flush=True)

        except Exception as e:
            print(f"[AIS worker] {type(e).__name__}: {e} — reconnecting in 10s", flush=True)
            await asyncio.sleep(10)

if __name__ == "__main__":
    asyncio.run(stream())
