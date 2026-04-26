"""
Agent 1: Spatial Intelligence — OAE site selection.

Function tools (always run deterministically):
  get_mpa_overlap(lat, lon, radius_km)  → overlaps: bool, mpa_name: str
  get_ocean_state(lat, lon)             → temperature, salinity, MLD, alkalinity, suitability

Agent flow:
  1. Run both tool functions to get objective measurements.
  2. Send tool results to local Gemma4 for scoring and recommendation.
  3. If Gemma4 unavailable, compute score deterministically.
"""

import json
import math
import logging
from pathlib import Path

from .base import query_gemma, extract_json

logger = logging.getLogger(__name__)

_CALCOFI_FILE = Path(__file__).parent.parent.parent / "data" / "mock" / "calcofi_stations.json"

# MPA bounding boxes: (lon_min, lat_min, lon_max, lat_max, name)
_MPA_BOXES = [
    (-119.9, 33.85, -119.3, 34.15, "Channel Islands NMS"),
    (-118.82, 33.98, -118.75, 34.02, "Point Dume SMCA"),
]


# ── Tool functions (deterministic) ───────────────────────────────────────────

def get_mpa_overlap(lat: float, lon: float, radius_km: float) -> dict:
    """Check whether a deployment circle overlaps a Marine Protected Area."""
    for (lon_min, lat_min, lon_max, lat_max, name) in _MPA_BOXES:
        cx = (lon_min + lon_max) / 2
        cy = (lat_min + lat_max) / 2
        dx = (lon - cx) * 111.32 * math.cos(math.radians(lat))
        dy = (lat - cy) * 111.32
        d = math.sqrt(dx ** 2 + dy ** 2)
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


# ── Rule-based scoring (deterministic fallback) ───────────────────────────────

def _compute_score(ocean: dict, mpa: dict) -> tuple[float, str]:
    score = ocean["suitability_score"]

    if mpa["overlaps"]:
        score -= 0.30
        reason = f"MPA conflict ({mpa['mpa_name']}) — deployment not recommended near protected area."
    else:
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
    """
    Site-selection agent — runs locally via Gemma4/Ollama.
    Tools always execute deterministically; Gemma4 synthesises the suitability score and reasoning.
    """

    async def run(self, lat: float, lon: float, radius_km: float = 25.0) -> dict:
        # Always run tools deterministically
        ocean = get_ocean_state(lat, lon)
        mpa = get_mpa_overlap(lat, lon, radius_km)

        # Try Gemma4 for richer reasoning
        try:
            system = (
                "You are a marine scientist evaluating Ocean Alkalinity Enhancement deployment sites. "
                "Given ocean state measurements and MPA overlap data, rate the site suitability. "
                "Respond ONLY with valid JSON: "
                "suitability_score (0.0-1.0 float), reason (string), mpa_conflict (bool)."
            )
            prompt = (
                f"Evaluate OAE deployment site at lat={lat:.3f}, lon={lon:.3f}, radius={radius_km}km.\n\n"
                f"MPA overlap: {json.dumps(mpa)}\n"
                f"Ocean state: {json.dumps(ocean)}\n\n"
                "Rate suitability (0-1) with a reason. Consider: mixed layer depth, "
                "MPA proximity, temperature (12-18°C optimal), and salinity (33-36 PSU optimal)."
            )
            text = await query_gemma(prompt, system=system)
            parsed = extract_json(text)
            if parsed and "suitability_score" in parsed:
                parsed["model_used"] = "gemma4:31b (local)"
                parsed["ocean_state"] = ocean
                return parsed
        except Exception as e:
            logger.info("Gemma4 scoring unavailable, using rule-based: %s", e)

        score, reason = _compute_score(ocean, mpa)
        return {
            "suitability_score": score,
            "reason": reason,
            "mpa_conflict": mpa["overlaps"],
            "ocean_state": ocean,
            "model_used": "rule-based-fallback",
        }
