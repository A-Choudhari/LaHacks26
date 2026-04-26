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
import re
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


# ── Batch scoring (single LLM round-trip for N candidates) ───────────────────

async def score_sites_batch(
    candidates: list[tuple[float, float]],
    radius_km: float = 30.0,
) -> list[dict]:
    """
    Score all candidate sites with one Gemma4 call instead of N separate calls.

    Flow:
      1. Run get_ocean_state + get_mpa_overlap deterministically for every site.
      2. Pack all results into one prompt → single Ollama round-trip.
      3. Parse the returned JSON array; fall back per-site to rule-based if the
         array is missing, malformed, or shorter than expected.
    """
    # Step 1 — deterministic tools (all in-process, no I/O)
    candidate_data = []
    for lat, lon in candidates:
        ocean = get_ocean_state(lat, lon)
        mpa   = get_mpa_overlap(lat, lon, radius_km)
        candidate_data.append({"lat": lat, "lon": lon, "ocean": ocean, "mpa": mpa})

    # Step 2 — single Gemma4 call
    try:
        system = (
            "You are a marine scientist evaluating Ocean Alkalinity Enhancement sites. "
            f"You will receive {len(candidate_data)} sites. "
            "Respond ONLY with a valid JSON array. "
            f"The array must have exactly {len(candidate_data)} objects, one per site in order. "
            "Each object: suitability_score (float 0–1), reason (string ≤ 12 words), mpa_conflict (bool)."
        )
        lines = []
        for i, d in enumerate(candidate_data):
            o = d["ocean"]
            mpa_flag = f"YES — {d['mpa']['mpa_name']}" if d["mpa"]["overlaps"] else "no"
            lines.append(
                f"Site {i+1} (lat={d['lat']:.2f}, lon={d['lon']:.2f}): "
                f"SST={o['temperature_c']:.1f}°C  sal={o['salinity_psu']:.1f}PSU  "
                f"MLD={o['mixed_layer_depth_m']:.0f}m  "
                f"base_score={o['suitability_score']:.2f}  MPA={mpa_flag}"
            )
        prompt = (
            f"Evaluate these {len(candidate_data)} OAE deployment sites and return a "
            f"JSON array of exactly {len(candidate_data)} objects in the same order.\n\n"
            + "\n".join(lines)
        )
        text = await query_gemma(prompt, system=system, timeout=45.0, num_predict=1024)

        # Extract first JSON array from response
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if m:
            parsed = json.loads(m.group())
            if isinstance(parsed, list) and len(parsed) == len(candidate_data):
                results = []
                for d, p in zip(candidate_data, parsed):
                    results.append({
                        "lat": d["lat"],
                        "lon": d["lon"],
                        "suitability_score": float(p.get("suitability_score", 0.5)),
                        "reason": str(p.get("reason", ""))[:120],
                        "mpa_conflict": bool(p.get("mpa_conflict", d["mpa"]["overlaps"])),
                        "model_used": "gemma4:e4b (local)",
                    })
                return results
    except Exception as e:
        logger.info("Batch Gemma4 scoring failed, falling back to rule-based: %s", e)

    # Step 3 — rule-based fallback for every site
    results = []
    for d in candidate_data:
        score, reason = _compute_score(d["ocean"], d["mpa"])
        results.append({
            "lat": d["lat"],
            "lon": d["lon"],
            "suitability_score": score,
            "reason": reason,
            "mpa_conflict": d["mpa"]["overlaps"],
            "model_used": "rule-based-fallback",
        })
    return results


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
                parsed["model_used"] = "gemma4:e4b (local)"
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
