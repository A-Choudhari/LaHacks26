"""
Agent 1: Spatial Intelligence — OAE site selection.

Function tools:
  get_mpa_overlap(lat, lon, radius_km)  → overlaps: bool
  get_ocean_state(lat, lon)             → temperature, salinity, MLD, suitability

ADK path: Gemini 2.0 Flash reasons over tool outputs and returns a suitability score.
Fallback: tools are called directly; score is computed deterministically.
"""

import json
import math
import logging
from pathlib import Path
from typing import Any

from .base import ADK_AVAILABLE, run_adk_agent

logger = logging.getLogger(__name__)

_CALCOFI_FILE = Path(__file__).parent.parent.parent / "data" / "mock" / "calcofi_stations.json"

# MPA bounding boxes: (lon_min, lat_min, lon_max, lat_max)
_MPA_BOXES = [
    (-119.9, 33.85, -119.3, 34.15, "Channel Islands NMS"),
    (-118.82, 33.98, -118.75, 34.02, "Point Dume SMCA"),
]


# ── ADK function tools ────────────────────────────────────────────────────────

def get_mpa_overlap(lat: float, lon: float, radius_km: float) -> dict:
    """Check whether a deployment circle overlaps a Marine Protected Area."""
    for (lon_min, lat_min, lon_max, lat_max, name) in _MPA_BOXES:
        cx = (lon_min + lon_max) / 2
        cy = (lat_min + lat_max) / 2
        dx = (lon - cx) * 111.32 * math.cos(math.radians(lat))
        dy = (lat - cy) * 111.32
        d = math.sqrt(dx**2 + dy**2)
        box_r = max(
            (lon_max - lon_min) * 111.32 * math.cos(math.radians(lat)) / 2,
            (lat_max - lat_min) * 111.32 / 2,
        )
        if d < radius_km + box_r:
            return {"overlaps": True, "mpa_name": name, "distance_km": round(d, 2)}
    return {"overlaps": False, "mpa_name": None, "distance_km": None}


def get_ocean_state(lat: float, lon: float) -> dict:
    """Return nearest-station ocean state (temperature, salinity, MLD, alkalinity)."""
    if _CALCOFI_FILE.exists():
        with open(_CALCOFI_FILE) as f:
            stations = json.load(f)
        nearest = min(
            stations,
            key=lambda s: math.sqrt((s["lat"] - lat) ** 2 + (s["lon"] - lon) ** 2),
        )
        return {
            "temperature_c": nearest["temperature_c"],
            "salinity_psu": nearest["salinity_psu"],
            "mixed_layer_depth_m": nearest["mixed_layer_depth_m"],
            "alkalinity_umol_kg": nearest["alkalinity_umol_kg"],
            "suitability_score": nearest["suitability_score"],
        }
    return {
        "temperature_c": 15.0,
        "salinity_psu": 35.0,
        "mixed_layer_depth_m": 60.0,
        "alkalinity_umol_kg": 2280.0,
        "suitability_score": 0.75,
    }


# ── Rule-based scoring (fallback) ─────────────────────────────────────────────

def _compute_score(ocean: dict, mpa: dict) -> tuple[float, str]:
    score = ocean["suitability_score"]

    # Penalise MPA proximity
    if mpa["overlaps"]:
        score -= 0.30
        reason = f"MPA conflict ({mpa['mpa_name']}) — deployment not recommended near protected area."
    else:
        # Bonus for deep mixed layer (better mixing → better TA uptake)
        mld = ocean["mixed_layer_depth_m"]
        if mld >= 70:
            score = min(1.0, score + 0.05)
            reason = f"Excellent site — deep mixed layer ({mld:.0f}m), no MPA conflict."
        elif mld >= 55:
            reason = f"Good site — mixed layer {mld:.0f}m, clear of MPAs."
        else:
            score = max(0.0, score - 0.05)
            reason = f"Marginal site — shallow mixed layer ({mld:.0f}m) limits TA dispersal."

    return round(max(0.0, min(1.0, score)), 3), reason


# ── Public agent interface ────────────────────────────────────────────────────

class SpatialIntelligenceAgent:
    """Site-selection agent wrapping Google ADK with rule-based fallback."""

    def __init__(self) -> None:
        self._adk_agent: Any = None
        if ADK_AVAILABLE:
            try:
                from google.adk import Agent
                self._adk_agent = Agent(
                    name="spatial_intelligence",
                    model="gemini-2.0-flash",
                    description="OAE deployment site selection agent",
                    instruction=(
                        "You are a marine scientist selecting optimal Ocean Alkalinity Enhancement "
                        "deployment sites. Use the provided tools to assess MPA overlap and ocean state, "
                        "then return a JSON object with fields: suitability_score (0-1), reason (string), "
                        "mpa_conflict (bool)."
                    ),
                    tools=[get_mpa_overlap, get_ocean_state],
                )
            except Exception as e:
                logger.warning("Failed to build ADK spatial agent: %s", e)

    async def run(self, lat: float, lon: float, radius_km: float = 25.0) -> dict:
        """Evaluate a candidate deployment site."""

        if self._adk_agent is not None:
            try:
                prompt = (
                    f"Evaluate OAE deployment at lat={lat}, lon={lon}, radius={radius_km}km. "
                    "Call get_mpa_overlap and get_ocean_state, then output a JSON with "
                    "suitability_score, reason, and mpa_conflict."
                )
                text = await run_adk_agent(self._adk_agent, prompt)
                # Try to extract JSON from the response
                import re
                m = re.search(r"\{.*\}", text, re.DOTALL)
                if m:
                    return json.loads(m.group())
            except Exception as e:
                logger.warning("ADK spatial agent failed, using fallback: %s", e)

        # Rule-based fallback
        ocean = get_ocean_state(lat, lon)
        mpa = get_mpa_overlap(lat, lon, radius_km)
        score, reason = _compute_score(ocean, mpa)
        return {
            "suitability_score": score,
            "reason": reason,
            "mpa_conflict": mpa["overlaps"],
            "ocean_state": ocean,
            "model_used": "rule-based-fallback",
        }
