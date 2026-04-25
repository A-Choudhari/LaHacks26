"""
AI-recommended deployment zone discovery endpoint.
"""

import asyncio
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from agents import get_spatial_agent

router = APIRouter()


class DiscoveryZone(BaseModel):
    lat: float
    lon: float
    score: float
    reason: str
    mpa_conflict: bool
    name: Optional[str] = None


@router.post("/discover", response_model=list[DiscoveryZone])
async def discover_zones():
    """
    AI-recommended OAE deployment zones.

    The Spatial Intelligence agent evaluates candidate sites from the
    CalCOFI grid and returns the top sites ranked by suitability.
    """
    # Candidate sites drawn from CalCOFI station positions
    candidates = [
        (36.47, -122.44), (35.21, -122.09), (34.02, -121.50),
        (34.97, -121.55), (33.78, -120.95), (32.82, -120.91),
        (31.62, -120.32), (30.42, -119.73),
    ]

    agent = get_spatial_agent()
    tasks = [agent.run(lat=lat, lon=lon, radius_km=30.0) for lat, lon in candidates]
    results = await asyncio.gather(*tasks)

    zones: list[DiscoveryZone] = []
    for (lat, lon), r in zip(candidates, results):
        zones.append(DiscoveryZone(
            lat=lat,
            lon=lon,
            score=r.get("suitability_score", 0.5),
            reason=r.get("reason", ""),
            mpa_conflict=r.get("mpa_conflict", False),
        ))

    # Return top 5 by score, filter out MPA conflicts; assign alphabetic site names
    zones.sort(key=lambda z: z.score, reverse=True)
    filtered = [z for z in zones if not z.mpa_conflict][:5]
    for i, z in enumerate(filtered):
        z.name = f"Site {chr(65 + i)}"
    return filtered
